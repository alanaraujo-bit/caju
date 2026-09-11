import { buildApp } from "./app.js";
import { assertDatabaseRole, pool } from "./db.js";
import { BaileysGateway } from "./whatsapp-manager.js";
if (
  !process.env.DATABASE_URL ||
  !process.env.APP_URL ||
  !process.env.WHATSAPP_SESSION_KEY
)
  throw new Error(
    "DATABASE_URL, APP_URL and WHATSAPP_SESSION_KEY are required",
  );
await assertDatabaseRole();
const whatsapp = new BaileysGateway();
const app = await buildApp(true, whatsapp);
await app.listen({
  port: Number(process.env.PORT ?? 3001),
  host: process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1",
});
await whatsapp.resumeAll();
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
    await whatsapp.close();
    await app.close();
    await pool.end();
    process.exit(0);
  });
