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

// Sem contato cadastrado, o nome vem de quem escreveu por último; um JID "@lid"
// não é telefone, então não vira número na tela.
const contactColumns = `
  coalesce(c.title,ct.name,(SELECT sender_name FROM messages lm WHERE lm.conversation_id=c.id AND lm.direction='inbound' AND lm.sender_name<>'' ORDER BY lm.sent_at DESC LIMIT 1),
    CASE WHEN c.remote_jid LIKE '%@s.whatsapp.net' THEN '+'||split_part(c.remote_jid,'@',1) WHEN c.remote_jid LIKE '%@g.us' THEN 'Grupo' ELSE 'Contato' END) AS contact_name,
  coalesce(ct.phone,CASE WHEN c.remote_jid LIKE '%@s.whatsapp.net' THEN '+'||split_part(split_part(c.remote_jid,'@',1),':',1) END) AS contact_phone`;

export async function inboxRoutes(app: FastifyInstance) {
  app.get("/api/inbox", { preHandler: allow("inbox:read") }, async (req) => {
    const { q, status } = querySchema.parse(req.query);
    const search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    return transaction(req.user.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT c.id,c.protocol,c.status,c.unread_count,c.last_message_at,c.last_message_preview,c.last_message_from_me,
          c.remote_jid LIKE '%@g.us' AS is_group,c.assignee_id,c.department_id,${contactColumns},
          m.name AS assignee_name,d.name AS department_name
         FROM conversations c LEFT JOIN contacts ct ON ct.id=c.contact_id LEFT JOIN memberships am ON am.id=c.assignee_id
         LEFT JOIN identities m ON m.id=am.user_id LEFT JOIN departments d ON d.id=c.department_id
         WHERE ($1='all' OR c.status=$1) AND (coalesce(c.title,'') ILIKE $2 OR coalesce(ct.name,'') ILIKE $2 OR coalesce(ct.phone,'') ILIKE $2 OR c.protocol ILIKE $2 OR c.last_message_preview ILIKE $2)
         ORDER BY c.last_message_at DESC NULLS LAST,c.updated_at DESC LIMIT 100`,
        [status, search],
      );
      const { rows: counts } = await db.query(
        "SELECT status,count(*)::int AS total FROM conversations GROUP BY status",
      );
      return {
        items: rows,
        counts: Object.fromEntries(
          counts.map((row) => [row.status, row.total]),
        ) as Record<string, number>,
      };
    });
  });

  app.get(
    "/api/inbox/:id/messages",
    { preHandler: allow("inbox:read") },
    async (req) => {
      const conversationId = z.uuid().parse((req.params as { id: string }).id);
      return transaction(req.user.tenantId, async (db) => {
        const { rows } = await db.query(
          `SELECT c.id,c.protocol,c.status,c.unread_count,c.remote_jid LIKE '%@g.us' AS is_group,${contactColumns},ct.id AS contact_id,
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
