import { randomUUID } from "node:crypto";
import { transaction } from "./db.js";
import type { Attachment } from "./media.js";

export type IncomingMessage = {
  externalId: string;
  remoteJid: string;
  phoneJid?: string | null;
  senderJid?: string | null;
  title?: string | null;
  fromMe: boolean;
  pushName?: string | null;
  kind: string;
  body?: string | null;
  mediaName?: string | null;
  sentAt: Date;
  replyToExternalId?: string | null;
  attachment?: Attachment | null;
};

// Só um JID de telefone vira número; "@lid" e grupos não carregam o número da pessoa.
function phoneFromJid(jid: string | null | undefined) {
  if (!jid?.endsWith("@s.whatsapp.net")) return null;
  const digits = jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
  return digits ? `+${digits}` : null;
}

function preview(message: IncomingMessage) {
  const special = (
    { location: "Localização", contact: "Contato", poll: "Enquete" } as Record<
      string,
      string
    >
  )[message.kind];
  if (special) {
    const line = message.body?.split("\n")[0]?.trim();
    return line && !/^https?:/.test(line)
      ? `${special} · ${line}`.slice(0, 240)
      : special;
  }
  if (message.body?.trim()) return message.body.trim().slice(0, 240);
  const labels: Record<string, string> = {
    image: "Imagem",
    video: "Vídeo",
    audio: "Áudio",
    document: message.mediaName
      ? `Documento · ${message.mediaName}`
      : "Documento",
    sticker: "Figurinha",
    location: "Localização",
    contact: "Contato compartilhado",
    poll: "Enquete",
    unknown: "Mensagem sem visualização no Caju",
  };
  return labels[message.kind] ?? "Mensagem recebida";
}

export async function ingestIncomingMessage(
  tenantId: string,
  connectionId: string,
  message: IncomingMessage,
) {
  if (!message.externalId || !message.remoteJid) return null;
  return transaction(tenantId, async (db) => {
    const direction = message.fromMe ? "outbound" : "inbound";
    const contactPhone = phoneFromJid(message.phoneJid ?? message.remoteJid);
    let contactId: string | null = null;
    if (contactPhone) {
      const { rows } = await db.query(
        `INSERT INTO contacts(id,tenant_id,name,phone) VALUES($1,$2,$3,$4)
         ON CONFLICT(tenant_id,phone) DO UPDATE SET name=CASE WHEN contacts.name=contacts.phone THEN excluded.name ELSE contacts.name END,updated_at=now()
         RETURNING id`,
        [
          randomUUID(),
          tenantId,
          (!message.fromMe && message.pushName?.trim()) || contactPhone,
          contactPhone,
        ],
      );
      contactId = rows[0]?.id ?? null;
    }
    const conversationId = randomUUID();
    const protocol = `CAJ-${Date.now().toString(36).toUpperCase()}-${conversationId.slice(0, 4).toUpperCase()}`;
    const { rows: inserted } = await db.query(
      `INSERT INTO conversations(id,tenant_id,whatsapp_connection_id,remote_jid,contact_id,protocol,last_message_at,last_message_preview,last_message_from_me,unread_count,title)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10)
       ON CONFLICT(tenant_id,whatsapp_connection_id,remote_jid) DO NOTHING RETURNING id`,
      [
        conversationId,
        tenantId,
        connectionId,
        message.remoteJid,
        contactId,
        protocol,
        message.sentAt,
        preview(message),
        direction === "outbound",
        message.title ?? null,
      ],
    );
    const actualConversationId =
      inserted[0]?.id ??
      (
        await db.query(
          "SELECT id FROM conversations WHERE tenant_id=$1 AND whatsapp_connection_id=$2 AND remote_jid=$3",
          [tenantId, connectionId, message.remoteJid],
        )
      ).rows[0]?.id;
    if (!actualConversationId) return null;
    if (contactId)
      await db.query(
        "UPDATE conversations SET contact_id=$1 WHERE id=$2 AND contact_id IS DISTINCT FROM $1",
        [contactId, actualConversationId],
      );
    if (message.title)
      await db.query(
        "UPDATE conversations SET title=$1 WHERE id=$2 AND title IS DISTINCT FROM $1",
        [message.title, actualConversationId],
      );
    const { rows } = await db.query(
      `INSERT INTO messages(id,tenant_id,conversation_id,whatsapp_connection_id,external_id,direction,kind,body,media_name,sender_name,sent_at,status,reply_to_external_id,sender_jid)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT(tenant_id,whatsapp_connection_id,external_id) DO NOTHING RETURNING id`,
      [
        randomUUID(),
        tenantId,
        actualConversationId,
        connectionId,
        message.externalId,
        direction,
        message.kind,
        message.body ?? "",
        message.mediaName ?? null,
        message.pushName ?? null,
        message.sentAt,
        direction === "inbound" ? "received" : "sent",
        message.replyToExternalId ?? null,
        message.senderJid ?? null,
      ],
    );
    if (!rows.length) {
      if (message.fromMe)
        await db.query(
          "UPDATE messages SET status='sent',status_updated_at=now() WHERE whatsapp_connection_id=$1 AND external_id=$2 AND direction='outbound' AND status IN ('queued','sending','uncertain')",
          [connectionId, message.externalId],
        );
      return { conversationId: actualConversationId, duplicate: true };
    }
    if (message.attachment)
      await db.query(
        "INSERT INTO message_media(tenant_id,message_id,mime,name,content) VALUES($1,$2,$3,$4,$5)",
        [
          tenantId,
          rows[0].id,
          message.attachment.mime,
          message.attachment.name,
          message.attachment.content,
        ],
      );
    await db.query(
      `UPDATE conversations SET last_message_at=CASE WHEN last_message_at IS NULL OR $2>=last_message_at THEN $2 ELSE last_message_at END,
       last_message_preview=CASE WHEN last_message_at IS NULL OR $2>=last_message_at THEN $3 ELSE last_message_preview END,
       last_message_from_me=CASE WHEN last_message_at IS NULL OR $2>=last_message_at THEN $4 ELSE last_message_from_me END,
       unread_count=unread_count+CASE WHEN $5='inbound' THEN 1 ELSE 0 END,
       status=CASE WHEN $5='inbound' AND status='closed' THEN 'waiting' ELSE status END,
       version=version+CASE WHEN $5='inbound' AND status='closed' THEN 1 ELSE 0 END,updated_at=now() WHERE id=$1`,
      [
        actualConversationId,
        message.sentAt,
        preview(message),
        direction === "outbound",
        direction,
      ],
    );
    return { conversationId: actualConversationId, duplicate: false };
  });
}
