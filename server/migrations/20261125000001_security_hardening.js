const crypto = require("node:crypto");

function hashApiKey(rawKey) {
  return "sha256:" + crypto.createHash("sha256").update(String(rawKey)).digest("hex");
}

function isHashedApiKey(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

/**
 * Adds OIDC identity binding columns (oidc_issuer, oidc_sub) to users and
 * migrates any existing plaintext API keys to SHA-256 hashes.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function up(knex) {
  const hasOidcIssuer = await knex.schema.hasColumn("users", "oidc_issuer");
  const hasOidcSub = await knex.schema.hasColumn("users", "oidc_sub");

  if (!hasOidcIssuer || !hasOidcSub) {
    await knex.schema.alterTable("users", (table) => {
      if (!hasOidcIssuer) table.string("oidc_issuer");
      if (!hasOidcSub) table.string("oidc_sub");
    });
  }

  const { driverName } = knex.client;
  const isMySQL = driverName === "mysql" || driverName === "mysql2";

  if (isMySQL) {
    const [indexes] = await knex.raw(
      "SHOW INDEX FROM users WHERE Key_name = 'users_oidc_issuer_sub_unique'"
    );
    if (!Array.isArray(indexes) || indexes.length === 0) {
      await knex.raw(
        "CREATE UNIQUE INDEX users_oidc_issuer_sub_unique ON users (oidc_issuer, oidc_sub)"
      );
    }
  } else {
    await knex.raw(
      "CREATE UNIQUE INDEX IF NOT EXISTS users_oidc_issuer_sub_unique ON users (oidc_issuer, oidc_sub) WHERE oidc_issuer IS NOT NULL AND oidc_sub IS NOT NULL;"
    );
  }

  // Hash any legacy plaintext API keys in-place so existing keys continue working securely
  const usersWithKeys = await knex("users")
    .select("id", "apikey")
    .whereNotNull("apikey")
    .andWhereNot("apikey", "");

  for (const u of usersWithKeys) {
    if (!isHashedApiKey(u.apikey)) {
      await knex("users")
        .where("id", u.id)
        .update({ apikey: hashApiKey(u.apikey) });
    }
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function down(knex) {
  const { driverName } = knex.client;
  const isMySQL = driverName === "mysql" || driverName === "mysql2";

  if (isMySQL) {
    const [indexes] = await knex.raw(
      "SHOW INDEX FROM users WHERE Key_name = 'users_oidc_issuer_sub_unique'"
    );
    if (Array.isArray(indexes) && indexes.length > 0) {
      await knex.raw("DROP INDEX users_oidc_issuer_sub_unique ON users");
    }
  } else {
    await knex.raw("DROP INDEX IF EXISTS users_oidc_issuer_sub_unique;");
  }

  const hasOidcIssuer = await knex.schema.hasColumn("users", "oidc_issuer");
  const hasOidcSub = await knex.schema.hasColumn("users", "oidc_sub");
  if (hasOidcIssuer || hasOidcSub) {
    await knex.schema.alterTable("users", (table) => {
      if (hasOidcIssuer) table.dropColumn("oidc_issuer");
      if (hasOidcSub) table.dropColumn("oidc_sub");
    });
  }
}

module.exports = {
  up,
  down,
};
