import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction } from "./db.js";
import { allow } from "./auth.js";
import { AppError, audit } from "./security.js";

const querySchema = z.object({
  q: z.string().max(100).default(""),
  status: z
    .enum(["all", "waiting", "open", "closed", "followup"])
    .default("all"),
});

export async function inboxRoutes(app: FastifyInstance) {
  app.get("/api/inbox", { preHandler: allow("inbox:read") }, async (req) => {
    const { q, status } = querySchema.parse(req.query);
    const search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    return transaction(req.user.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT c.id,c.protocol,c.status,c.unread_count,c.last_message_at,c.last_message_preview,c.last_message_from_me,c.remote_jid,
          c.assignee_id,c.department_id,coalesce(ct.name,split_part(c.remote_jid,'@',1)) AS contact_name,
          coalesce(ct.phone,split_part(c.remote_jid,'@',1)) AS contact_phone, m.name AS assignee_name,d.name AS department_name
         FROM conversations c LEFT JOIN contacts ct ON ct.id=c.contact_id LEFT JOIN memberships am ON am.id=c.assignee_id
         LEFT JOIN identities m ON m.id=am.user_id LEFT JOIN departments d ON d.id=c.department_id
         WHERE ($1='all' OR c.status=$1) AND (coalesce(ct.name,'') ILIKE $2 OR coalesce(ct.phone,'') ILIKE $2 OR c.protocol ILIKE $2 OR c.last_message_preview ILIKE $2)
         ORDER BY c.last_message_at DESC NULLS LAST,c.updated_at DESC LIMIT 100`,
        [status, search],
      );
      return { items: rows };
    });
  });

  app.get(
    "/api/inbox/:id/messages",
    { preHandler: allow("inbox:read") },
    async (req) => {
      const conversationId = z.uuid().parse((req.params as { id: string }).id);
      return transaction(req.user.tenantId, async (db) => {
        const { rows } = await db.query(
          `SELECT c.id,c.protocol,c.status,c.unread_count,c.remote_jid,coalesce(ct.name,split_part(c.remote_jid,'@',1)) AS contact_name,
          coalesce(ct.phone,split_part(c.remote_jid,'@',1)) AS contact_phone,ct.id AS contact_id,
          c.assignee_id,c.department_id,m.name AS assignee_name,d.name AS department_name
         FROM conversations c LEFT JOIN contacts ct ON ct.id=c.contact_id LEFT JOIN memberships am ON am.id=c.assignee_id
         LEFT JOIN identities m ON m.id=am.user_id LEFT JOIN departments d ON d.id=c.department_id WHERE c.id=$1`,
          [conversationId],
        );
        if (!rows[0])
          throw new AppError(404, "Este atendimento não está mais disponível.");
        const messages = await db.query(
          `SELECT id,direction,kind,body,media_name,sender_name,sent_at,status,reply_to_external_id FROM messages WHERE conversation_id=$1 ORDER BY sent_at ASC,id ASC LIMIT 500`,
          [conversationId],
        );
        return { conversation: rows[0], messages: messages.rows };
      });
    },
  );

  app.post(
    "/api/inbox/:id/read",
    { preHandler: allow("inbox:read") },
    async (req) => {
      const conversationId = z.uuid().parse((req.params as { id: string }).id);
      return transaction(req.user.tenantId, async (db) => {
        const { rowCount } = await db.query(
          "UPDATE conversations SET unread_count=0,updated_at=now() WHERE id=$1",
          [conversationId],
        );
        if (!rowCount)
          throw new AppError(404, "Este atendimento não está mais disponível.");
        return { ok: true };
      });
    },
  );

  app.patch(
    "/api/inbox/:id",
    { preHandler: allow("inbox:manage") },
    async (req) => {
      const conversationId = z.uuid().parse((req.params as { id: string }).id);
      const body = z
        .object({
          status: z.enum(["waiting", "open", "closed", "followup"]),
          assigneeId: z.uuid().nullable().optional(),
        })
        .parse(req.body);
      return transaction(req.user.tenantId, async (db) => {
        const { rowCount } = await db.query(
          "UPDATE conversations SET status=$1,assignee_id=coalesce($2,assignee_id),updated_at=now() WHERE id=$3",
          [body.status, body.assigneeId, conversationId],
        );
        if (!rowCount)
          throw new AppError(404, "Este atendimento não está mais disponível.");
        await audit(
          db,
          req.user.tenantId,
          req.user.userId,
          `Atendimento marcado como ${body.status}`,
          conversationId,
          req.id,
        );
        return { ok: true };
      });
    },
  );
}
