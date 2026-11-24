const { differenceInSeconds } = require("date-fns");
const promisify = require("node:util").promisify;
const bcrypt = require("bcryptjs");
const { isbot } = require("isbot");
const dns = require("node:dns");

const validators = require("./validators.handler");
const map = require("../utils/map.json");
const transporter = require("../mail");
const query = require("../queries");
const queue = require("../queues");
const utils = require("../utils");
const env = require("../env");

const CustomError = utils.CustomError;
const dnsLookup = promisify(dns.lookup);

async function get(req, res) {
  const { limit, skip } = req.context;
  const search = req.query.search;
  const domain = req.query.domain;
  const userId = req.user.id;

  const match = {
    user_id: userId
  };

  const [data, total] = await Promise.all([
    query.link.get(match, { limit, search, domain, skip }),
    query.link.total(match, { search, domain })
  ]);

  if (req.isHTML) {
    res.render("partials/links/table", {
      total,
      limit,
      skip,
      links: data.map(utils.sanitize.link_html),
    })
    return;
  }

  return res.send({
    total,
    limit,
    skip,
    data: data.map(utils.sanitize.link),
  });
};

async function getAdmin(req, res) {
  const { limit, skip } = req.context;
  const search = req.query.search;
  const user = req.query.user;
  let domain = req.query.domain;
  const banned = utils.parseBooleanQuery(req.query.banned);
  const anonymous = utils.parseBooleanQuery(req.query.anonymous);
  const has_domain = utils.parseBooleanQuery(req.query.has_domain);
  
  const match = {
    ...(banned !== undefined && { banned }),
    ...(anonymous !== undefined && { user_id: [anonymous ? "is" : "is not", null] }),
    ...(has_domain !== undefined && { domain_id: [has_domain ? "is not" : "is", null] }),
  };
  
  // if domain is equal to the defualt domain,
  // it means admins is looking for links with the defualt domain (no custom user domain)
  if (domain === env.DEFAULT_DOMAIN) {
    domain = undefined;
    match.domain_id = null;
  }
  
  const [data, total] = await Promise.all([
    query.link.getAdmin(match, { limit, search, user, domain, skip }),
    query.link.totalAdmin(match, { search, user, domain })
  ]);

  const links = data.map(utils.sanitize.link_admin);

  if (req.isHTML) {
    res.render("partials/admin/links/table", {
      total,
      total_formatted: total.toLocaleString("en-US"),
      limit,
      skip,
      links,
    })
    return;
  }

  return res.send({
    total,
    limit,
    skip,
    data: links,
  });
};

async function create(req, res) {
  const { reuse, password, customurl, description, target, expire_in } = req.body;
  let fetched_domain = req.validatedDomain || null;

  if (!fetched_domain && !req.domainExplicit && req.user?.default_domain_id) {
    const defaultDomain = await query.domain.find({ id: req.user.default_domain_id });
    const canUseOwn = !env.DISALLOW_CUSTOM_DOMAINS || req.user.admin;
    if (defaultDomain && !defaultDomain.banned && (defaultDomain.shared || (canUseOwn && defaultDomain.user_id === req.user.id))) {
      fetched_domain = defaultDomain;
    }
  }

  const domain_id = fetched_domain ? fetched_domain.id : null;
  
  const targetDomain = utils.removeWww(URL.parse(target)?.hostname);
  
  const tasks = await Promise.all([
    reuse &&
      query.link.find({
        target,
        user_id: req.user.id,
        domain_id
      }),
    customurl &&
      query.link.find({
        address: customurl,
        domain_id
      }),
    !customurl && utils.generateId(query, domain_id),
    validators.bannedDomain(targetDomain),
    validators.bannedHost(targetDomain)
  ]);
  
  // if "reuse" is true, try to return
  // the existent URL without creating one
  if (tasks[0]) {
    return res.json(utils.sanitize.link(tasks[0]));
  }
  
  // Check if custom link already exists
  if (tasks[1]) {
    const error = "Custom URL is already in use.";
    res.locals.errors = { customurl: error };
    throw new CustomError(error, 400);
  }

  // Create new link (retry on rare concurrent auto-generated slug collision)
  let address = customurl || tasks[2];
  let link;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      link = await query.link.create({
        password,
        address,
        domain_id,
        description,
        target,
        expire_in,
        user_id: req.user && req.user.id
      });
      break;
    } catch (err) {
      if (!utils.isUniqueConstraintError(err)) {
        throw err;
      }
      if (customurl) {
        const error = "Custom URL is already in use.";
        res.locals.errors = { customurl: error };
        throw new CustomError(error, 400);
      }
      if (attempt === 2) {
        throw new CustomError("Could not generate a unique short link. Please try again.", 500);
      }
      address = await utils.generateId(query, domain_id);
    }
  }

  link.domain = fetched_domain?.address;
  
  if (req.isHTML) {
    res.setHeader("HX-Trigger", "reloadMainTable");
    res.setHeader("HX-Trigger-After-Swap", "resetShortenerForm");
    const shortURL = utils.getShortURL(link.address, link.domain);
    return res.render("partials/shortener", {
      link: shortURL.link, 
      url: shortURL.url,
    });
  }
  
  return res
    .status(201)
    .send(utils.sanitize.link({ ...link }));
}

async function editLink(req, res, { template, sanitizeHtml }) {
  const link = await query.link.find({
    uuid: req.params.id,
    ...(!req.user.admin && { user_id: req.user.id })
  });

  if (!link) {
    throw new CustomError("Link was not found.");
  }

  let isChanged = false;
  [
    [req.body.address, "address"],
    [req.body.target, "target"],
    [req.body.description, "description"],
    [req.body.expire_in, "expire_in"],
    [req.body.password, "password"]
  ].forEach(([value, name]) => {
    if (value === undefined) {
      delete req.body[name];
      return;
    }
    if (value === "" || value === null) {
      if (name === "password" && link.password) {
        req.body.password = null;
        isChanged = true;
      } else if (name === "description" && link.description) {
        req.body.description = null;
        isChanged = true;
      } else if (
        name === "expire_in" &&
        link.expire_in &&
        differenceInSeconds(utils.parseDatetime(link.expire_in), new Date()) >= 60
      ) {
        req.body.expire_in = null;
        isChanged = true;
      } else {
        delete req.body[name];
      }
      return;
    }
    if (value === link[name] && name !== "password") {
      delete req.body[name];
      return;
    }
    if (name === "expire_in" && link.expire_in) {
      if (Math.abs(differenceInSeconds(utils.parseDatetime(value), utils.parseDatetime(link.expire_in))) < 60) {
        delete req.body.expire_in;
        return;
      }
    }
    if (name === "password") {
      if (value && value.replace(/•/ig, "").length === 0) {
        delete req.body.password;
        return;
      }
    }
    isChanged = true;
  });

  if (!isChanged) {
    throw new CustomError("Should at least update one field.");
  }

  const { address, target, description, expire_in, password } = req.body;

  const targetDomain = target && utils.removeWww(URL.parse(target)?.hostname);
  const domain_id = link.domain_id || null;

  const tasks = await Promise.all([
    address &&
      query.link.find({
        address,
        domain_id
      }),
    target && validators.bannedDomain(targetDomain),
    target && validators.bannedHost(targetDomain)
  ]);

  // Check if custom link already exists
  if (tasks[0]) {
    const error = "Custom URL is already in use.";
    res.locals.errors = { address: error };
    throw new CustomError(error, 400);
  }

  // Update link
  let updatedLink;
  try {
    [updatedLink] = await query.link.update(
      {
        id: link.id
      },
      {
        ...(address && { address }),
        ...((description || description === null) && { description }),
        ...(target && { target }),
        ...((expire_in || expire_in === null) && { expire_in }),
        ...((password || password === null) && { password })
      }
    );
  } catch (err) {
    if (utils.isUniqueConstraintError(err)) {
      const error = "Custom URL is already in use.";
      res.locals.errors = { address: error };
      throw new CustomError(error, 400);
    }
    throw err;
  }

  if (req.isHTML) {
    res.render(template, {
      swap_oob: true,
      success: "Link has been updated.",
      ...sanitizeHtml({ ...updatedLink }),
    });
    return;
  }

  return res.status(200).send(utils.sanitize.link({ ...updatedLink }));
}

function edit(req, res) {
  return editLink(req, res, {
    template: "partials/links/edit",
    sanitizeHtml: utils.sanitize.link_html,
  });
}

function editAdmin(req, res) {
  return editLink(req, res, {
    template: "partials/admin/links/edit",
    sanitizeHtml: utils.sanitize.link_admin,
  });
}

async function remove(req, res) {
  const { error, isRemoved, link } = await query.link.remove({
    uuid: req.params.id,
    ...(!req.user.admin && { user_id: req.user.id })
  });

  if (!isRemoved) {
    const messsage = error || "Could not delete the link.";
    throw new CustomError(messsage);
  }

  if (req.isHTML) {
    res.setHeader("HX-Reswap", "outerHTML");
    res.setHeader("HX-Trigger", JSON.stringify({ reloadMainTable: true, linkDeleted: link.uuid }));
    res.render("partials/links/dialog/delete_success", {
      link: utils.getShortURL(link.address, link.domain).link,
    });
    return;
  }

  return res
    .status(200)
    .send({ message: "Link has been deleted successfully." });
};

async function bulkRemove(req, res) {
  const { all, domain, search, ids } = req.body;
  const match = {
    user_id: req.user.id
  };

  const params = all
    ? { domain, search }
    : { uuids: ids };

  const { count } = await query.link.batchRemoveFiltered(match, params);

  if (!count) {
    throw new CustomError("Could not find any matching links to delete.", 404);
  }

  if (req.isHTML) {
    res.setHeader("HX-Reswap", "outerHTML");
    res.setHeader("HX-Trigger", "reloadMainTable, clearLinkSelection");
    res.render("partials/links/dialog/bulk_delete_success", {
      count,
      count_formatted: count.toLocaleString("en-US"),
      is_plural: count !== 1,
    });
    return;
  }

  return res.status(200).send({
    message: count === 1
      ? "1 link has been deleted successfully."
      : `${count} links have been deleted successfully.`,
    count,
  });
};

async function report(req, res) {
  const { link } = req.body;

  await transporter.sendReportEmail(link);

  if (req.isHTML) {
    res.render("partials/report/form", {
      message: "Report was received. We'll take actions shortly."
    });
    return;
  }
  
  return res
    .status(200)
    .send({ message: "Thanks for the report, we'll take actions shortly." });
};

async function ban(req, res) {
  const { id } = req.params;

  const update = {
    banned_by_id: req.user.id,
    banned: true
  };

  // 1. check if link exists
  const link = await query.link.find({ uuid: id });

  if (!link) {
    throw new CustomError("No link has been found.", 400);
  }

  if (link.banned) {
    throw new CustomError("Link has been banned already.", 400);
  }

  const tasks = [];

  // 2. ban link
  tasks.push(query.link.update({ uuid: id }, update));

  const domain = utils.removeWww(URL.parse(link.target)?.hostname);

  // 3. ban target's domain
  if (req.body.domain && domain) {
    tasks.push(query.domain.add({ ...update, address: domain }));
  }

  // 4. ban target's host
  if (req.body.host && domain) {
    const dnsRes = await dnsLookup(domain).catch(() => {
      throw new CustomError("Couldn't fetch DNS info.");
    });
    const host = dnsRes?.address;
    if (host) {
      tasks.push(query.host.add({ ...update, address: host }));
    }
  }

  // 5. ban link owner (guard against banning self or admin accounts)
  if (req.body.user && link.user_id && link.user_id !== req.user.id) {
    const owner = await query.user.find({ id: link.user_id });
    if (owner && !utils.isAdmin(owner)) {
      tasks.push(query.user.update({ id: link.user_id }, { ...update, apikey: null }, { increments: ["token_version"] }));
    }
  }

  // 6. ban all of owner's links
  if (req.body.userLinks && link.user_id) {
    tasks.push(query.link.update({ user_id: link.user_id }, update));
  }

  // 7. wait for all tasks to finish
  await Promise.all(tasks).catch((err) => {
    throw new CustomError("Couldn't ban entries.");
  });

  // 8. send response
  if (req.isHTML) {
    res.setHeader("HX-Reswap", "outerHTML");
    res.setHeader("HX-Trigger", "reloadMainTable");
    res.render("partials/links/dialog/ban_success", {
      link: utils.getShortURL(link.address, link.domain).link,
    });
    return;
  }

  return res.status(200).send({ message: "Banned link successfully." });
};

function getTrustedCountryHeader(req) {
  if (!env.TRUST_CF_HEADERS) return undefined;
  const raw = req.get("cf-ipcountry");
  if (typeof raw !== "string") return undefined;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return undefined;
  return code;
}

async function redirect(req, res, next) {
  const isPreservedUrl = utils.preservedURLs.some(
    item => item === req.path.replace("/", "")
  );

  if (isPreservedUrl) return next();

  // 1. If custom domain, get domain info
  const defaultHost = utils.removeWww(env.DEFAULT_DOMAIN.replace(/^https?:\/\//i, "").replace(/\/+$/, "")).toLowerCase();
  const host = utils.removeWww(req.headers.host)?.toLowerCase();
  const isCustomHost = !!host && host !== defaultHost;
  const domain = isCustomHost
    ? await query.domain.find({ address: host })
    : null;

  // Do not fall back to default domain links when accessed via an unknown custom domain
  if (isCustomHost && !domain) {
    return res.redirect("/404");
  }

  // If custom domain itself is banned, redirect to banned page
  if (domain?.banned) {
    return res.redirect("/banned");
  }

  // 2. Get link
  const address = req.params.id.replace("+", "");
  const link = await query.link.find({
    address,
    domain_id: domain ? domain.id : null
  });

  // 3. When no link, or link is expired, if has domain redirect to domain's homepage
  // otherwise redirect to 404
  const isExpired = link?.expire_in && utils.parseDatetime(link.expire_in) < new Date();
  if (!link || isExpired) {
    const fallbackUrl = domain?.homepage && utils.isSafeUrl(domain.homepage) ? domain.homepage : "/404";
    return res.redirect(fallbackUrl);
  }

  // 4. If link is banned, redirect to banned page.
  if (link.banned) {
    return res.redirect("/banned");
  }

  // Defense-in-depth: ensure target URL is safe before redirecting
  if (!utils.isSafeUrl(link.target, { allowCustomProtocols: true })) {
    return res.redirect("/404");
  }

  // 5. If wants to see link info, then redirect
  const isRequestingInfo = /.*\+$/gi.test(req.params.id);
  if (isRequestingInfo && !link.password) {
    if (req.isHTML) {
      res.render("url_info", { 
        title: "Short link information",
        target: link.target,
        link: utils.getShortURL(link.address, link.domain).link
      });
      return;
    }
    return res.send({ target: link.target });
  }

  // 6. If link is protected, redirect to password page
  if (link.password) {
    if ("authorization" in req.headers) {
      const auth = req.headers.authorization;
      const firstSpace = auth.indexOf(" ");
      if (firstSpace !== -1) {
        const method = auth.slice(0, firstSpace);
        const payload = auth.slice(firstSpace + 1);
        if (method.toLowerCase() === "basic") {
          const decoded = Buffer.from(payload, "base64").toString("utf8");
          const colon = decoded.indexOf(":");
          if (colon !== -1) {
            const password = decoded.slice(colon + 1);
            const matches = await bcrypt.compare(password, link.password);
            if (matches) {
              const isBot = isbot(req.headers["user-agent"]);
              if (link.user_id && !isBot) {
                queue.visit.add({
                  userAgent: req.headers["user-agent"],
                  ip: req.ip,
                  country: getTrustedCountryHeader(req),
                  referrer: req.get("Referrer"),
                  link
                });
              }
              let redirectTarget = link.target;
              try {
                redirectTarget = new URL(link.target).href;
              } catch {}
              return res.redirect(redirectTarget);
            }
          }
        }
      }
    }
    res.render("protected", {
      title: "Protected short link",
      id: link.uuid
    });
    return;
  }

  // 7. Create link visit
  const isBot = isbot(req.headers["user-agent"]);
  if (link.user_id && !isBot) {
    queue.visit.add({
      userAgent: req.headers["user-agent"],
      ip: req.ip,
      country: getTrustedCountryHeader(req),
      referrer: req.get("Referrer"),
      link
    });
  }

  // 8. Redirect to target
  let redirectTarget = link.target;
  try {
    redirectTarget = new URL(link.target).href;
  } catch {}
  return res.redirect(redirectTarget);
};

async function redirectProtected(req, res) {
  // 1. Get link
  const uuid = req.params.id;
  const link = await query.link.find({ uuid });

  // 2. Throw error if no link or expired
  const isExpired = link?.expire_in && utils.parseDatetime(link.expire_in) < new Date();
  if (!link || !link.password || isExpired) {
    throw new CustomError("Couldn't find the link.", 400);
  }

  if (link.banned) {
    throw new CustomError("This link has been banned.", 403);
  }

  if (link.domain_id) {
    const domain = await query.domain.find({ id: link.domain_id });
    if (domain?.banned) {
      throw new CustomError("This link has been banned.", 403);
    }
  }

  if (!utils.isSafeUrl(link.target, { allowCustomProtocols: true })) {
    throw new CustomError("Target URL is not valid.", 400);
  }

  // 3. Check if password matches
  const matches = await bcrypt.compare(req.body.password, link.password);

  if (!matches) {
    throw new CustomError("Password is not correct.", 401);
  }

  // 4. Create visit
  if (link.user_id) {
    queue.visit.add({
      userAgent: req.headers["user-agent"],
      ip: req.ip,
      country: getTrustedCountryHeader(req),
      referrer: req.get("Referrer"),
      link
    });
  }

  // 5. Send target
  let redirectTarget = link.target;
  try {
    redirectTarget = new URL(link.target).href;
  } catch {}

  if (req.isHTML) {
    if (req.headers["hx-request"]) {
      res.setHeader("HX-Redirect", redirectTarget);
      res.render("partials/protected/form", {
        id: link.uuid,
        message: "Redirecting...",
      });
      return;
    }
    return res.redirect(redirectTarget);
  }
  return res.status(200).send({ target: link.target });
};

async function redirectCustomDomainHomepage(req, res, next) {
  const defaultHost = utils.removeWww(env.DEFAULT_DOMAIN.replace(/^https?:\/\//i, "").replace(/\/+$/, "")).toLowerCase();
  const host = utils.removeWww(req.headers.host)?.toLowerCase();
  if (!host || host === defaultHost) {
    next();
    return;
  }

  // Allow unlocking password-protected links and footer support email on custom/shared domains
  if (
    (req.method === "POST" && /^\/api(?:\/v2)?\/links\/[^/]+\/protected\/?$/.test(req.path)) ||
    (req.method === "GET" && req.path === "/get-support-email")
  ) {
    next();
    return;
  }

  const path = req.path;
  const pathName = path.replace("/", "").split("/")[0];
  if (
    path === "/" ||
    utils.preservedURLs.includes(pathName)
  ) {
    const domain = await query.domain.find({ address: host });
    if (domain?.banned) {
      if (path !== "/banned") {
        res.redirect(302, "/banned");
        return;
      }
    } else if (domain?.homepage && utils.isSafeUrl(domain.homepage)) {
      res.redirect(302, domain.homepage);
      return;
    }
  }

  next();
};

async function stats(req, res) {
  const { user } = req;
  const uuid = req.params.id;

  const link = await query.link.find({
    ...(!user.admin && { user_id: user.id }),
    uuid
  });

  if (!link) {
    if (req.isHTML) {
      res.setHeader("HX-Redirect", "/404");
      res.status(200).send("");
      return;
    }
    throw new CustomError("Link could not be found.");
  }

  const stats = await query.visit.find({ link_id: link.id }, link.visit_count);

  if (!stats) {
    throw new CustomError("Could not get the short link stats. Try again later.");
  }

  if (req.isHTML) {
    res.render("partials/stats", {
      link: utils.sanitize.link_html(link),
      stats,
      map,
    });
    return;
  }

  return res.status(200).send({
    ...stats,
    ...utils.sanitize.link(link)
  });
};

module.exports = {
  ban,
  bulkRemove,
  create,
  edit,
  editAdmin,
  get,
  getAdmin,
  remove,
  report,
  stats,
  redirect,
  redirectProtected,
  redirectCustomDomainHomepage,
}