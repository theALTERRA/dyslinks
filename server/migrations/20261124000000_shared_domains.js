/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function up(knex) {
  const hasShared = await knex.schema.hasColumn("domains", "shared");
  if (!hasShared) {
    await knex.schema.alterTable("domains", table => {
      table
        .boolean("shared")
        .notNullable()
        .defaultTo(false);
    });
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function down(knex) {
  const hasShared = await knex.schema.hasColumn("domains", "shared");
  if (hasShared) {
    await knex.schema.alterTable("domains", table => {
      table.dropColumn("shared");
    });
  }
}

module.exports = {
  up,
  down,
};
