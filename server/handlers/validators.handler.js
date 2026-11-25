const { addMilliseconds } = require("date-fns");
const { body, param, query: queryValidator } = require("express-validator");
const promisify = require("node:util").promisify;
const bcrypt = require("bcryptjs");
const dns = require("node:dns");
const ms = require("ms");

const { ROLES } = require("../consts");
const query = require("../queries");
const utils = require("../utils");
const env = require("../env");

const dnsLookup = promisify(dns.lookup);

const checkUser = (value, { req }) => !!req.user;
const sanitizeCheckbox = value => {
  if (value === true || value === "on" || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0" || value === "") return false;
  return value;
};

const createLink = [
  (req, res, next) => {
    req.validatedDomain = null;
    req.domainExplicit = false;
    next();
  },
  body("target")
    .exists({ values: "falsy" })
    .withMessage("Target is missing.")
    .isString()
    .trim()
    .isLength({ min: 1, max: 2040 })
    .withMessage("Maximum URL length is 2040.")
    .customSanitizer(utils.addProtocol)
    .custom(value => utils.isSafeUrl(value, { allowCustomProtocols: true }))
    .withMessage("URL is not valid.")
    .custom(value => (utils.removeWww(URL.parse(value)?.host) || "").toLowerCase() !== env.DEFAULT_DOMAIN.toLowerCase())
    .withMessage(`${env.DEFAULT_DOMAIN} URLs are not allowed.`),
  body("password")
    .optional({ values: "falsy" })
    .custom(checkUser)
    .withMessage("Only users can use this field.")
    .isString()
    .isLength({ min: 6, max: 64 })
    .withMessage("Password length must be between 6 and 64."),
  body("customurl")
    .optional({ values: "falsy" })
    .custom(checkUser)
    .withMessage("Only users can use this field.")
    .isString()
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage("Custom URL length must be between 1 and 64.")
    .custom(value => utils.customAddressRegex.test(value) || utils.customAlphabetRegex.test(value))
    .withMessage("Custom URL is not valid.")
    .custom(value => !utils.preservedURLs.some(url => url.toLowerCase() === value.toLowerCase()))
    .withMessage("You can't use this custom URL."),
  body("reuse")
    .optional({ values: "null" })
    .custom(checkUser)
    .withMessage("Only users can use this field.")
    .isBoolean()
    .withMessage("Reuse must be boolean."),
  body("description")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .isLength({ min: 1, max: 2040 })
    .withMessage("Description length must be between 1 and 2040."),
  body("expire_in")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .custom((value, { req }) => {
      req.rawExpireIn = value;
      try {
        return !!ms(value);
      } catch {
        return false;
      }
    })
    .withMessage("Expire format is invalid. Valid examples: 1m, 8h, 42 days.")
    .customSanitizer(ms)
    .custom(value => value >= ms("1m"))
    .withMessage("Expire time should be more than 1 minute.")
    .customSanitizer(value => utils.dateToUTC(addMilliseconds(new Date(), value))),
  body("domain")
    .optional({ values: "falsy" })
    .customSanitizer((value, { req }) => {
      req.domainExplicit = true;
      return String(value).trim().toLowerCase() === env.DEFAULT_DOMAIN.toLowerCase() ? null : value;
    })
    .custom(checkUser)
    .withMessage("Only users can use this field.")
    .isString()
    .withMessage("Domain should be string.")
    .customSanitizer(value => value.trim().toLowerCase())
    .custom(async (address, { req }) => {
      const domain = await query.domain.find({ address });
      const canUseOwn = !env.DISALLOW_CUSTOM_DOMAINS || req.user.admin;
      const allowed = domain && !domain.banned && (domain.shared || (canUseOwn && domain.user_id === req.user.id));
      req.validatedDomain = allowed ? domain : null;

      if (!allowed) return Promise.reject();
    })
    .withMessage("You can't use this domain.")
];

const editLink = [
  body("target")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .isLength({ min: 1, max: 2040 })
    .withMessage("Maximum URL length is 2040.")
    .customSanitizer(utils.addProtocol)
    .custom(value => utils.isSafeUrl(value, { allowCustomProtocols: true }))
    .withMessage("URL is not valid.")
    .custom(value => (utils.removeWww(URL.parse(value)?.host) || "").toLowerCase() !== env.DEFAULT_DOMAIN.toLowerCase())
    .withMessage(`${env.DEFAULT_DOMAIN} URLs are not allowed.`),
  body("password")
    .optional({ values: "falsy" })
    .isString()
    .isLength({ min: 6, max: 64 })
    .withMessage("Password length must be between 6 and 64."),
  body("address")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage("Custom URL length must be between 1 and 64.")
    .custom(value => utils.customAddressRegex.test(value) || utils.customAlphabetRegex.test(value))
    .withMessage("Custom URL is not valid")
    .custom(value => !utils.preservedURLs.some(url => url.toLowerCase() === value.toLowerCase()))
    .withMessage("You can't use this custom URL."),
  body("expire_in")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .custom((value, { req }) => {
      req.rawExpireIn = value;
      try {
        return !!ms(value);
      } catch {
        return false;
      }
    })
    .withMessage("Expire format is invalid. Valid examples: 1m, 8h, 42 days.")
    .customSanitizer(ms)
    .custom(value => value >= ms("1m"))
    .withMessage("Expire time should be more than 1 minute.")
    .customSanitizer(value => utils.dateToUTC(addMilliseconds(new Date(), value))),
  body("description")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .isLength({ min: 0, max: 2040 })
    .withMessage("Description length must be between 0 and 2040."),
  param("id", "ID is invalid.")
    .exists({ values: "falsy" })
    .isUUID()
];

const redirectProtected = [
  body("password", "Password is invalid.")
    .exists({ values: "falsy" })
    .isString()
    .isLength({ min: 3, max: 64 })
    .withMessage("Password length must be between 3 and 64."),
  param("id", "ID is invalid.")
    .exists({ values: "falsy" })
    .isUUID()
];

const addDomain = [
  body("address", "Domain is not valid.")
    .exists({ values: "falsy" })
    .isLength({ min: 3, max: 64 })
    .withMessage("Domain length must be between 3 and 64.")
    .trim()
    .customSanitizer(utils.addProtocol)
    .custom(value => utils.urlRegex.test(value))
    .customSanitizer(value => {
      const parsed = URL.parse(value);
      return utils.removeWww(parsed?.hostname || parsed?.href || value);
    })
    .custom(value => !utils.isPrivateHostname(value))
    .withMessage("Domain is not valid.")
    .custom(value => value.toLowerCase() !== env.DEFAULT_DOMAIN.toLowerCase())
    .withMessage("You can't use the default domain.")
    .custom(async value => {
      const domain = await query.domain.find({ address: value.toLowerCase() });
      if (domain) return Promise.reject();
    })
    .withMessage("You can't add this domain."),
  body("homepage")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .isLength({ min: 1, max: 2040 })
    .customSanitizer(utils.addProtocol)
    .custom(value => utils.isSafeUrl(value, { allowCustomProtocols: false }))
    .withMessage("Homepage is not valid.")
];

const addDomainAdmin = [
  body("address", "Domain is not valid.")
    .exists({ values: "falsy" })
    .isLength({ min: 3, max: 64 })
    .withMessage("Domain length must be between 3 and 64.")
    .trim()
    .customSanitizer(utils.addProtocol)
    .custom(value => utils.urlRegex.test(value))
    .customSanitizer(value => {
      const parsed = URL.parse(value);
      return utils.removeWww(parsed?.hostname || parsed?.href || value);
    })
    .custom(value => value.toLowerCase() !== env.DEFAULT_DOMAIN.toLowerCase())
    .withMessage("You can't add the default domain.")
    .custom(async value => {
      const domain = await query.domain.find({ address: value });
      if (domain) return Promise.reject();
    })
    .withMessage("Domain already exists."),
  body("homepage")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .isLength({ min: 1, max: 2040 })
    .customSanitizer(utils.addProtocol)
    .custom(value => utils.isSafeUrl(value, { allowCustomProtocols: false }))
    .withMessage("Homepage is not valid."),
  body("banned")
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean(),
  body("shared")
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean(),
]

const toggleShareDomain = [
  param("id", "ID is invalid.")
    .exists({ values: "falsy" })
    .isNumeric()
];

const removeDomain = [
  param("id", "ID is invalid.")
    .exists({ values: "falsy" })
    .isUUID()
];

const removeDomainAdmin = [
  param("id", "ID is invalid.")
    .exists({ values: "falsy" })
    .isNumeric(),
  queryValidator("links")
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean(),
];

const deleteLink = [
  param("id", "ID is invalid.")
    .exists({ values: "falsy" })
    .isUUID()
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bulkDeleteLinks = [
  body("all")
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean()
    .withMessage('"all" should be a boolean.'),
  body("domain")
    .optional({ values: "falsy" })
    .isString()
    .withMessage("Domain should be a string.")
    .trim()
    .isLength({ max: 255 })
    .withMessage("Domain is too long."),
  body("search")
    .optional({ values: "falsy" })
    .isString()
    .withMessage("Search should be a string.")
    .trim()
    .isLength({ max: 2040 })
    .withMessage("Search is too long."),
  body("ids")
    .customSanitizer(value => {
      if (value === undefined || value === null || value === "") return [];
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
      }
      if (Array.isArray(value)) {
        const seen = new Set();
        const result = [];
        for (const item of value) {
          if (typeof item !== "string") return value;
          const trimmed = item.trim();
          if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed);
            result.push(trimmed);
          }
        }
        return result;
      }
      return value;
    })
    .custom((value, { req }) => {
      if (req.body.all === true) return true;
      if (!Array.isArray(value) || value.length === 0) return false;
      if (value.length > 500) return false;
      return value.every(id => typeof id === "string" && UUID_REGEX.test(id));
    })
    .withMessage("Please select between 1 and 500 valid links to delete.")
];

const reportLink = [
  body("link", "No link has been provided.")
    .exists({ values: "falsy" })
    .isString()
    .trim()
    .isLength({ min: 1, max: 2040 })
    .customSanitizer(utils.addProtocol)
    .custom(value => {
      if (/[\u0000-\u001F\u007F]/.test(value)) return false;
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
        return (utils.removeWww(parsed.host) || "").toLowerCase() === env.DEFAULT_DOMAIN.toLowerCase();
      } catch {
        return false;
      }
    })
    .withMessage(`You can only report a ${env.DEFAULT_DOMAIN} link.`)
];

const banLink = [
  param("id", "ID is invalid.")
    .exists({ values: "falsy" })
    .isUUID(),
  body("host", '"host" should be a boolean.')
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean(),
  body("user", '"user" should be a boolean.')
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean(),
  body("userLinks", '"userLinks" should be a boolean.')
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean(),
  body("domain", '"domain" should be a boolean.')
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean()
];

const banUser = [
  param("id", "ID is invalid.")
    .exists({ values: "falsy" })
    .isNumeric(),
  body("links", '"links" should be a boolean.')
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean(),
  body("domains", '"domains" should be a boolean.')
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean()
];

const banDomain = [
  param("id", "ID is invalid.")
    .exists({ values: "falsy" })
    .isNumeric(),
  body("links", '"links" should be a boolean.')
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean(),
  body("user", '"user" should be a boolean.')
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean()
];

const createUser = [
  body("password", "Password is not valid.")
    .exists({ values: "falsy" })
    .isLength({ min: 8, max: 64 })
    .withMessage("Password length must be between 8 and 64."),
  body("email", "Email is not valid.")
    .exists({ values: "falsy" })
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage("Email length must be max 255.")
    .isEmail()
    .custom(async (value, { req }) => {
      const user = await query.user.find({ email: value });
      if (user) 
        return Promise.reject();
    })
    .withMessage("User already exists."),
  body("role", "Role is not valid.")
    .optional({ values: "falsy" })
    .trim()
    .isIn([ROLES.USER, ROLES.ADMIN]),
  body("verified")
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean(),
  body("banned")
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean(),
  body("verification_email")
    .optional({ values: "null" })
    .customSanitizer(sanitizeCheckbox)
    .isBoolean(),
];

const getStats = [
  param("id", "ID is invalid.")
    .exists({ values: "falsy" })
    .isUUID()
];

const signup = [
  body("password", "Password is not valid.")
    .exists({ values: "falsy" })
    .isLength({ min: 8, max: 64 })
    .withMessage("Password length must be between 8 and 64."),
  body("email", "Email is not valid.")
    .exists({ values: "falsy" })
    .trim()
    .isLength({ min: 0, max: 255 })
    .withMessage("Email length must be max 255.")
    .isEmail()
];

const signupEmailTaken = [
  (req, res, next) => {
    req.existingUnverifiedUser = null;
    next();
  },
  body("email", "Email is not valid.")
    .custom(async (value, { req }) => {
      const user = await query.user.find({ email: value });

      if (!user) return;

      if (user.verified || user.banned || user.role === ROLES.ADMIN || !env.MAIL_ENABLED) {
        return Promise.reject();
      }

      // Only allow resending verification if the caller knows the existing password
      const passwordMatches = typeof req.body.password === "string" &&
        await bcrypt.compare(req.body.password, user.password);
      if (!passwordMatches) {
        return Promise.reject();
      }

      req.existingUnverifiedUser = user;
    })
    .withMessage("You can't use this email address.")
];

const login = [
  body("password", "Password is not valid.")
    .exists({ values: "falsy" })
    .isLength({ min: 8, max: 64 })
    .withMessage("Password length must be between 8 and 64."),
  body("email", "Email is not valid.")
    .exists({ values: "falsy" })
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage("Email length must be max 255.")
    .isEmail()
];

const createAdmin = [
  body("password", "Password is not valid.")
    .exists({ values: "falsy" })
    .isLength({ min: 8, max: 64 })
    .withMessage("Password length must be between 8 and 64."),
  body("email", "Email is not valid.")
    .exists({ values: "falsy" })
    .trim()
    .isLength({ min: 0, max: 255 })
    .withMessage("Email length must be max 255.")
    .isEmail()
];

const changePassword = [
  body("currentpassword", "Password is not valid.")
    .exists({ values: "falsy" })
    .isLength({ min: 8, max: 64 })
    .withMessage("Password length must be between 8 and 64."),
  body("newpassword", "Password is not valid.")
    .exists({ values: "falsy" })
    .isLength({ min: 8, max: 64 })
    .withMessage("Password length must be between 8 and 64.")
];

const changeEmail = [
  body("password", "Password is not valid.")
    .exists({ values: "falsy" })
    .isLength({ min: 8, max: 64 })
    .withMessage("Password length must be between 8 and 64."),
  body("email", "Email address is not valid.")
    .exists({ values: "falsy" })
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage("Email length must be max 255.")
    .isEmail()
];

const resetPassword = [
  body("email", "Email is not valid.")
    .exists({ values: "falsy" })
    .trim()
    .isLength({ min: 0, max: 255 })
    .withMessage("Email length must be max 255.")
    .isEmail()
];

const newPassword = [
  body("reset_password_token", "Reset password token is invalid.")
    .exists({ values: "falsy" })
    .isUUID(),
  body("new_password", "Password is not valid.")
    .exists({ values: "falsy" })
    .isLength({ min: 8, max: 64 })
    .withMessage("Password length must be between 8 and 64."),
  body("repeat_password", "Password is not valid.")
    .custom((repeat_password, { req }) => {
      return repeat_password === req.body.new_password;
    })
    .withMessage("Passwords don't match."),
];

const deleteUser = [
  body("password", "Password is not valid.")
    .exists({ values: "falsy" })
    .isLength({ min: 8, max: 64 })
    .custom(async (password, { req }) => {
      const isMatch = await bcrypt.compare(password, req.user.password);
      if (!isMatch) return Promise.reject();
    })
    .withMessage("Password is not correct.")
];

const deleteUserByAdmin = [
  param("id", "ID is invalid.")
    .exists({ values: "falsy" })
    .isNumeric()
];

async function bannedDomain(domain) {
  const isBanned = await query.domain.find({
    address: domain,
    banned: true
  });

  if (isBanned) {
    throw new utils.CustomError("Domain is banned.", 400);
  }
};

async function bannedHost(domain) {
  if (!domain) return;

  let records = [];
  try {
    records = await dnsLookup(domain, { all: true });
  } catch {
    return;
  }

  if (!Array.isArray(records) || records.length === 0) return;

  for (const entry of records) {
    const ip = entry?.address;
    if (!ip) continue;
    if (utils.isPrivateHostname(ip)) {
      throw new utils.CustomError("URL is not valid.", 400);
    }
    const isBanned = await query.host.find({
      address: ip,
      banned: true
    });
    if (isBanned) {
      throw new utils.CustomError("URL is containing malware/scam.", 400);
    }
  }
};

const setDefaultDomain = [
  (req, res, next) => {
    req.validatedDomain = null;
    next();
  },
  body("domain")
    .optional({ values: "falsy" })
    .isString()
    .withMessage("Domain should be string.")
    .customSanitizer(value => {
      const normalized = value.trim().toLowerCase();
      return !normalized || normalized === env.DEFAULT_DOMAIN.toLowerCase() ? null : normalized;
    })
    .custom(async (address, { req }) => {
      if (!address) {
        req.validatedDomain = null;
        return;
      }
      const domain = await query.domain.find({ address });
      const canUseOwn = !env.DISALLOW_CUSTOM_DOMAINS || req.user.admin;
      const allowed = domain && !domain.banned && (domain.shared || (canUseOwn && domain.user_id === req.user.id));
      req.validatedDomain = allowed ? domain : null;

      if (!allowed) return Promise.reject();
    })
    .withMessage("You can't use this domain.")
];

module.exports = {
  addDomain,
  addDomainAdmin,
  banDomain,
  banLink,
  banUser,
  bannedDomain,
  bannedHost,
  bulkDeleteLinks,
  changeEmail,
  changePassword,
  checkUser,
  createAdmin,
  createLink,
  createUser,
  deleteLink,
  deleteUser,
  deleteUserByAdmin,
  editLink,
  getStats,
  login, 
  newPassword,
  redirectProtected,
  removeDomain,
  removeDomainAdmin,
  reportLink,
  resetPassword,
  setDefaultDomain,
  signup,
  signupEmailTaken,
  toggleShareDomain,
}