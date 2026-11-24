/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function up(knex) {
  const hasColumn = await knex.schema.hasColumn("users", "default_domain_id");
  if (!hasColumn) {
    await knex.schema.alterTable("users", table => {
      table
        .integer("default_domain_id")
        .unsigned()
        .references("id")
        .inTable("domains")
        .onDelete("SET NULL");
    });
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function down(knex) {
  const hasColumn = await knex.schema.hasColumn("users", "default_domain_id");
  if (hasColumn) {
    await knex.schema.alterTable("users", table => {
      table.dropColumn("default_domain_id");
    });
  }
}

module.exports = {
  up,
  down,
};
