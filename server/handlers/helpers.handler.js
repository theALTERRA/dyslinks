const { RedisStore: RateLimitRedisStore } = require("rate-limit-redis");
const { rateLimit: expressRateLimit } = require("express-rate-limit");
const { validationResult } = require("express-validator");

const { CustomError } = require("../utils");
const query = require("../queries");
const redis = require("../redis");
const env = require("../env");

function error(error, req, res, _next) {
  if (!(error instanceof CustomError)) {
    console.error(error);
  } else if (env.isDev) {
    console.error(error.message);
  }

  const message = error instanceof CustomError ? error.message : "An error occurred.";
  const statusCode = error.statusCode ?? 500;

  if (req.isHTML && req.viewTemplate) {
    res.locals.error = message;
    res.render(req.viewTemplate);
    return;
  }

  if (req.isHTML) {
    res.render("error", {
      message: "An error occurred. Please try again later."
    });
    return;
  }


  return res.status(statusCode).json({ error: message });
};


function verify(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const errors = result.array();
  const error = errors[0].msg;
  
  res.locals.errors = {};
  errors.forEach(e => {
    if (res.locals.errors[e.param]) return;
    res.locals.errors[e.param] = e.msg;
  });

  throw new CustomError(error, 400);
}

function parseQuery(req, res, next) {
  const { admin } = req.user || {};

  if (
    typeof req.query.limit !== "undefined" &&
    typeof req.query.limit !== "string"
  ) {
    return res.status(400).json({ error: "limit query is not valid." });
  }

  if (
    typeof req.query.skip !== "undefined" &&
    typeof req.query.skip !== "string"
  ) {
    return res.status(400).json({ error: "skip query is not valid." });
  }

  if (
    typeof req.query.search !== "undefined" &&
    typeof req.query.search !== "string"
  ) {
    return res.status(400).json({ error: "search query is not valid." });
  }

  const parsedLimit = parseInt(req.query.limit, 10);
  const parsedSkip = parseInt(req.query.skip, 10);
  const limit = Number.isNaN(parsedLimit) ? 10 : Math.min(Math.max(parsedLimit, 1), 50);
  const skip = Number.isNaN(parsedSkip) ? 0 : Math.max(parsedSkip, 0);

  req.context = {
    limit,
    skip,
  };

  next();
};

function verifyOrigin(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }

  // Only enforce same-origin check when authenticating via session cookie (not API key)
  if (!req.cookies?.token || req.headers["x-api-key"]) {
    return next();
  }

  const originHeader = req.headers.origin;
  const secFetchSite = req.headers["sec-fetch-site"];

  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return next(new CustomError("Forbidden cross-origin request.", 403));
  }

  if (originHeader) {
    try {
      const originHost = new URL(originHeader).host.toLowerCase();
      const allowedHosts = new Set(
        [req.headers.host, env.DEFAULT_DOMAIN]
          .filter(Boolean)
          .map(h => h.toLowerCase())
      );
      if (!allowedHosts.has(originHost)) {
        return next(new CustomError("Forbidden cross-origin request.", 403));
      }
    } catch {
      return next(new CustomError("Forbidden cross-origin request.", 403));
    }
  }

  return next();
}

function rateLimit(params) {
  if (!env.ENABLE_RATE_LIMIT) {
    return function(req, res, next) {
      return next();
    }
  }
  
  let store = undefined;
  if (env.REDIS_ENABLED) {
    store = new RateLimitRedisStore({
      sendCommand: (...args) => redis.client.call(...args),
    })
  }
  
  return expressRateLimit({
    windowMs: params.window * 1000,
    validate: { trustProxy: false },
    skipSuccessfulRequests: !!params.skipSuccess,
    skipFailedRequests: !!params.skipFailed,
    ...(store && { store }),
    limit: function (req, res) {
      if (params.user && req.user) {
        return params.user;
      }
      return params.limit;
    },
    keyGenerator: function(req, res) {
      return "rl:" + req.method + req.baseUrl + req.path + ":" + req.ip;
    },
    requestWasSuccessful: function(req, res) {
      return !res.locals.error && res.statusCode < 400;
    },
    handler: function (req, res, next, options) {
      throw new CustomError(options.message, options.statusCode);
    },
  });
}

// redirect to create admin page if the dyslinks instance is ran for the first time
async function adminSetup(req, res, next) {
  const isThereAUser = req.user || (await query.user.findAny());
  if (isThereAUser) {
    next();
    return;
  }

  res.redirect("/create-admin");
}

module.exports = {
  adminSetup,
  error,
  parseQuery,
  rateLimit,
  verify,
  verifyOrigin,
}