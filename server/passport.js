const { Strategy: JwtStrategy } = require("passport-jwt");
const { Strategy: LocalStrategy } = require("passport-local");
const passport = require("passport");
const bcrypt = require("bcryptjs");

const query = require("./queries");
const env = require("./env");
const utils = require("./utils");

// Precomputed cost-12 bcrypt hash for constant-time dummy comparisons on missing accounts
const DUMMY_BCRYPT_HASH = bcrypt.hashSync("dyslinks-timing-dummy-password", 12);

const BASIC_EMAIL_REGEX = /^[^\s@<>'"`]+@[^\s@<>'"`]+\.[^\s@<>'"`]+$/;

const jwtOptions = {
  jwtFromRequest: req => req.cookies?.token,
  secretOrKey: env.JWT_SECRET,
  algorithms: ["HS256"],
};

passport.use(
  new JwtStrategy(jwtOptions, async (payload, done) => {
    try {
      // 'sub' used to be the email address
      // this check makes sure to invalidate old JWTs where the sub is still the email address
      if (typeof payload.sub === "string" || !payload.sub) {
        return done(null, false);
      }
      const user = await query.user.find({ id: payload.sub });
      if (!user) return done(null, false);
      const currentVersion = user.token_version ?? 0;
      const tokenVersion = payload.ver ?? 0;
      if (tokenVersion !== currentVersion) {
        return done(null, false);
      }
      return done(null, user, payload);
    } catch (err) {
      return done(err);
    }
  })
);

if (!env.DISALLOW_LOGIN_FORM) {
  const localOptions = {
    usernameField: "email"
  };

  passport.use(
    new LocalStrategy(localOptions, async (email, password, done) => {
      try {
        const user = await query.user.find({ email });
        if (!user) {
          await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
          return done(null, false);
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return done(null, false);
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );
}

// Header-only API key strategy (never accepts ?apikey= query strings or form bodies)
class HeaderApiKeyStrategy {
  constructor() {
    this.name = "localapikey";
  }

  authenticate(req) {
    const rawHeader = req.headers["x-api-key"];
    if (rawHeader === undefined) {
      return this.pass();
    }
    const rawKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (typeof rawKey !== "string" || !rawKey.trim()) {
      return this.fail({ message: "API key is not correct." }, 401);
    }
    const hashedKey = utils.hashApiKey(rawKey.trim());
    query.user
      .find({ apikey: hashedKey })
      .then((user) => {
        if (!user) {
          return this.fail({ message: "API key is not correct." }, 401);
        }
        return this.success(user);
      })
      .catch((err) => this.error(err));
  }
}

passport.use("localapikey", new HeaderApiKeyStrategy());

let oidcReady = Promise.resolve(false);

if (env.OIDC_ENABLED) {
  async function enableOIDC() {
    const requiredKeys = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_SCOPE", "OIDC_EMAIL_CLAIM"];
    requiredKeys.forEach((key) => {
      if (!env[key]) {
        throw new Error(`Missing required env ${key}`);
      }
    });

    const client = await import("openid-client");
    const { Strategy: OIDCStrategy } = await import("openid-client/passport");

    const issuerUrl = new URL(env.OIDC_ISSUER);
    const discoveryOptions = !env.isProd && issuerUrl.protocol === "http:"
      ? { execute: [client.allowInsecureRequests] }
      : undefined;

    const config = await client
      .discovery(issuerUrl, env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET, undefined, discoveryOptions)
      .catch(function (error) {
        error.info = "Failed connecting to OIDC issuer.";
        throw error;
      });

    const issuerId = config.serverMetadata().issuer || env.OIDC_ISSUER;

    const strategy = new OIDCStrategy(
      {
        name: "oidc",
        config,
        scope: env.OIDC_SCOPE,
        callbackURL: utils.getSiteURL() + "/login/oidc",
        passReqToCallback: true,
      },
      async (req, tokens, done) => {
        try {
          const claims = tokens.claims?.() || {};
          const sub = typeof claims.sub === "string" ? claims.sub.trim() : "";
          if (!sub) {
            return done(null, false, new Error("OIDC subject claim is missing."));
          }

          let userinfo = {};
          if (config.serverMetadata().userinfo_endpoint && tokens.access_token) {
            userinfo = await client.fetchUserInfo(config, tokens.access_token, sub);
          }
          const profile = { ...claims, ...userinfo };

          const rawEmail = profile?.[env.OIDC_EMAIL_CLAIM];
          if (typeof rawEmail !== "string" || !rawEmail.trim()) {
            return done(null, false, new Error("OIDC email claim is missing."));
          }
          const email = rawEmail.trim().toLowerCase();
          if (email.length > 255 || !BASIC_EMAIL_REGEX.test(email)) {
            return done(null, false, new Error("OIDC email claim is invalid."));
          }

          const emailVerified = profile?.email_verified === true;
          if (!emailVerified && !env.OIDC_ALLOW_UNVERIFIED_EMAIL) {
            return done(null, false, new Error("OIDC email address is not verified."));
          }

          // 1. Prefer immutable (issuer, sub) binding
          const boundUser = await query.user.find({ oidc_issuer: issuerId, oidc_sub: sub });
          if (boundUser) {
            return done(null, boundUser);
          }

          // 2. Link to existing account by verified email only if not bound to another OIDC subject
          const existingUser = await query.user.find({ email });
          if (existingUser) {
            if (existingUser.oidc_sub && (existingUser.oidc_sub !== sub || existingUser.oidc_issuer !== issuerId)) {
              return done(null, false, new Error("Account is already linked to another OIDC identity."));
            }
            if (!emailVerified) {
              return done(null, false, new Error("Verified OIDC email is required to link an existing account."));
            }
            const linkedUser = await query.user.update(
              { id: existingUser.id },
              { oidc_issuer: issuerId, oidc_sub: sub }
            );
            return done(null, linkedUser || existingUser);
          }

          if (env.DISALLOW_REGISTRATION && !env.OIDC_ALLOW_REGISTRATION) {
            return done(null, false, new Error("Registration is disabled."));
          }

          // 3. Provision new user bound to (issuer, sub)
          const salt = await bcrypt.genSalt(12);
          const password = await bcrypt.hash(utils.generateRandomPassword(), salt);
          const newUser = await query.user.create({
            email,
            password,
            verified: true,
            oidc_issuer: issuerId,
            oidc_sub: sub,
          });
          return done(null, newUser);
        } catch (err) {
          return done(err);
        }
      }
    );

    if (env.OIDC_PROMPT) {
      const origAuthParams = strategy.authorizationRequestParams.bind(strategy);
      strategy.authorizationRequestParams = (req, options) => {
        const params = new URLSearchParams(origAuthParams(req, options));
        if (!params.has("prompt")) {
          params.set("prompt", env.OIDC_PROMPT);
        }
        return params;
      };
    }

    passport.use(strategy);
    return true;
  }

  oidcReady = enableOIDC().catch((err) => {
    console.error("Failed to initialize OIDC:", err);
    return false;
  });
}

module.exports = {
  oidcReady,
};
