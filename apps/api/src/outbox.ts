import { transaction } from "./db.js";
import type { Attachment } from "./media.js";

export type SendText = (
  jid: string,
  body: string,
  externalId: string,
  attachment?: Attachment,
) => Promise<void>;

// A committed queue survives process restarts. Only its connection owner dispatches it.
// An interrupted send is uncertain: retransmission could duplicate a real message.
export async function dispatchOutbox(
  tenantId: string,
  connectionId: string,
  send: SendText,
  { sweep = true }: { sweep?: boolean } = {},
) {
  const message = await transaction(tenantId, async (db) => {
    if (sweep)
      await db.query(
        "UPDATE messages SET status='uncertain',status_updated_at=now() WHERE whatsapp_connection_id=$1 AND status='sending' AND status_updated_at<now()-interval '60 seconds'",
        [connectionId],
      );
    const { rows } = await db.query(
      `SELECT m.id,m.body,m.external_id,c.remote_jid FROM messages m JOIN conversations c ON c.id=m.conversation_id
       WHERE m.whatsapp_connection_id=$1 AND m.status='queued' ORDER BY m.created_at,m.id LIMIT 1 FOR UPDATE OF m SKIP LOCKED`,
      [connectionId],
    );
    if (!rows[0]) return null;
    await db.query(
      "UPDATE messages SET status='sending',status_updated_at=now() WHERE id=$1",
      [rows[0].id],
    );
    const media = await db.query(
      "SELECT mime,name,content FROM message_media WHERE message_id=$1",
      [rows[0].id],
    );
    return { ...rows[0], attachment: media.rows[0] };
  });
  if (!message) return;
  let status = "sent";
  try {
    await send(
      message.remote_jid,
      message.body,
      message.external_id,
      message.attachment,
    );
  } catch {
    status = "uncertain";
  }
  await transaction(tenantId, (db) =>
    db.query(
      "UPDATE messages SET status=$2,status_updated_at=now() WHERE id=$1 AND status IN ('sending','uncertain')",
      [message.id, status],
    ),
  );
}

export async function recordReceipt(
  tenantId: string,
  connectionId: string,
  externalId: string,
  status: "sent" | "delivered" | "read",
) {
  await transaction(tenantId, (db) =>
    db.query(
      `UPDATE messages SET status=$3,status_updated_at=now() WHERE whatsapp_connection_id=$1 AND external_id=$2 AND direction='outbound'
     AND array_position(ARRAY['queued','sending','uncertain','sent','delivered','read'],status)<array_position(ARRAY['queued','sending','uncertain','sent','delivered','read'],$3)`,
      [connectionId, externalId, status],
    ),
  );
}
