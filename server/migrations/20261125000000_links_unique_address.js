/**
 * Enforces uniqueness of (address, domain_id) on the links table across
 * SQLite, PostgreSQL, and MySQL/MariaDB, including when domain_id IS NULL
 * (links on the default domain).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function up(knex) {
  const { driverName } = knex.client;
  const isMySQL = driverName === "mysql" || driverName === "mysql2";

  if (isMySQL) {
    const hasCol = await knex.schema.hasColumn("links", "domain_id_key");
    if (!hasCol) {
      await knex.raw(
        "ALTER TABLE links ADD COLUMN domain_id_key INT UNSIGNED GENERATED ALWAYS AS (IFNULL(domain_id, 0)) STORED"
      );
    }

    const [indexes] = await knex.raw(
      "SHOW INDEX FROM links WHERE Key_name = 'links_address_domain_id_unique'"
    );
    if (!Array.isArray(indexes) || indexes.length === 0) {
      await knex.raw(
        "CREATE UNIQUE INDEX links_address_domain_id_unique ON links (address, domain_id_key)"
      );
    }
    return;
  }

  // SQLite and PostgreSQL both support partial unique indexes
  await knex.raw(
    "CREATE UNIQUE INDEX IF NOT EXISTS links_address_domain_id_unique ON links (address, domain_id) WHERE domain_id IS NOT NULL;"
  );
  await knex.raw(
    "CREATE UNIQUE INDEX IF NOT EXISTS links_address_default_domain_unique ON links (address) WHERE domain_id IS NULL;"
  );
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
      "SHOW INDEX FROM links WHERE Key_name = 'links_address_domain_id_unique'"
    );
    if (Array.isArray(indexes) && indexes.length > 0) {
      await knex.raw("DROP INDEX links_address_domain_id_unique ON links");
    }

    const hasCol = await knex.schema.hasColumn("links", "domain_id_key");
    if (hasCol) {
      await knex.raw("ALTER TABLE links DROP COLUMN domain_id_key");
    }
    return;
  }

  await knex.raw("DROP INDEX IF EXISTS links_address_domain_id_unique;");
  await knex.raw("DROP INDEX IF EXISTS links_address_default_domain_unique;");
}

module.exports = {
  up,
  down,
};
