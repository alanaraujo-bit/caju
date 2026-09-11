import { spawn } from "node:child_process";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { variables, tunnelUrl } from "./railway-context.mjs";
const vars = variables("Postgres"),
  runtimeVars = variables("api");
const runtime = tunnelUrl(runtimeVars.DATABASE_URL);
const [mode, ...args] = process.argv.slice(2);
if (!["migrate", "test", "dev", "e2e"].includes(mode))
  throw new Error("Use migrate, test, dev or e2e");
const command =
  mode === "migrate"
    ? ["node_modules/tsx/dist/cli.mjs", "apps/api/src/migrate.ts"]
    : mode === "dev"
      ? ["node_modules/tsx/dist/cli.mjs", "apps/api/src/server.ts"]
      : mode === "e2e"
        ? ["node_modules/@playwright/test/cli.js", "test", ...args]
        : [
            "node_modules/tsx/dist/cli.mjs",
            "--test",
            ...args,
            "apps/api/test/integration.test.ts",
          ];
const env = {
  ...process.env,
  DATABASE_URL: runtime,
  MIGRATION_DATABASE_URL:
    mode === "dev" ? undefined : tunnelUrl(vars.DATABASE_URL),
  APP_URL: "http://127.0.0.1:5173",
  PORT: "3001",
  NODE_ENV: "test",
};
let admin, testName;
if (mode === "e2e") {
  admin = new pg.Client({ connectionString: tunnelUrl(vars.DATABASE_URL) });
  await admin.connect();
  testName = `caju_e2e_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${testName}`);
  const runtimeURL = new URL(runtime),
    migrationURL = new URL(tunnelUrl(vars.DATABASE_URL));
  runtimeURL.pathname = `/${testName}`;
  migrationURL.pathname = `/${testName}`;
  Object.assign(env, {
    DATABASE_URL: runtimeURL.toString(),
    MIGRATION_DATABASE_URL: migrationURL.toString(),
    APP_URL: "http://127.0.0.1:5174",
    PORT: "3002",
    CAJU_API_TARGET: "http://127.0.0.1:3002",
  });
  const migration = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "apps/api/src/migrate.ts"],
    { stdio: "inherit", env },
  );
  await new Promise((resolve, reject) =>
    migration.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Migration failed")),
    ),
  );
}
const child = spawn(process.execPath, command, { stdio: "inherit", env });
child.on("exit", async (code) => {
  if (admin && testName) {
    await admin.query(`DROP DATABASE IF EXISTS ${testName} WITH (FORCE)`);
    await admin.end();
  }
  process.exit(code ?? 1);
});
