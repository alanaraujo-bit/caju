import EmbeddedPostgres from "embedded-postgres";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "node:net";

// A private local cluster: no Railway credentials or production sessions involved.
const mode = process.argv[2] ?? "dev";
if (!["dev", "test", "e2e"].includes(mode))
  throw new Error("Use dev, test or e2e");
const base = resolve(".local", mode === "dev" ? "development" : "validation");
await mkdir(base, { recursive: true });
const secretFile = resolve(base, "credentials.json");
let secrets;
try {
  secrets = JSON.parse(await readFile(secretFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  secrets = {
    owner: randomBytes(24).toString("hex"),
    app: randomBytes(24).toString("hex"),
    whatsapp: randomBytes(32).toString("base64"),
  };
  await writeFile(secretFile, JSON.stringify(secrets), {
    mode: 0o600,
    flag: "wx",
  });
}
const port = mode === "dev" ? 15433 : await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const address = probe.address(); probe.close(() => resolve(address.port)); });
});
const postgres = new EmbeddedPostgres({
  databaseDir: resolve(base, "postgres"),
  port,
  user: "postgres",
  password: secrets.owner,
  authMethod: "scram-sha-256",
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: (message) => {
    if (/FATAL|PANIC|could not|failed|lock file/i.test(message)) console.error(message);
  },
  onError: (message) => {
    const text = String(message);
    if (/FATAL|PANIC|could not|não foi possível/i.test(text)) console.error(text.replace(/(password|PASSWORD)\s+[^\r\n]+/g, "$1 [redacted]"));
  },
});
try {
  await access(resolve(base, "postgres", "PG_VERSION"));
} catch {
  await postgres.initialise();
}
// pg_ctl waits for a clean shutdown, including Windows I/O workers.
const { pg_ctl } = await import(`@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`);
const ctl = (args) => new Promise((resolve, reject) => {
  const child = spawn(pg_ctl, args, { windowsHide: true, stdio: "ignore" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`PostgreSQL command failed (${code}). See ${base}/postgres.log`)));
});
await ctl(["start", "-D", resolve(base, "postgres"), "-l", resolve(base, "postgres.log"), "-w", "-o", `-h 127.0.0.1 -p ${port}`]);
const owner = postgres.getPgClient("postgres", "127.0.0.1");
await owner.connect();
if (
  !(await owner.query("SELECT 1 FROM pg_roles WHERE rolname='caju_app'"))
    .rowCount
)
  await owner.query(
    `CREATE ROLE caju_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${secrets.app}'`,
  );
if (
  !(await owner.query("SELECT 1 FROM pg_database WHERE datname='caju'"))
    .rowCount
)
  await owner.query("CREATE DATABASE caju");
const database =
  mode === "e2e" ? `caju_e2e_${randomUUID().replaceAll("-", "")}` : "caju";
if (mode === "e2e") await owner.query(`CREATE DATABASE ${database}`);
await owner.end();
const env = {
  ...process.env,
  DATABASE_URL: `postgresql://caju_app:${secrets.app}@127.0.0.1:${port}/${database}`,
  MIGRATION_DATABASE_URL: `postgresql://postgres:${secrets.owner}@127.0.0.1:${port}/${database}`,
  WHATSAPP_SESSION_KEY: secrets.whatsapp,
  NODE_ENV: "test",
  APP_URL: mode === "e2e" ? "http://127.0.0.1:5174" : "http://127.0.0.1:5173",
  PORT: mode === "e2e" ? "3002" : "3001",
  CAJU_API_TARGET:
    mode === "e2e" ? "http://127.0.0.1:3002" : "http://127.0.0.1:3001",
};
const children = new Set();
const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    children.add(child);
    child.on("error", reject);
    child.on("exit", (code) => {
      children.delete(child);
      code === 0 ? resolve() : reject(new Error(`Command exited ${code}`));
    });
  });
let stopping;
const stop = () => stopping ??= (async () => {
  for (const child of children) child.kill();
  await ctl(["stop", "-D", resolve(base, "postgres"), "-m", "fast", "-w"]);
})();
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  await run(["node_modules/tsx/dist/cli.mjs", "apps/api/src/migrate.ts"]);
  console.log(`Caju: PostgreSQL local disponível na porta ${port}.`);
  if (mode === "test")
    await run([
      "node_modules/tsx/dist/cli.mjs",
      "--test",
      "apps/api/test/integration.test.ts",
    ]);
  else if (mode === "e2e")
    await run([
      "node_modules/@playwright/test/cli.js",
      "test",
      ...process.argv.slice(3),
    ]);
  else
    await Promise.all([
      run(["node_modules/tsx/dist/cli.mjs", "apps/api/src/server.ts"]),
      run([
        "node_modules/vite/bin/vite.js",
        "apps/web",
        "--host",
        "127.0.0.1",
        "--port",
        "5173",
      ]),
    ]);
} finally {
  if (mode === "e2e") {
    const cleanup = postgres.getPgClient("postgres", "127.0.0.1");
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await cleanup.end();
  }
  await stop();
}
