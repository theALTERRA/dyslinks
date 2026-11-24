const pkg = require("../../package.json");
const query = require("../queries");
const utils = require("../utils");
const env = require("../env");

function isHTML(req, res, next) {
  if (req.headers["hx-request"] === "true") {
    req.isHTML = true;
    next();
    return;
  }
  const accepts = req.accepts(["json", "html"]);
  req.isHTML = accepts === "html";
  next();
}

function noLayout(req, res, next) {
  res.locals.layout = null;
  next();
}

function viewTemplate(template) {
  return function (req, res, next) {
    req.viewTemplate = template;
    next();
  }
}

function config(req, res, next) {
  const defaultDomain = env.DEFAULT_DOMAIN.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const reqHost = utils.removeWww(req.headers.host)?.toLowerCase();
  const isCustomDomain = !!reqHost && reqHost !== utils.removeWww(defaultDomain).toLowerCase();
  const isLocalDefault = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(defaultDomain);
  const siteOrigin = `${env.isDev || isLocalDefault ? "http://" : "https://"}${defaultDomain}`;

  res.locals.default_domain = env.DEFAULT_DOMAIN;
  res.locals.site_url = isCustomDomain ? siteOrigin : "";
  res.locals.site_name = env.SITE_NAME;
  res.locals.contact_email = env.CONTACT_EMAIL;
  res.locals.server_ip_address = env.SERVER_IP_ADDRESS;
  res.locals.server_cname_address = env.SERVER_CNAME_ADDRESS;
  res.locals.disallow_registration = env.DISALLOW_REGISTRATION;
  res.locals.disallow_login_form = env.DISALLOW_LOGIN_FORM;
  res.locals.disallow_custom_domains = env.DISALLOW_CUSTOM_DOMAINS;
  res.locals.login_disabled = env.DISALLOW_LOGIN_FORM && !env.OIDC_ENABLED;
  res.locals.oidc_enabled = env.OIDC_ENABLED;
  res.locals.oidc_button_text = env.OIDC_BUTTON_TEXT;
  res.locals.mail_enabled = env.MAIL_ENABLED;
  res.locals.report_email = env.REPORT_EMAIL;
  res.locals.custom_styles = utils.getCustomCSSFileNames();
  res.locals.app_version = pkg.version;
  next();
}

function resolveUserDefaultDomain(user, availableDomains) {
  if (user?.default_domain_id && Array.isArray(availableDomains)) {
    const matched = availableDomains.find(d => d.id === user.default_domain_id);
    if (matched) return matched.address;
  }
  return env.DEFAULT_DOMAIN;
}

async function user(req, res, next) {
  const user = req.user;
  res.locals.user = user;
  if (user) {
    const canUseCustomDomains = !env.DISALLOW_CUSTOM_DOMAINS || utils.isAdmin(user);
    const [ownDomains, availableDomains] = await Promise.all([
      canUseCustomDomains ? query.domain.get({ user_id: user.id }) : Promise.resolve([]),
      query.domain.getForUser(user.id, { includeOwn: canUseCustomDomains })
    ]);
    res.locals.can_use_custom_domains = canUseCustomDomains;
    res.locals.domains = ownDomains.map(utils.sanitize.domain);
    res.locals.shortener_domains = availableDomains.map(utils.sanitize.domain);
    res.locals.user_default_domain = resolveUserDefaultDomain(user, availableDomains);
  } else {
    res.locals.can_use_custom_domains = false;
    res.locals.domains = null;
    res.locals.shortener_domains = null;
    res.locals.user_default_domain = env.DEFAULT_DOMAIN;
  }
  next();
}

function newPassword(req, res, next) {
  res.locals.reset_password_token = req.body.reset_password_token;
  next();
}

function createLink(req, res, next) {
  res.locals.show_advanced = !!req.body.show_advanced;
  next();
}

function editLink(req, res, next) {
  res.locals.id = req.params.id;
  res.locals.class = "no-animation";
  next();
}

function protected(req, res, next) {
  res.locals.id = req.params.id;
  next();
}

function adminTable(req, res, next) {
  res.locals.query = {
    anonymous: req.query.anonymous,
    banned: req.query.banned,
    domain: req.query.domain,
    domains: req.query.domains,
    has_domain: req.query.has_domain,
    links: req.query.links,
    owner: req.query.owner,
    role: req.query.role,
    search: req.query.search,
    user: req.query.user,
    verified: req.query.verified,
    shared: req.query.shared,
  };
  next();
}

module.exports = {
  adminTable,
  config,
  createLink,
  editLink,
  isHTML,
  newPassword,
  noLayout,
  protected,
  resolveUserDefaultDomain,
  user,
  viewTemplate,
}