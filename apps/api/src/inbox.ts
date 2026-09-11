import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { transaction } from "./db.js";
import { allow } from "./auth.js";
import { AppError, audit, limit } from "./security.js";
import { validateMedia, type Attachment } from "./media.js";
import type { WhatsAppGateway } from "./whatsapp-manager.js";

const querySchema = z.object({
  q: z.string().max(100).default(""),
  status: z
    .enum(["all", "waiting", "open", "closed", "followup"])
    .default("all"),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

// Sem contato cadastrado, o nome vem de quem escreveu por último; um JID "@lid"
// não é telefone, então não vira número na tela.
const contactColumns = `
  coalesce(c.title,ct.name,(SELECT sender_name FROM messages lm WHERE lm.conversation_id=c.id AND lm.direction='inbound' AND lm.sender_name<>'' ORDER BY lm.sent_at DESC LIMIT 1),
    CASE WHEN c.remote_jid LIKE '%@s.whatsapp.net' THEN '+'||split_part(c.remote_jid,'@',1) WHEN c.remote_jid LIKE '%@g.us' THEN 'Grupo' ELSE 'Contato' END) AS contact_name,
  coalesce(ct.phone,CASE WHEN c.remote_jid LIKE '%@s.whatsapp.net' THEN '+'||split_part(split_part(c.remote_jid,'@',1),':',1) END) AS contact_phone`;

export async function inboxRoutes(
  app: FastifyInstance,
  gateway: WhatsAppGateway | null = null,
) {
  app.get("/api/inbox", { preHandler: allow("inbox:read") }, async (req) => {
    const { q, status, offset } = querySchema.parse(req.query);
    const search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    return transaction(req.user.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT c.id,c.protocol,c.status,c.version,c.unread_count,c.last_message_at,c.last_message_preview,c.last_message_from_me,
          c.remote_jid LIKE '%@g.us' AS is_group,c.assignee_id,c.department_id,${contactColumns},
          m.name AS assignee_name,d.name AS department_name
         FROM conversations c LEFT JOIN contacts ct ON ct.id=c.contact_id LEFT JOIN memberships am ON am.id=c.assignee_id
         LEFT JOIN identities m ON m.id=am.user_id LEFT JOIN departments d ON d.id=c.department_id
         WHERE ($1='all' OR c.status=$1) AND (coalesce(c.title,'') ILIKE $2 OR coalesce(ct.name,'') ILIKE $2 OR coalesce(ct.phone,'') ILIKE $2 OR c.remote_jid ILIKE $2 OR c.protocol ILIKE $2 OR EXISTS(SELECT 1 FROM messages sm WHERE sm.conversation_id=c.id AND (sm.body ILIKE $2 OR sm.sender_name ILIKE $2)))
         ORDER BY c.last_message_at DESC NULLS LAST,c.updated_at DESC,c.id LIMIT 101 OFFSET $3`,
        [status, search, offset],
      );
      const { rows: counts } = await db.query(
        "SELECT status,count(*)::int AS total FROM conversations GROUP BY status",
      );
      return {
        items: rows.slice(0, 100),
        hasMore: rows.length > 100,
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
          `SELECT c.id,c.protocol,c.status,c.version,c.closed_reason,c.unread_count,c.remote_jid LIKE '%@g.us' AS is_group,${contactColumns},ct.id AS contact_id,
          c.assignee_id,c.department_id,m.name AS assignee_name,d.name AS department_name
         FROM conversations c LEFT JOIN contacts ct ON ct.id=c.contact_id LEFT JOIN memberships am ON am.id=c.assignee_id
         LEFT JOIN identities m ON m.id=am.user_id LEFT JOIN departments d ON d.id=c.department_id WHERE c.id=$1`,
          [conversationId],
        );
        if (!rows[0])
          throw new AppError(404, "Este atendimento não está mais disponível.");
        const { before } = z
          .object({ before: z.uuid().optional() })
          .parse(req.query);
        const messages = await db.query(
          `SELECT id,direction,kind,body,media_name,sender_name,sent_at,status,reply_to_external_id,
           EXISTS(SELECT 1 FROM message_media mm WHERE mm.message_id=messages.id) AS has_media,
           (SELECT mime FROM message_media mm WHERE mm.message_id=messages.id) AS media_mime FROM messages
           WHERE conversation_id=$1 AND ($2::uuid IS NULL OR (sent_at,id)<(SELECT sent_at,id FROM messages WHERE id=$2 AND conversation_id=$1))
           ORDER BY sent_at DESC,id DESC LIMIT 101`,
          [conversationId, before],
        );
        return {
          conversation: rows[0],
          messages: messages.rows.slice(0, 100).reverse(),
          hasMore: messages.rows.length > 100,
        };
      });
    },
  );

  app.post(
    "/api/inbox/:id/read",
    { preHandler: allow("inbox:read") },
    async (req) => {
      const conversationId = z.uuid().parse((req.params as { id: string }).id);
      const { throughId } = z
        .object({ throughId: z.uuid().optional() })
        .parse(req.body ?? {});
      const pending = await transaction(req.user.tenantId, async (db) => {
        const { rowCount } = await db.query(
          `UPDATE conversations SET unread_count=(SELECT count(*) FROM messages WHERE conversation_id=$1 AND direction='inbound'
           AND $2::uuid IS NOT NULL AND (sent_at,id)>(SELECT sent_at,id FROM messages WHERE id=$2 AND conversation_id=$1)),updated_at=now() WHERE id=$1`,
          [conversationId, throughId],
        );
        if (!rowCount)
          throw new AppError(404, "Este atendimento não está mais disponível.");
        if (!throughId) return null;
        // O cliente só vê o tique azul quando alguém da equipe realmente abriu a conversa.
        const { rows } = await db.query(
          `SELECT m.id,m.external_id,m.sender_jid,c.remote_jid,c.whatsapp_connection_id FROM messages m JOIN conversations c ON c.id=m.conversation_id
           WHERE m.conversation_id=$1 AND m.direction='inbound' AND m.receipted_at IS NULL
           AND (m.sent_at,m.id)<=(SELECT sent_at,id FROM messages WHERE id=$2 AND conversation_id=$1) ORDER BY m.sent_at DESC,m.id DESC LIMIT 50`,
          [conversationId, throughId],
        );
        return rows;
      });
      if (gateway && pending?.length) {
        const delivered = await gateway.markRead(
          pending[0].whatsapp_connection_id,
          pending.map((row) => ({
            remoteJid: row.remote_jid,
            id: row.external_id,
            participant: row.sender_jid,
          })),
        );
        if (delivered)
          await transaction(req.user.tenantId, (db) =>
            db.query(
              "UPDATE messages SET receipted_at=now() WHERE id=ANY($1::uuid[])",
              [pending.map((row) => row.id)],
            ),
          );
      }
      return { ok: true };
    },
  );

  app.patch(
    "/api/inbox/:id",
    { preHandler: allow("inbox:read") },
    async (req) => {
      const conversationId = z.uuid().parse((req.params as { id: string }).id);
      const body = z
        .object({
          status: z.enum(["waiting", "open", "closed", "followup"]).optional(),
          assigneeId: z.uuid().nullable().optional(),
          departmentId: z.uuid().nullable().optional(),
          version: z.number().int().positive(),
          reason: z.string().trim().min(3).max(500).optional(),
        })
        .parse(req.body);
      return transaction(req.user.tenantId, async (db) => {
        const {
          rows: [current],
        } = await db.query(
          "SELECT * FROM conversations WHERE id=$1 FOR UPDATE",
          [conversationId],
        );
        if (!current)
          throw new AppError(404, "Este atendimento não está mais disponível.");
        if (current.version !== body.version)
          throw new AppError(
            409,
            "Este atendimento foi alterado por outra pessoa. Confira o responsável e tente novamente.",
            "CONFLICT",
          );
        const manager = req.user.permissions.includes("inbox:manage");
        if (
          !manager &&
          current.assignee_id &&
          current.assignee_id !== req.user.membershipId
        )
          throw new AppError(
            403,
            "Este atendimento está com outra pessoa. Peça a transferência ao supervisor.",
          );
        if (
          !manager &&
          body.assigneeId !== undefined &&
          body.assigneeId !== req.user.membershipId &&
          body.assigneeId !== null
        )
          throw new AppError(
            403,
            "Somente supervisores podem atribuir a outra pessoa.",
          );
        if (!manager && body.departmentId !== undefined)
          throw new AppError(
            403,
            "Peça ao supervisor para transferir o departamento.",
          );
        if (body.assigneeId) {
          const member = await db.query(
            "SELECT 1 FROM memberships WHERE id=$1 AND active",
            [body.assigneeId],
          );
          if (!member.rowCount)
            throw new AppError(400, "Escolha uma pessoa ativa da sua equipe.");
        }
        if (body.status === "closed" && !body.reason)
          throw new AppError(400, "Informe o motivo da finalização.");
        const { rowCount } = await db.query(
          `UPDATE conversations SET status=coalesce($1,status),assignee_id=CASE WHEN $4 THEN $2 ELSE assignee_id END,
           department_id=CASE WHEN $5 THEN $6 ELSE department_id END,closed_reason=CASE WHEN $1='closed' THEN $7 ELSE closed_reason END,
           version=version+1,updated_at=now() WHERE id=$3`,
          [
            body.status,
            body.assigneeId,
            conversationId,
            body.assigneeId !== undefined,
            body.departmentId !== undefined,
            body.departmentId,
            body.reason,
          ],
        );
        if (!rowCount)
          throw new AppError(404, "Este atendimento não está mais disponível.");
        await audit(
          db,
          req.user.tenantId,
          req.user.userId,
          "Atendimento atualizado",
          conversationId,
          req.id,
          {
            status: body.status,
            assigneeId: body.assigneeId,
            departmentId: body.departmentId,
            reason: body.reason,
          },
        );
        return { ok: true };
      });
    },
  );

  app.get("/api/inbox/team", { preHandler: allow("inbox:read") }, async (req) =>
    transaction(
      req.user.tenantId,
      async (db) =>
        (
          await db.query(
            "SELECT m.id,u.name FROM memberships m JOIN identities u ON u.id=m.user_id WHERE m.active ORDER BY u.name",
          )
        ).rows,
    ),
  );

  app.post(
    "/api/inbox/:id/messages",
    { preHandler: allow("inbox:read"), bodyLimit: 15 * 1024 * 1024 },
    async (req, reply) => {
      const conversationId = z.uuid().parse((req.params as { id: string }).id);
      const body = z
        .object({
          requestId: z.uuid(),
          body: z.string().trim().max(4000).default(""),
          internal: z.boolean().default(false),
          attachment: z
            .object({
              name: z.string().min(1).max(180),
              base64: z
                .string()
                .max(13981016, "Escolha um arquivo de até 10 MB.")
                .regex(
                  /^[A-Za-z0-9+/]+={0,2}$/,
                  "O arquivo não pôde ser lido. Escolha-o novamente.",
                ),
            })
            .optional(),
        })
        .parse(req.body);
      if (!body.body && !body.attachment)
        throw new AppError(400, "Escreva uma mensagem ou escolha um arquivo.");
      if (body.internal && body.attachment)
        throw new AppError(
          400,
          "Notas internas aceitam texto. Remova o anexo para continuar.",
        );
      const attachment: Attachment | null = body.attachment
        ? await validateMedia(
            Buffer.from(body.attachment.base64, "base64"),
            body.attachment.name,
          )
        : null;
      if (attachment?.kind === "audio" && body.body)
        throw new AppError(
          400,
          "Envie o áudio e a mensagem de texto separadamente.",
        );
      const result = await transaction(req.user.tenantId, async (db) => {
        const {
          rows: [conversation],
        } = await db.query(
          "SELECT * FROM conversations WHERE id=$1 FOR UPDATE",
          [conversationId],
        );
        if (!conversation)
          throw new AppError(404, "Este atendimento não está mais disponível.");
        const {
          rows: [existing],
        } = await db.query(
          "SELECT id,status,body,direction FROM messages WHERE conversation_id=$1 AND request_id=$2",
          [conversationId, body.requestId],
        );
        if (existing) {
          const storedMedia = (
            await db.query(
              "SELECT content,name FROM message_media WHERE message_id=$1",
              [existing.id],
            )
          ).rows[0];
          if (
            existing.body !== body.body ||
            (existing.direction === "internal") !== body.internal ||
            Boolean(storedMedia) !== Boolean(attachment) ||
            (attachment &&
              (!storedMedia.content.equals(attachment.content) ||
                storedMedia.name !== attachment.name))
          )
            throw new AppError(
              409,
              "Esta solicitação já foi usada para outra mensagem.",
            );
          return { id: existing.id, status: existing.status };
        }
        if (
          !body.internal &&
          conversation.assignee_id !== req.user.membershipId
        )
          throw new AppError(409, "Assuma o atendimento antes de responder.");
        if (conversation.status === "closed")
          throw new AppError(409, "Reabra o atendimento para continuar.");
        if (!(await limit(db, `outbox:${req.user.tenantId}`, 120, 60)))
          throw new AppError(
            429,
            "Sua equipe enviou muitas mensagens. Aguarde um minuto.",
          );
        const id = randomUUID(),
          status = body.internal ? "received" : "queued";
        await db.query(
          `INSERT INTO messages(id,tenant_id,conversation_id,whatsapp_connection_id,external_id,direction,kind,body,sender_name,sent_at,status,request_id,author_id)
         VALUES($1,$2,$3,$4,$5,$6,$12,$7,$8,now(),$9,$10,$11)`,
          [
            id,
            req.user.tenantId,
            conversationId,
            conversation.whatsapp_connection_id,
            `CAJU${id.replaceAll("-", "").toUpperCase()}`,
            body.internal ? "internal" : "outbound",
            body.body,
            req.user.name,
            status,
            body.requestId,
            req.user.membershipId,
            attachment?.kind ?? "text",
          ],
        );
        if (attachment) {
          await db.query(
            "INSERT INTO message_media(tenant_id,message_id,mime,name,content) VALUES($1,$2,$3,$4,$5)",
            [
              req.user.tenantId,
              id,
              attachment.mime,
              attachment.name,
              attachment.content,
            ],
          );
          await db.query("UPDATE messages SET media_name=$2 WHERE id=$1", [
            id,
            attachment.name,
          ]);
        }
        if (!body.internal)
          await db.query(
            "UPDATE conversations SET last_message_at=now(),last_message_preview=$2,last_message_from_me=true,updated_at=now() WHERE id=$1",
            [
              conversationId,
              body.body.slice(0, 240) || attachment?.name || "Arquivo",
            ],
          );
        await audit(
          db,
          req.user.tenantId,
          req.user.userId,
          body.internal
            ? "Nota interna adicionada"
            : "Mensagem adicionada à fila",
          conversationId,
          req.id,
        );
        return { id, status };
      });
      return reply.code(201).send(result);
    },
  );

  app.get(
    "/api/inbox/:id/messages/:messageId/media",
    { preHandler: allow("inbox:read") },
    async (req, reply) => {
      const { id, messageId } = z
        .object({ id: z.uuid(), messageId: z.uuid() })
        .parse(req.params);
      const media = await transaction(
        req.user.tenantId,
        async (db) =>
          (
            await db.query(
              "SELECT mm.* FROM message_media mm JOIN messages m ON m.id=mm.message_id WHERE m.conversation_id=$1 AND m.id=$2",
              [id, messageId],
            )
          ).rows[0],
      );
      if (!media) throw new AppError(404, "Este arquivo não está disponível.");
      const inline = /^(image|audio|video)\//.test(media.mime);
      reply
        .header("Content-Type", media.mime)
        .header("X-Content-Type-Options", "nosniff")
        .header(
          "Content-Disposition",
          `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(media.name)}`,
        )
        .header("Cache-Control", "private, no-store");
      return reply.send(media.content);
    },
  );
}
