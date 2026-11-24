const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signRS256(payload, privateKey, kid) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = base64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(data), privateKey);
  return `${data}.${base64url(sig)}`;
}

function startMockOIDCProvider() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "mock-key-1", alg: "RS256", use: "sig" };
  const codes = new Map();

  return new Promise((resolve) => {
    let issuer = "";
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, issuer);

      if (reqUrl.pathname === "/.well-known/openid-configuration") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            userinfo_endpoint: `${issuer}/userinfo`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
          })
        );
        return;
      }

      if (reqUrl.pathname === "/jwks") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }

      if (reqUrl.pathname === "/token" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const params = new URLSearchParams(body);
          const code = params.get("code");
          const codeVerifier = params.get("code_verifier");
          const record = codes.get(code);
          if (!record) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_grant" }));
            return;
          }
          codes.delete(code);

          // Verify PKCE S256 challenge
          const expectedChallenge = base64url(crypto.createHash("sha256").update(codeVerifier || "").digest());
          if (expectedChallenge !== record.codeChallenge) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_grant", error_description: "PKCE mismatch" }));
            return;
          }

          const now = Math.floor(Date.now() / 1000);
          const idToken = signRS256(
            {
              iss: issuer,
              sub: "oidc-user-123",
              aud: "test-client-id",
              iat: now,
              exp: now + 300,
              ...(record.nonce ? { nonce: record.nonce } : {}),
            },
            privateKey,
            "mock-key-1"
          );

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              access_token: "mock-access-token",
              token_type: "Bearer",
              expires_in: 300,
              id_token: idToken,
            })
          );
        });
        return;
      }

      if (reqUrl.pathname === "/userinfo") {
        if (req.headers.authorization !== "Bearer mock-access-token") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_token" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            sub: "oidc-user-123",
            email: "oidc-user@example.com",
            email_verified: true,
          })
        );
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      issuer = `http://127.0.0.1:${port}`;
      resolve({
        server,
        issuer,
        issueCode({ codeChallenge, nonce }) {
          const code = crypto.randomBytes(16).toString("hex");
          codes.set(code, { codeChallenge, nonce });
          return code;
        },
      });
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

test("openid-client v6 end-to-end OIDC PKCE authorization, callback, UserInfo, and auto-provisioning", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyslinks-oidc-"));
  const dbFile = path.join(tmpDir, "oidc.sqlite");
  const mockIdp = await startMockOIDCProvider();
  const appPort = await getFreePort();
  const appUrl = `http://127.0.0.1:${appPort}`;

  const env = {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(appPort),
    DEFAULT_DOMAIN: `127.0.0.1:${appPort}`,
    JWT_SECRET: crypto.randomBytes(32).toString("hex"),
    DB_CLIENT: "better-sqlite3",
    DB_FILENAME: dbFile,
    REDIS_ENABLED: "false",
    DISALLOW_REGISTRATION: "true",
    OIDC_ENABLED: "true",
    OIDC_ISSUER: mockIdp.issuer,
    OIDC_CLIENT_ID: "test-client-id",
    OIDC_CLIENT_SECRET: "test-client-secret",
    OIDC_SCOPE: "openid profile email",
    OIDC_EMAIL_CLAIM: "email",
    OIDC_PROMPT: "login",
    OIDC_ALLOW_REGISTRATION: "true",
    NODE_APP_INSTANCE: "1",
  };

  // Run migrations first
  const knexBin = path.resolve(__dirname, "../../node_modules/knex/bin/cli.js");
  await new Promise((resolve, reject) => {
    const mig = spawn(process.execPath, [knexBin, "migrate:latest"], {
      cwd: path.resolve(__dirname, "../.."),
      env,
      stdio: "pipe",
    });
    let stderr = "";
    mig.stderr.on("data", (d) => (stderr += d));
    mig.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Migrate failed (${code}): ${stderr}`))));
  });

  // Boot Dyslinks server with OIDC enabled
  const appProc = spawn(process.execPath, [path.resolve(__dirname, "../server.js")], {
    cwd: path.resolve(__dirname, "../.."),
    env,
    stdio: "pipe",
  });

  let appStderr = "";
  appProc.stderr.on("data", (d) => (appStderr += d));

  try {
    // Wait for server health
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`${appUrl}/api/health`);
        if (r.status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(ready, true, `Server failed to start: ${appStderr}`);

    // Step 1: Initiate OIDC login
    const initRes = await fetch(`${appUrl}/login/oidc`, {
      redirect: "manual",
      headers: { Accept: "text/html" },
    });
    assert.equal(initRes.status, 302, `Expected 302 redirect, got ${initRes.status}: ${await initRes.text()}`);

    const authRedirect = new URL(initRes.headers.get("location"));
    assert.equal(authRedirect.origin, mockIdp.issuer);
    assert.equal(authRedirect.pathname, "/authorize");
    assert.equal(authRedirect.searchParams.get("client_id"), "test-client-id");
    assert.equal(authRedirect.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authRedirect.searchParams.get("prompt"), "login");
    assert.equal(authRedirect.searchParams.get("scope"), "openid profile email");
    assert.equal(authRedirect.searchParams.get("redirect_uri"), `${appUrl}/login/oidc`);

    const setCookies = initRes.headers.getSetCookie();
    assert.ok(setCookies.length > 0, "Expected cookie-session cookies on OIDC init");
    const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");

    // Step 2: Simulate IdP callback with authorization code
    const code = mockIdp.issueCode({
      codeChallenge: authRedirect.searchParams.get("code_challenge"),
      nonce: authRedirect.searchParams.get("nonce"),
    });
    const stateParam = authRedirect.searchParams.get("state");
    const callbackUrl = new URL(`${appUrl}/login/oidc`);
    callbackUrl.searchParams.set("code", code);
    if (stateParam) callbackUrl.searchParams.set("state", stateParam);

    const cbRes = await fetch(callbackUrl, {
      redirect: "manual",
      headers: {
        Accept: "text/html",
        Cookie: cookieHeader,
      },
    });
    assert.equal(cbRes.status, 200, `Expected 200 on OIDC callback, got ${cbRes.status}: ${appStderr}`);

    const cbCookies = cbRes.headers.getSetCookie();
    const tokenCookie = cbCookies.find((c) => c.startsWith("token="));
    assert.ok(tokenCookie, "Expected Dyslinks JWT token cookie to be set after OIDC login");

    // Step 3: Verify authenticated session works against /api/users
    const meRes = await fetch(`${appUrl}/api/users`, {
      headers: {
        Accept: "application/json",
        Cookie: tokenCookie.split(";")[0],
      },
    });
    assert.equal(meRes.status, 200);
    const me = await meRes.json();
    assert.equal(me.email, "oidc-user@example.com");
  } finally {
    appProc.kill("SIGTERM");
    await new Promise((resolve) => {
      appProc.once("exit", resolve);
      setTimeout(() => {
        appProc.kill("SIGKILL");
        resolve();
      }, 3000);
    });
    await new Promise((resolve) => mockIdp.server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
