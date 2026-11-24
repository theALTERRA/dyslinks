const { Handler } = require("express");

const { CustomError, sanitize } = require("../utils");
const locals = require("./locals.handler");
const query = require("../queries");
const redis = require("../redis");
const utils = require("../utils");
const env = require("../env");

async function add(req, res) {
  const { address, homepage } = req.body;

  const domain = await query.domain.add({
    address,
    homepage,
    user_id: req.user.id
  });

  if (req.isHTML) {
    const [ownDomains, availableDomains] = await Promise.all([
      query.domain.get({ user_id: req.user.id }),
      query.domain.getForUser(req.user.id)
    ]);
    res.setHeader("HX-Reswap", "none");
    res.setHeader("HX-Trigger-After-Swap", "closeAddDomainForm");
    res.render("partials/settings/domain/table", {
      domains: ownDomains.map(sanitize.domain),
      shortener_domains: availableDomains.map(sanitize.domain),
      user_default_domain: locals.resolveUserDefaultDomain(req.user, availableDomains),
      swap_oob_default: true,
    });
    return;
  }
  
  return res.status(200).send(sanitize.domain(domain));
};

async function addAdmin(req, res) {
  const { address, banned, homepage, shared } = req.body;

  const domain = await query.domain.add({
    address,
    homepage,
    banned,
    shared: !banned && !!shared,
    ...(banned && { banned_by_id: req.user.id })
  });

  if (req.isHTML) {
    res.setHeader("HX-Trigger", "reloadMainTable");
    res.render("partials/admin/dialog/add_domain_success", {
      address: domain.address,
    });
    return;
  }
  
  return res.status(200).send({ message: "The domain has been added successfully." });
};

async function remove(req, res) {
  const domain = await query.domain.find({
    uuid: req.params.id,
    user_id: req.user.id
  });

  if (!domain) {
    throw new CustomError("Could not delete the domain.", 400);
  }
  
  const [updatedDomain] = await query.domain.update(
    { id: domain.id },
    { user_id: null }
  );

  if (!updatedDomain) {
    throw new CustomError("Could not delete the domain.", 500);
  }

  if (!domain.shared) {
    await query.user.clearDefaultDomain(domain.id);
    if (req.user.default_domain_id === domain.id) {
      req.user.default_domain_id = null;
    }
  }

  if (env.REDIS_ENABLED) {
    redis.remove.domain(updatedDomain);
  }

  if (req.isHTML) {
    const [ownDomains, availableDomains] = await Promise.all([
      query.domain.get({ user_id: req.user.id }),
      query.domain.getForUser(req.user.id)
    ]);
    res.setHeader("HX-Reswap", "outerHTML");
    res.render("partials/settings/domain/delete_success", {
      domains: ownDomains.map(sanitize.domain),
      shortener_domains: availableDomains.map(sanitize.domain),
      user_default_domain: locals.resolveUserDefaultDomain(req.user, availableDomains),
      address: domain.address,
    });
    return;
  }

  return res.status(200).send({ message: "Domain deleted successfully" });
};

async function removeAdmin(req, res) {
  const id = req.params.id;
  const links = req.query.links

  const domain = await query.domain.find({ id });

  if (!domain) {
    throw new CustomError("Could not find the domain.", 400);
  }

  if (links) {
    await query.link.batchRemove({ domain_id: domain.id });
  } else {
    await query.link.update({ domain_id: domain.id }, { domain_id: null });
  }
  
  await query.user.clearDefaultDomain(domain.id);
  await query.domain.remove(domain);

  if (req.isHTML) {
    res.setHeader("HX-Reswap", "outerHTML");
    res.setHeader("HX-Trigger", "reloadMainTable");
    res.render("partials/admin/dialog/delete_domain_success", {
      address: domain.address,
    });
    return;
  }

  return res.status(200).send({ message: "Domain deleted successfully" });
}

async function getAdmin(req, res) {
  const { limit, skip } = req.context;
  const search = req.query.search;
  const user = req.query.user;
  const banned = utils.parseBooleanQuery(req.query.banned);
  const owner = utils.parseBooleanQuery(req.query.owner);
  const links = utils.parseBooleanQuery(req.query.links);
  const shared = utils.parseBooleanQuery(req.query.shared);

  const match = {
    ...(banned !== undefined && { banned }),
    ...(shared !== undefined && { shared }),
    ...(owner !== undefined && { user_id: [owner ? "is not" : "is", null] }),
  };

  const [data, total] = await Promise.all([
    query.domain.getAdmin(match, { limit, search, user, links, skip }),
    query.domain.totalAdmin(match, { search, user, links })
  ]);

  const domains = data.map(utils.sanitize.domain_admin);

  if (req.isHTML) {
    res.render("partials/admin/domains/table", {
      total,
      total_formatted: total.toLocaleString("en-US"),
      limit,
      skip,
      table_domains: domains,
    })
    return;
  }

  return res.send({
    total,
    limit,
    skip,
    data: domains,
  });
}

async function ban(req, res) {
  const { id } = req.params;

  const update = {
    banned_by_id: req.user.id,
    banned: true,
  };

  // 1. check if domain exists
  const domain = await query.domain.find({ id });

  if (!domain) {
    throw new CustomError("No domain has been found.", 400);
  }

  if (domain.banned) {
    throw new CustomError("Domain has been banned already.", 400);
  }

  const tasks = [];

  // 2. ban domain
  tasks.push(query.domain.update({ id }, { ...update, shared: false }));
  tasks.push(query.user.clearDefaultDomain(domain.id));
  
  // 3. ban user
  if (req.body.user && domain.user_id) {
    tasks.push(query.user.update({ id: domain.user_id }, update));
  }
  
  // 4. ban links
  if (req.body.links) {
    tasks.push(query.link.update({ domain_id: id }, update));
  }
  
  // 5. wait for all tasks to finish
  await Promise.all(tasks).catch((err) => {
    throw new CustomError("Couldn't ban entries.");
  });

  // 6. send response
  if (req.isHTML) {
    res.setHeader("HX-Reswap", "outerHTML");
    res.setHeader("HX-Trigger", "reloadMainTable");
    res.render("partials/admin/dialog/ban_domain_success", {
      address: domain.address,
    });
    return;
  }

  return res.status(200).send({ message: "Banned domain successfully." });
}

async function toggleShare(req, res) {
  const { id } = req.params;

  const domain = await query.domain.find({ id });

  if (!domain) {
    throw new CustomError("No domain has been found.", 400);
  }

  if (domain.banned) {
    throw new CustomError("Cannot share a banned domain.", 400);
  }

  const nextShared = !domain.shared;
  await query.domain.update({ id }, { shared: nextShared });
  if (!nextShared) {
    await query.user.clearDefaultDomain(domain.id, domain.user_id);
  }

  if (req.isHTML) {
    res.setHeader("HX-Trigger", "reloadMainTable");
    return res.status(200).send("");
  }

  return res.status(200).send({
    shared: nextShared,
    message: nextShared ? "Domain is now shared with all users." : "Domain is no longer shared."
  });
}

module.exports = {
  add,
  addAdmin,
  ban,
  getAdmin,
  remove,
  removeAdmin,
  toggleShare,
}