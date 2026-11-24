// this configuration is for migrations only
// and since jwt secret is not required, generate a temporary random secret to satisfy env validation
const crypto = require("node:crypto");

if (!process.env.JWT_SECRET && !process.env.JWT_SECRET_FILE) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
}

const env = require("./server/env");

const isSQLite = env.DB_CLIENT === "sqlite3" || env.DB_CLIENT === "better-sqlite3";

module.exports = {
  client: env.DB_CLIENT,
  connection: {
    ...(isSQLite && { filename: env.DB_FILENAME }),
    host: env.DB_HOST,
    database: env.DB_NAME,
    user: env.DB_USER,
    port: env.DB_PORT,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL,
  },
  useNullAsDefault: true,
  migrations: {
    tableName: "knex_migrations",
    directory: "server/migrations",
    disableMigrationsListValidation: true,
  }
};
