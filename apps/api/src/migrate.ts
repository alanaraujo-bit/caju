import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
export async function migrate(
  connectionString = process.env.MIGRATION_DATABASE_URL,
) {
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required");
  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    await db.query("SELECT pg_advisory_lock(740219)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())",
    );
    const dir = new URL("../migrations/", import.meta.url);
    for (const name of (await readdir(dir))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(new URL(name, dir), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const {
        rows: [existing],
      } = await db.query(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error(`Migration changed: ${name}`);
        continue;
      }
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query(
          "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
        await db.query("COMMIT");
        console.log(`Applied ${name}`);
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      }
    }
    await db.query("GRANT USAGE ON SCHEMA public TO caju_app");
    await db.query(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO caju_app",
    );
    await db.query("REVOKE ALL ON schema_migrations FROM caju_app");
    await db.query("REVOKE INSERT, UPDATE, DELETE ON plans FROM caju_app");
    await db.query("REVOKE UPDATE, DELETE ON audit_events FROM caju_app");
    await db.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO caju_app",
    );
    await db.query(
      "GRANT EXECUTE ON FUNCTION auth_memberships(uuid), auth_invitation(text) TO caju_app",
    );
    await db.query(
      "GRANT EXECUTE ON FUNCTION whatsapp_resume_targets() TO caju_app",
    );
  } finally {
    await db.query("SELECT pg_advisory_unlock(740219)").catch(() => {});
    await db.end();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await migrate();
