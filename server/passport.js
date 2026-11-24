const { Strategy: LocalAPIKeyStrategy } = require("passport-localapikey-update");
const { Strategy: JwtStrategy } = require("passport-jwt");
const { Strategy: LocalStrategy } = require("passport-local");
const passport = require("passport");
const bcrypt = require("bcryptjs");

const query = require("./queries");
const env = require("./env");
const utils = require("./utils")

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


const localAPIKeyOptions = {
  apiKeyField: "apikey",
  apiKeyHeader: "x-api-key"
};

passport.use(
  new LocalAPIKeyStrategy(localAPIKeyOptions, async (apikey, done) => {
    try {
      if (typeof apikey !== "string" || !apikey.trim()) {
        return done(null, false);
      }
      const user = await query.user.find({ apikey });
      if (!user) {
        return done(null, false);
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

let oidcReady = Promise.resolve(false);

if (env.OIDC_ENABLED) {
  async function enableOIDC() {
    const requiredKeys = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_SCOPE", "OIDC_EMAIL_CLAIM"];
    requiredKeys.forEach((key) => {
      if (!env[key]) {
        throw new Error(`Missing required env ${key}`);
      }
    });
    const { Issuer, Strategy: OIDCStrategy } = await import("openid-client");
    const issuer = await Issuer.discover(env.OIDC_ISSUER).catch(function (error) {
        error.info = "Failed connecting to OIDC issuer.";
        throw error;
      });
    const client = new issuer.Client({
      client_id: env.OIDC_CLIENT_ID,
      client_secret: env.OIDC_CLIENT_SECRET,
      redirect_uris: [utils.getSiteURL() + "/login/oidc"],
      response_types: ["code"]
    });
  
    passport.use(
      "oidc",
      new OIDCStrategy(
        {
          client,
          params: {
            scope: env.OIDC_SCOPE,
            ...(env.OIDC_PROMPT ? { prompt: env.OIDC_PROMPT } : {})
          },
          passReqToCallback: true
        },
        async (req, tokenset, userinfo, done) => {
          try {
            const rawEmail = userinfo?.[env.OIDC_EMAIL_CLAIM];
            if (typeof rawEmail !== "string" || !rawEmail.trim()) {
              return done(null, false, new Error("OIDC email claim is missing."));
            }
            if (userinfo?.email_verified === false) {
              return done(null, false, new Error("OIDC email address is not verified."));
            }
            const email = rawEmail.trim();
            const existingUser = await query.user.find({ email });
  
            // Existing user.
            if (existingUser) return done(null, existingUser);
  
            if (env.DISALLOW_REGISTRATION && !env.OIDC_ALLOW_REGISTRATION) {
              return done(null, false, new Error("Registration is disabled."));
            }

            // New user.
            // Generate a random password which is not supposed to be used directly.
            const salt = await bcrypt.genSalt(12);
            const password = await bcrypt.hash(utils.generateRandomPassword(), salt);
            const newUser = await query.user.create({
              email,
              password,
              verified: true,
            });
            return done(null, newUser);
  
          } catch (err) {
            return done(err);
          }
        }
      )
    );
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
