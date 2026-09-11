import { buildApp } from "./app.js";
import { assertDatabaseRole, pool } from "./db.js";
if (!process.env.DATABASE_URL || !process.env.APP_URL)
  throw new Error("DATABASE_URL and APP_URL are required");
await assertDatabaseRole();
const app = await buildApp(true);
await app.listen({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1",
});
const cleanup = setInterval(() => {
  pool
    .query(
      "DELETE FROM sessions WHERE expires_at<now(); DELETE FROM auth_tokens WHERE expires_at<now(); DELETE FROM rate_limits WHERE expires_at<now()",
    )
    .catch(() => app.log.error("Falha na limpeza de registros expirados"));
}, 3600000);
cleanup.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    clearInterval(cleanup);
    await app.close();
    await pool.end();
    process.exit(0);
  });
