import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { transaction, type DB } from "./db.js";
import { allow } from "./auth.js";
import { AppError, audit } from "./security.js";
import type { WhatsAppGateway } from "./whatsapp-manager.js";

async function planLimit(db: DB) {
  const {
    rows: [limit],
  } = await db.query(
    "SELECT (p.limits->>'numbers')::int AS maximum FROM companies c JOIN plans p ON p.code=c.plan_code WHERE c.id=current_setting('caju.tenant_id')::uuid FOR UPDATE OF c",
  );
  const {
    rows: [count],
  } = await db.query("SELECT count(*)::int AS total FROM whatsapp_connections");
  if (count.total >= limit.maximum)
    throw new AppError(
      409,
      "Seu plano já atingiu o limite de números conectados.",
      "PLAN_LIMIT",
    );
}

const connectionId = (req: FastifyRequest) => {
  const value = (req.params as { id?: string }).id;
  if (!value || !/^[0-9a-f-]{36}$/i.test(value))
    throw new AppError(400, "Conexão inválida.");
  return value;
};

export async function whatsappRoutes(
  app: FastifyInstance,
  gateway: WhatsAppGateway | null,
) {
  app.get(
    "/api/whatsapp/connections",
    { preHandler: allow("whatsapp:manage") },
    async (req) =>
      transaction(req.user.tenantId, async (db) => {
        const { rows } = await db.query(
          `SELECT id,label,status,phone,profile_name,connected_at,last_seen_at,last_error_message,
           reconnect_attempts,created_at,updated_at FROM whatsapp_connections ORDER BY created_at`,
        );
        return rows.map((row) => ({
          ...row,
          ...(gateway?.state(row.id) ?? { qr: null, qrExpiresAt: null }),
        }));
      }),
  );

  app.post(
    "/api/whatsapp/connections",
    { preHandler: allow("whatsapp:manage") },
    async (req, reply) => {
      if (!gateway)
        throw new AppError(
          503,
          "A conexão com o WhatsApp está temporariamente indisponível.",
          "WHATSAPP_GATEWAY_UNAVAILABLE",
        );
      const id = randomUUID();
      await transaction(req.user.tenantId, async (db) => {
        await planLimit(db);
        await db.query(
          "INSERT INTO whatsapp_connections(id,tenant_id,status,created_by) VALUES($1,$2,'connecting',$3)",
          [id, req.user.tenantId, req.user.userId],
        );
        await audit(
          db,
          req.user.tenantId,
          req.user.userId,
          "Conexão do WhatsApp iniciada",
          id,
          req.id,
          { method: "qr_code" },
        );
      });
      try {
        await gateway.start(req.user.tenantId, id);
      } catch {
        await transaction(req.user.tenantId, (db) =>
          db.query(
            "UPDATE whatsapp_connections SET status='error',last_error_message='Não foi possível iniciar a conexão. Tente novamente.' WHERE id=$1",
            [id],
          ),
        );
      }
      return reply.code(201).send({ id });
    },
  );

  app.post(
    "/api/whatsapp/connections/:id/reconnect",
    { preHandler: allow("whatsapp:manage") },
    async (req) => {
      if (!gateway) throw new AppError(503, "A conexão está indisponível.");
      const id = connectionId(req);
      const exists = await transaction(req.user.tenantId, async (db) => {
        const { rowCount } = await db.query(
          "SELECT id FROM whatsapp_connections WHERE id=$1",
          [id],
        );
        return Boolean(rowCount);
      });
      if (!exists) throw new AppError(404, "Conexão não encontrada.");
      await gateway.reconnect(req.user.tenantId, id);
      return { ok: true };
    },
  );

  app.delete(
    "/api/whatsapp/connections/:id",
    { preHandler: allow("whatsapp:manage") },
    async (req) => {
      if (!gateway) throw new AppError(503, "A conexão está indisponível.");
      const id = connectionId(req);
      const exists = await transaction(req.user.tenantId, async (db) => {
        const { rowCount } = await db.query(
          "SELECT id FROM whatsapp_connections WHERE id=$1",
          [id],
        );
        return Boolean(rowCount);
      });
      if (!exists) throw new AppError(404, "Conexão não encontrada.");
      await gateway.remove(req.user.tenantId, id);
      await transaction(req.user.tenantId, async (db) => {
        await db.query("DELETE FROM whatsapp_connections WHERE id=$1", [id]);
        await audit(
          db,
          req.user.tenantId,
          req.user.userId,
          "Conexão do WhatsApp removida",
          id,
          req.id,
        );
      });
      return { ok: true };
    },
  );
}
