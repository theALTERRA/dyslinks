const env = require("./env");

const cookieParser = require("cookie-parser");
const passport = require("passport");
const express = require("express");
const session = require("cookie-session");
const helmet = require("helmet");
const path = require("node:path");
const hbs = require("hbs");

const helpers = require("./handlers/helpers.handler");
const renders = require("./handlers/renders.handler");
const asyncHandler = require("./utils/asyncHandler");
const locals = require("./handlers/locals.handler");
const links = require("./handlers/links.handler");
const routes = require("./routes");
const utils = require("./utils");


// run the cron jobs
// the app might be running in cluster mode (multiple instances) so run the cron job only on one cluster (the first one)
// NODE_APP_INSTANCE variable is added by pm2 automatically, if you're using something else to cluster your app, then make sure to set this variable
if (env.NODE_APP_INSTANCE === 0) {
  require("./cron");
}

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
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      upgradeInsecureRequests: null,
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
  app.use(session({
    keys: [env.JWT_SECRET],
    maxAge: 1000 * 60 * 60 * 24 * 7, // expire after seven days
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
  }));
}

// serve static
app.use("/images", express.static("custom/images"));
app.use("/css", express.static("custom/css", { extensions: ["css"] }));
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
  key: "redirect-protected-basic",
});
function rateLimitBasicAuthRedirect(req, res, next) {
  if (typeof req.headers.authorization === "string" && /^basic\s+/i.test(req.headers.authorization)) {
    return redirectBasicAuthRateLimit(req, res, next);
  }
  return next();
}
app.get("/:id", rateLimitBasicAuthRedirect, asyncHandler(links.redirect));

// 404 pages that don't exist
app.get("*", renders.notFound);

// handle errors coming from above routes
app.use(helpers.error);
  
app.listen(env.PORT, () => {
  console.log(`> Ready on http://localhost:${env.PORT}`);
});
