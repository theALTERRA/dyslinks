const { addMinutes } = require("date-fns");
const { randomUUID } = require("node:crypto");

const { ROLES } = require("../consts");
const utils = require("../utils");
const redis = require("../redis");
const knex = require("../knex");
const env = require("../env");

const ALLOWED_QUERY_OPERATORS = new Set(["=", "!=", "<", ">", "<=", ">=", "is", "is not"]);

function applyMatchConditions(queryBuilder, match) {
  Object.entries(match).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length === 2 && ALLOWED_QUERY_OPERATORS.has(String(value[0]).toLowerCase())) {
        queryBuilder.andWhere(key, value[0], value[1]);
      } else {
        throw new Error(`Invalid query condition for ${key}`);
      }
    } else {
      queryBuilder.andWhere(key, value);
    }
  });
}

async function find(match) {
  const matchKeys = Object.keys(match);
  const isPureIdLookup = matchKeys.length === 1 && matchKeys[0] === "id" && match.id !== undefined && match.id !== null;
  const isPureApiKeyLookup =
    matchKeys.length === 1 &&
    matchKeys[0] === "apikey" &&
    typeof match.apikey === "string" &&
    match.apikey.length > 0;

  if (env.REDIS_ENABLED && (isPureIdLookup || isPureApiKeyLookup)) {
    const cacheKey = isPureIdLookup
      ? redis.key.userById(match.id)
      : redis.key.userByApiKey(match.apikey);
    const cachedUser = await redis.safeGetJSON(cacheKey);
    if (cachedUser) {
      if (isPureIdLookup && String(cachedUser.id) === String(match.id)) {
        return cachedUser;
      }
      if (isPureApiKeyLookup && utils.timingSafeStringEqual(cachedUser.apikey, match.apikey)) {
        return cachedUser;
      }
    }
  }

  const query = knex("users");
  applyMatchConditions(query, match);

  const user = await query.first();

  if (user && env.REDIS_ENABLED) {
    if (isPureIdLookup) {
      redis.safeSet(redis.key.userById(user.id), user, 60 * 15);
    }
    if (isPureApiKeyLookup && user.apikey) {
      redis.safeSet(redis.key.userByApiKey(user.apikey), user, 60 * 15);
    }
  }

  return user;
}

async function add(params, user) {
  const data = {
    email: params.email,
    password: params.password,
    ...(params.role && { role: params.role }),
    ...(params.verified !== undefined && { verified: params.verified }),
    verification_token: randomUUID(),
    verification_expires: utils.dateToUTC(addMinutes(new Date(), 60))
  };
  
  if (user) {
    await knex("users")
      .where("id", user.id)
      .update({ ...data, updated_at: utils.dateToUTC(new Date()) });
  } else {
    await knex("users").insert(data);
  }
  
  if (env.REDIS_ENABLED) {
    redis.remove.user(user);
  }
  
  return {
    ...user,
    ...data
  };
}

async function update(match, update, methods) {
  const { user, updated_user } = await knex.transaction(async function(trx) {
    const query = trx("users");
    applyMatchConditions(query, match);

    const user = await query.select("id", "apikey").first();
    if (!user) return {};
    
    const updateQuery = trx("users").where("id", user.id);
    if (methods?.increments) {
      methods.increments.forEach(columnName => {
        updateQuery.increment(columnName);
      });
    }
    
    await updateQuery.update({ ...update, updated_at: utils.dateToUTC(new Date()) });
    const updated_user = await trx("users").where("id", user.id).first();

    return { user, updated_user };
  });

  if (env.REDIS_ENABLED && user) {
    redis.remove.user(user);
    redis.remove.user(updated_user);
  }

  return updated_user;
}

async function remove(user) {
  let userLinks = [];
  let userDomains = [];
  if (env.REDIS_ENABLED) {
    [userLinks, userDomains] = await Promise.all([
      knex("links").select("address", "domain_id").where("user_id", user.id),
      knex("domains").select("address").where("user_id", user.id),
    ]);
  }

  const deletedUser = await knex("users").where("id", user.id).delete();
  
  if (env.REDIS_ENABLED) {
    redis.remove.user(user);
    userLinks.forEach(redis.remove.link);
    userDomains.forEach(redis.remove.domain);
  }
  
  return !!deletedUser;
}

const selectable_admin = [
  "users.id",
  "users.email",
  "users.verified",
  "users.role",
  "users.banned",
  "users.banned_by_id",
  "users.created_at",
  "users.updated_at"
];

function normalizeMatch(match) {
  const newMatch = { ...match }

  if (newMatch.banned !== undefined) {
    newMatch["users.banned"] = newMatch.banned;
    delete newMatch.banned;
  }

  return newMatch;
}

async function getAdmin(match, params) {
  const query = knex("users")
    .select(...selectable_admin)
    .select("l.links_count")
    .select("d.domains")
    .fromRaw("users")
    .where(normalizeMatch(match))
    .offset(params.skip)
    .limit(params.limit)
    .orderBy("users.id", "desc")
    .groupBy(1)
    .groupBy("l.links_count")
    .groupBy("d.domains");
  
  if (params?.search) {
    const isNumericId = /^\d+$/.test(String(params.search).trim());
    if (!isNumericId) {
      query[knex.compatibleILIKE]("users.email", "%" + params.search + "%");
    } else {
      query.andWhere("users.id", parseInt(params.search, 10));
    }
  }

  if (params?.domains !== undefined) {
    query.andWhere("d.domains", params?.domains ? "is not" : "is", null);
  }

  if (params?.links !== undefined) {
    query.andWhere("links_count", params?.links ? "is not" : "is", null);
  }
  
  query.leftJoin(
    knex("domains")
    .select("user_id", knex.isMySQL
      ? knex.raw("group_concat(address SEPARATOR ', ') AS domains")
      : knex.raw("string_agg(address, ', ') AS domains")
    )
    .groupBy("user_id").as("d"),
    "users.id",
    "d.user_id"
  )
  query.leftJoin(
    knex("links").select("user_id").count("* as links_count").groupBy("user_id").as("l"),
    "users.id",
    "l.user_id"
  );

  return query;
}

async function totalAdmin(match, params) {
  const query = knex("users")
    .count("* as count")
    .fromRaw("users")
    .where(normalizeMatch(match));

  if (params?.search) {
    const isNumericId = /^\d+$/.test(String(params.search).trim());
    if (!isNumericId) {
      query[knex.compatibleILIKE]("users.email", "%" + params.search + "%");
    } else {
      query.andWhere("users.id", parseInt(params.search, 10));
    }
  }

  if (params?.domains !== undefined) {
    query.andWhere("domains", params?.domains ? "is not" : "is", null);
    query.leftJoin(
      knex("domains")
        .select("user_id", knex.isMySQL
          ? knex.raw("group_concat(address SEPARATOR ', ') AS domains")
          : knex.raw("string_agg(address, ', ') AS domains")
        )
        .groupBy("user_id").as("d"),
      "users.id",
      "d.user_id"
    );
  }

  if (params?.links !== undefined) {
    query.andWhere("links", params?.links ? "is not" : "is", null);
    query.leftJoin(
      knex("links").select("user_id").count("* as links").groupBy("user_id").as("l"),
      "users.id",
      "l.user_id"
    );
  }

  const [{ count }] = await query;

  return typeof count === "number" ? count : parseInt(count);
}

async function create(params) {
  const shouldGenerateVerification = env.MAIL_ENABLED && params.verification_email && !params.banned && !params.verified;
  let [user] = await knex("users").insert({
    email: params.email,
    password: params.password,
    role: params.role ?? ROLES.USER,
    verified: params.verified ?? false,
    banned: params.banned ?? false,
    ...(params.oidc_issuer && { oidc_issuer: params.oidc_issuer }),
    ...(params.oidc_sub && { oidc_sub: params.oidc_sub }),
    ...(shouldGenerateVerification && {
      verification_token: randomUUID(),
      verification_expires: utils.dateToUTC(addMinutes(new Date(), 60)),
    }),
  }, "*");

  // mysql doesn't return the whole user, but rather the id number only
  // so we need to fetch the user ourselves
  if (typeof user === "number") {
    user = await knex("users").where("id", user).first();
  }

  return user;
}

// check if there exists a user
async function findAny() {
  if (env.REDIS_ENABLED) {
    const anyuser = await redis.safeGetJSON("any-user");
    if (anyuser) return true;
  }

  const anyuser = await knex("users").select("id").first();

  if (env.REDIS_ENABLED && anyuser) {
    redis.safeSet("any-user", anyuser, 60 * 5);
  }

  return !!anyuser;
}

async function clearDefaultDomain(domainId, keepUserId) {
  const matchQuery = knex("users").where("default_domain_id", domainId);
  if (keepUserId) {
    matchQuery.andWhereNot("id", keepUserId);
  }

  let affectedUsers = [];
  if (env.REDIS_ENABLED) {
    affectedUsers = await matchQuery.clone().select("id", "apikey");
  }

  await matchQuery.update({
    default_domain_id: null,
    updated_at: utils.dateToUTC(new Date()),
  });

  if (env.REDIS_ENABLED && affectedUsers.length) {
    affectedUsers.forEach(redis.remove.user);
  }
}

module.exports = {
  add,
  clearDefaultDomain,
  create,
  find,
  findAny,
  getAdmin,
  remove,
  totalAdmin,
  update,
}
