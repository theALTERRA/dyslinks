const env = require("./env");

const cookieParser = require("cookie-parser");
const passport = require("passport");
const express = require("express");
const session = require("cookie-session");
const helmet = require("helmet");
const crypto = require("node:crypto");
const path = require("node:path");

const helpers = require("./handlers/helpers.handler");
const renders = require("./handlers/renders.handler");
const asyncHandler = require("./utils/asyncHandler");
const locals = require("./handlers/locals.handler");
const links = require("./handlers/links.handler");
const auth = require("./handlers/auth.handler");
const routes = require("./routes");
const queues = require("./queues");
const redis = require("./redis");
const knex = require("./knex");
const utils = require("./utils");


// intialize passport authentication library
require("./passport");

// create express app
const app = express();
app.disable("x-powered-by");

// this tells the express app that it's running behind a proxy server
// and thus it should get the IP address from the proxy server
// never use `true` (trust every hop): that lets any client spoof X-Forwarded-For
// and bypass rate limits when the container port is reachable directly
const trustProxy = String(env.TRUST_PROXY).trim().toLowerCase();
if (["true", "t", "yes", "y", "on", "1"].includes(trustProxy)) {
  app.set("trust proxy", "loopback, linklocal, uniquelocal");
} else if (/^\d+$/.test(trustProxy) && trustProxy !== "0") {
  app.set("trust proxy", Number(trustProxy));
} else if (!["false", "f", "no", "n", "off", "0", ""].includes(trustProxy)) {
  app.set("trust proxy", env.TRUST_PROXY);
}

const isLocalDefaultDomain = utils.isLocalDomain(env.DEFAULT_DOMAIN);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      upgradeInsecureRequests: env.isProd && !isLocalDefaultDomain ? [] : null,
    },
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// use cookie sessions only when OIDC is enabled
// because only OIDC is using it
if (env.OIDC_ENABLED) {
  const oidcSessionKey = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update("dyslinks:oidc-session")
    .digest("hex");

  app.use(session({
    keys: [oidcSessionKey],
    maxAge: 1000 * 60 * 15, // 15 minutes (only needed for OIDC PKCE handshake)
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
  }));
}

// serve static
app.use("/images", express.static("custom/images"));
app.use("/css", express.static("custom/css", { extensions: ["css"] }));
app.use("/fonts", express.static("static/fonts", { maxAge: "1y", immutable: true }));
app.use(express.static("static"));

app.use(passport.initialize());
app.use(locals.isHTML);
app.use(locals.config);

// template engine / serve html

app.set("view engine", "hbs");
app.set("views", [
  path.join(__dirname, "../custom/views"),
  path.join(__dirname, "views"),
]);
utils.registerHandlebarsHelpers();

// if is custom domain, redirect to the set homepage
app.use(asyncHandler(links.redirectCustomDomainHomepage));

// render html pages
app.use("/", routes.render);

// handle api requests
app.use("/api/v2", helpers.verifyOrigin, routes.api);
app.use("/api", helpers.verifyOrigin, routes.api);

// finally, redirect the short link to the target
const redirectBasicAuthRateLimit = helpers.rateLimit({
  window: 60,
  limit: 10,
  key: "protected-link",
});
function rateLimitBasicAuthRedirect(req, res, next) {
  if (typeof req.headers.authorization === "string" && /^basic\s+/i.test(req.headers.authorization)) {
    return redirectBasicAuthRateLimit(req, res, next);
  }
  return next();
}
app.get("/:id", rateLimitBasicAuthRedirect, asyncHandler(links.redirect));

// 404 pages that don't exist
app.get("/{*splat}", asyncHandler(auth.jwtLooseHeader), renders.notFound);

// handle errors coming from above routes
app.use(helpers.error);

let server = null;
let cron = null;
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`> Received ${signal}, shutting down gracefully...`);

  const forceTimer = setTimeout(() => {
    console.error("> Graceful shutdown timed out, forcing exit.");
    process.exit(1);
  }, 10_000);
  if (typeof forceTimer.unref === "function") {
    forceTimer.unref();
  }

  let exitCode = 0;
  try {
    if (cron && typeof cron.stop === "function") {
      cron.stop();
    }

    if (server) {
      await new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeIdleConnections === "function") {
          server.closeIdleConnections();
        }
      });
    }

    await Promise.allSettled([
      queues.visit.close(),
      redis.close(),
      knex.destroy(),
    ]);
  } catch (err) {
    console.error("> Error during shutdown:", err);
    exitCode = 1;
  } finally {
    clearTimeout(forceTimer);
    process.exit(exitCode);
  }
}

function start(port = env.PORT) {
  // run the cron jobs only on the primary instance in cluster mode
  // NODE_APP_INSTANCE is added by pm2 automatically
  if (env.NODE_APP_INSTANCE === 0 && !cron) {
    cron = require("./cron");
  }

  server = app.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  return server;
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  start,
  shutdown,
};
