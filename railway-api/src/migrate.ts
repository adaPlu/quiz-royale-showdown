import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, tx } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");
const managedTables = new Set([
  "schema_migrations",
  "users",
  "sessions",
  "password_reset_tokens",
  "guest_slot_seq",
  "free_guest_slots",
  "guests",
  "player_stats",
  "leaderboard_entries",
  "match_reports",
  "friendships",
  "presence",
  "powerup_inventory",
  "questions",
  "question_usage_events",
  "question_usage_rollups",
  "question_generation_jobs",
]);

async function main(): Promise<void> {
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

  await verifySchemaIsManaged();

  await tx(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
      if (existing.rowCount) continue;

      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(id) VALUES ($1)", [file]);
      console.log(`applied ${file}`);
    }
  });
}

async function verifySchemaIsManaged(): Promise<void> {
  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const existing = tables.rows.map((row) => row.table_name);
  const unknown = existing.filter((table) => !managedTables.has(table));
  if (unknown.length > 0 && process.env.ALLOW_UNKNOWN_SCHEMA !== "true") {
    throw new Error(
      `Refusing to migrate database with unknown public tables: ${unknown.join(", ")}. ` +
        "Review the schema first, or set ALLOW_UNKNOWN_SCHEMA=true after confirming it is safe.",
    );
  }

  const appTables = existing.filter((table) => table !== "schema_migrations");
  if (appTables.length > 0 && !existing.includes("schema_migrations") && process.env.ALLOW_UNMANAGED_APP_SCHEMA !== "true") {
    throw new Error(
      `Refusing to migrate unmanaged existing app tables: ${appTables.join(", ")}. ` +
        "Create a baseline migration record manually after review, or set ALLOW_UNMANAGED_APP_SCHEMA=true.",
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
