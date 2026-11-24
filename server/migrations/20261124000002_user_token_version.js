/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function up(knex) {
  const hasColumn = await knex.schema.hasColumn("users", "token_version");
  if (!hasColumn) {
    await knex.schema.alterTable("users", table => {
      table
        .integer("token_version")
        .notNullable()
        .defaultTo(0);
    });
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function down(knex) {
  const hasColumn = await knex.schema.hasColumn("users", "token_version");
  if (hasColumn) {
    await knex.schema.alterTable("users", table => {
      table.dropColumn("token_version");
    });
  }
}

module.exports = {
  up,
  down,
};
