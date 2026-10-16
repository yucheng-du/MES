import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPool, transaction } from "./db.js";
import type pg from "pg";
export async function migrate(pool: pg.Pool) {
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(183923479)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const dir = new URL("./migrations/", import.meta.url);
    for (const name of (await readdir(dir))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        (
          await db.query("SELECT name FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rowCount
      )
        continue;
      await db.query(await readFile(new URL(name, dir), "utf8"));
      await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const p = createPool();
  try {
    await migrate(p);
    console.log("Migrations applied");
  } finally {
    await p.end();
  }
}
