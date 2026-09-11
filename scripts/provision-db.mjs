import pg from "pg";
import { randomBytes } from "node:crypto";
import { variables, setVariable, tunnelUrl } from "./railway-context.mjs";
const vars = variables("Postgres");
const db = new pg.Client({ connectionString: tunnelUrl(vars.DATABASE_URL) });
await db.connect();
try {
  const { rows } = await db.query(
    "SELECT 1 FROM pg_roles WHERE rolname='caju_app'",
  );
  if (rows.length)
    throw new Error("caju_app already exists. No credentials were changed.");
  const password = randomBytes(40).toString("hex");
  await db.query(
    `CREATE ROLE caju_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${password}'`,
  );
  const runtime = new URL(vars.DATABASE_URL);
  runtime.username = "caju_app";
  runtime.password = password;
  setVariable("DATABASE_URL", runtime.toString());
  setVariable("NODE_ENV", "production");
  setVariable("PORT", "3001");
  console.log(
    "Dedicated restricted database role created. Runtime credentials stored in Railway.",
  );
} finally {
  await db.end();
}
