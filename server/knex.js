const knex = require("knex");

const env = require("./env");

const isSQLite = env.DB_CLIENT === "sqlite3" || env.DB_CLIENT === "better-sqlite3";
const isPostgres = env.DB_CLIENT === "pg" || env.DB_CLIENT === "pg-native";
const isMySQL = env.DB_CLIENT === "mysql" || env.DB_CLIENT === "mysql2";

const db = knex({
  client: env.DB_CLIENT,
  connection: isSQLite
    ? { filename: env.DB_FILENAME }
    : {
        host: env.DB_HOST,
        port: env.DB_PORT,
        database: env.DB_NAME,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        ssl: env.DB_SSL,
      },
  pool: {
    min: env.DB_POOL_MIN,
    max: env.DB_POOL_MAX,
    ...(isSQLite && {
      afterCreate(conn, done) {
        try {
          if (typeof conn.pragma === "function") {
            conn.pragma("foreign_keys = ON");
            conn.pragma("journal_mode = WAL");
            conn.pragma("busy_timeout = 5000");
            conn.pragma("synchronous = NORMAL");
            done(null, conn);
          } else if (typeof conn.run === "function") {
            conn.run("PRAGMA foreign_keys = ON", err => {
              if (err) return done(err, conn);
              conn.run("PRAGMA journal_mode = WAL", err2 => {
                if (err2) return done(err2, conn);
                conn.run("PRAGMA busy_timeout = 5000", err3 => {
                  if (err3) return done(err3, conn);
                  conn.run("PRAGMA synchronous = NORMAL", err4 => done(err4, conn));
                });
              });
            });
          } else {
            done(null, conn);
          }
        } catch (err) {
          done(err, conn);
        }
      }
    }),
  },
  useNullAsDefault: true,
});

db.isPostgres = isPostgres;
db.isSQLite = isSQLite;
db.isMySQL = isMySQL;

db.compatibleILIKE = isPostgres ? "andWhereILike" : "andWhereLike";

module.exports = db;
