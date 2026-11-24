const query = require("../queries");
const utils = require("../utils");
const env = require("../env");

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_REGEX = /^\d+$/;

function getQueryUUID(req) {
  return typeof req.query.id === "string" && UUID_REGEX.test(req.query.id) ? req.query.id : null;
}

function getQueryNumericId(req) {
  return typeof req.query.id === "string" && NUMERIC_ID_REGEX.test(req.query.id) ? parseInt(req.query.id, 10) : null;
}

/** 
*
* PAGES
*
**/

async function homepage(req, res) {
  if (env.DISALLOW_ANONYMOUS_LINKS && !req.user) {
    res.redirect("/login");
    return;
  }
  res.render("homepage", {
    title: "Free modern URL shortener",
  });
}

async function login(req, res) {
  if (req.user) {
    res.redirect("/");
    return;
  }
  
  res.render("login", {
    title: "Log in"
  });
}

async function signup(req, res) {
  if (req.user) {
    res.redirect("/");
    return;
  }
  if (env.DISALLOW_REGISTRATION) {
    res.redirect("/login");
    return;
  }

  res.render("signup", {
    title: "Sign up"
  });
}

async function logout(req, res) {
  if (!req.user) {
    utils.deleteCurrentToken(res);
    res.redirect("/login");
    return;
  }
  res.render("logout", {
    title: "Log out",
    logged_out: false,
  });
}

async function createAdmin(req, res) {
  const isThereAUser = await query.user.findAny();
  if (isThereAUser) {
    res.redirect("/login");
    return;
  }
  res.render("create_admin", {
    title: "Create admin account"
  });
}

function notFound(req, res) {
  res.status(404).render("404", {
    title: "404 - Not found"
  });
}

function settings(req, res) {
  res.render("settings", {
    title: "Settings"
  });
}

function admin(req, res) {
  res.render("admin", {
    title: "Admin"
  });
}

function stats(req, res) {
  res.render("stats", {
    title: "Stats"
  });
}

async function banned(req, res) {
  res.render("banned", {
    title: "Banned link",
  });
}

async function report(req, res) {
  if (!env.REPORT_EMAIL) {
    res.redirect("/");
    return;
  }
  res.render("report", {
    title: "Report abuse",
  });
}

async function resetPassword(req, res) {
  res.render("reset_password", {
    title: "Reset password",
  });
}

async function resetPasswordSetNewPassword(req, res) {
  const reset_password_token = req.params.resetPasswordToken;
  
  if (reset_password_token) {
    const user = await query.user.find(
      {
        reset_password_token,
        reset_password_expires: [">", utils.dateToUTC(new Date())]
      }
    );
    if (user) {
      res.locals.token_verified = true;
    }
  }

  
  res.render("reset_password_set_new_password", {
    title: "Reset password",
    ...(res.locals.token_verified && { reset_password_token }),
  });
}

async function verifyChangeEmail(req, res) {
  res.render("verify_change_email", {
    title: "Verifying email",
  });
}

async function verify(req, res) {
  res.render("verify", {
    title: "Verify",
  });
}

async function terms(req, res) {
  res.render("terms", {
    title: "Terms of Service",
  });
}

/**
*
* PARTIALS
*
**/

async function confirmLinkDelete(req, res) {
  const uuid = getQueryUUID(req);
  const link = uuid
    ? await query.link.find({
        uuid,
        ...(!req.user.admin && { user_id: req.user.id })
      })
    : null;
  if (!link) {
    return res.render("partials/links/dialog/message", {
      layout: false,
      message: "Could not find the link."
    });
  }
  res.render("partials/links/dialog/delete", {
    layout: false,
    link: utils.getShortURL(link.address, link.domain).link,
    id: link.uuid
  });
}

async function confirmLinksDelete(req, res) {
  const body = req.body || {};
  const all = body.all === true || body.all === "true" || body.all === "1" || body.all === "on";
  const domain = typeof body.domain === "string" ? body.domain.trim() : "";
  const search = typeof body.search === "string" ? body.search.trim() : "";

  const rawIds = Array.isArray(body.ids)
    ? body.ids
    : (typeof body.ids === "string" && body.ids.trim() ? [body.ids.trim()] : []);
  const ids = [...new Set(rawIds.filter(id => typeof id === "string" && UUID_REGEX.test(id.trim())).map(id => id.trim()))].slice(0, 500);

  if (!all && ids.length === 0) {
    return res.render("partials/links/dialog/message", {
      layout: false,
      message: "No links selected to delete."
    });
  }

  const match = { user_id: req.user.id };
  const params = all ? { domain, search } : { uuids: ids };
  const count = await query.link.total(match, params);

  if (!count) {
    return res.render("partials/links/dialog/message", {
      layout: false,
      message: "Could not find any matching links to delete."
    });
  }

  res.render("partials/links/dialog/bulk_delete", {
    layout: false,
    count,
    count_formatted: count.toLocaleString("en-US"),
    is_plural: count !== 1,
    all,
    ids,
    domain,
    search,
  });
}

async function confirmLinkBan(req, res) {
  const uuid = getQueryUUID(req);
  const link = uuid
    ? await query.link.find({
        uuid,
        ...(!req.user.admin && { user_id: req.user.id })
      })
    : null;
  if (!link) {
    return res.render("partials/links/dialog/message", {
      message: "Could not find the link."
    });
  }
  res.render("partials/links/dialog/ban", {
    link: utils.getShortURL(link.address, link.domain).link,
    id: link.uuid
  });
}

async function confirmUserDelete(req, res) {
  const id = getQueryNumericId(req);
  const user = id !== null ? await query.user.find({ id }) : null;
  if (!user) {
    return res.render("partials/admin/dialog/message", {
      layout: false,
      message: "Could not find the user."
    });
  }
  res.render("partials/admin/dialog/delete_user", {
    layout: false,
    email: user.email,
    id: user.id
  });
}

async function confirmUserBan(req, res) {
  const id = getQueryNumericId(req);
  const user = id !== null ? await query.user.find({ id }) : null;
  if (!user) {
    return res.render("partials/admin/dialog/message", {
      layout: false,
      message: "Could not find the user."
    });
  }
  res.render("partials/admin/dialog/ban_user", {
    layout: false,
    email: user.email,
    id: user.id
  });
}

async function createUser(req, res) {
  res.render("partials/admin/dialog/create_user", {
    layout: false,
  });
}

async function addDomainAdmin(req, res) {
  res.render("partials/admin/dialog/add_domain", {
    layout: false,
  });
}

async function addDomainForm(req, res) {
  res.render("partials/settings/domain/add_form");
}

async function confirmDomainDelete(req, res) {
  const uuid = getQueryUUID(req);
  const domain = uuid
    ? await query.domain.find({
        uuid,
        user_id: req.user.id
      })
    : null;
  if (!domain) {
    return res.render("partials/settings/domain/delete", {
      error: "Could not find the domain."
    });
  }
  res.render("partials/settings/domain/delete", {
    ...utils.sanitize.domain(domain)
  });
}

async function confirmDomainBan(req, res) {
  const id = getQueryNumericId(req);
  const domain = id !== null ? await query.domain.find({ id }) : null;
  if (!domain) {
    return res.render("partials/admin/dialog/message", {
      layout: false,
      message: "Could not find the domain."
    });
  }
  const hasUser = !!domain.user_id;
  const hasLink = await query.link.find({ domain_id: domain.id });
  res.render("partials/admin/dialog/ban_domain", {
    id: domain.id,
    address: domain.address,
    hasUser,
    hasLink,
  });
}

async function confirmDomainDeleteAdmin(req, res) {
  const id = getQueryNumericId(req);
  const domain = id !== null ? await query.domain.find({ id }) : null;
  if (!domain) {
    return res.render("partials/admin/dialog/message", {
      layout: false,
      message: "Could not find the domain."
    });
  }
  const hasLink = await query.link.find({ domain_id: domain.id });
  res.render("partials/admin/dialog/delete_domain", {
    id: domain.id,
    address: domain.address,
    hasLink,
  });
}

async function getReportEmail(req, res) {
  if (!env.REPORT_EMAIL) {
    throw new utils.CustomError("No report email is available.", 400);
  }
  res.render("partials/report/email", {
    report_email_address: env.REPORT_EMAIL.replace("@", "[at]")
  });
}

async function getSupportEmail(req, res) {
  if (!env.CONTACT_EMAIL) {
    throw new utils.CustomError("No support email is available.", 400);
  }
  res.render("partials/support_email", {
    email: env.CONTACT_EMAIL,
  });
}

async function linkEdit(req, res) {
  const link = await query.link.find({
    uuid: req.params.id,
    ...(!req.user.admin && { user_id: req.user.id })
  });
  res.render("partials/links/edit", {
    ...(link && utils.sanitize.link_html(link)),
    domain: link?.domain || env.DEFAULT_DOMAIN,
  });
}

async function linkEditAdmin(req, res) {
  const link = await query.link.find({
    uuid: req.params.id,
  });
  res.render("partials/admin/links/edit", {
    ...(link && utils.sanitize.link_html(link)),
    domain: link?.domain || env.DEFAULT_DOMAIN,
  });
}

module.exports = {
  addDomainAdmin,
  addDomainForm,
  admin,
  banned,
  confirmDomainBan,
  confirmDomainDelete,
  confirmDomainDeleteAdmin,
  confirmLinkBan,
  confirmLinkDelete,
  confirmLinksDelete,
  confirmUserBan,
  confirmUserDelete,
  createAdmin,
  createUser,
  getReportEmail,
  getSupportEmail,
  homepage,
  linkEdit,
  linkEditAdmin,
  login,
  logout,
  notFound,
  report,
  resetPassword,
  resetPasswordSetNewPassword,
  settings,
  signup,
  stats,
  terms,
  verifyChangeEmail,
  verify,
}
