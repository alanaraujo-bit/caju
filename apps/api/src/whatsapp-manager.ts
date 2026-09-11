import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  initAuthCreds,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type WASocket,
} from "baileys";
import pino from "pino";
import { pool, transaction } from "./db.js";
import { ingestIncomingMessage } from "./inbox-ingest.js";

export type WhatsAppRuntimeState = {
  status: string;
  qr: string | null;
  qrExpiresAt: string | null;
};

export interface WhatsAppGateway {
  start(tenantId: string, connectionId: string): Promise<void>;
  reconnect(tenantId: string, connectionId: string): Promise<void>;
  remove(tenantId: string, connectionId: string): Promise<void>;
  state(connectionId: string): WhatsAppRuntimeState | undefined;
  resumeAll(): Promise<void>;
  close(): Promise<void>;
}

type LiveConnection = {
  tenantId: string;
  socket?: WASocket;
  generation: number;
  stopped: boolean;
  reconnectAttempts: number;
  retry?: NodeJS.Timeout;
  heartbeat?: NodeJS.Timeout;
  runtime: WhatsAppRuntimeState;
};

const silentLogger = pino({ level: "silent" });
const log = pino({ name: "whatsapp" });

function encryptionKey() {
  const raw = process.env.WHATSAPP_SESSION_KEY;
  if (!raw) throw new Error("WHATSAPP_SESSION_KEY is required");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error("WHATSAPP_SESSION_KEY must be 32 random bytes in base64");
  return key;
}

function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plain = JSON.stringify(value, BufferJSON.replacer);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function decrypt<T>(payload: string): T {
  const [iv, tag, encrypted] = payload
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !encrypted)
    throw new Error("Invalid encrypted auth payload");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plain, BufferJSON.reviver) as T;
}

async function authState(
  tenantId: string,
  connectionId: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const stored = await transaction(tenantId, async (db) => {
    const { rows } = await db.query(
      "SELECT category,key_id,encrypted_payload FROM whatsapp_auth_keys WHERE connection_id=$1",
      [connectionId],
    );
    return rows as {
      category: string;
      key_id: string;
      encrypted_payload: string;
    }[];
  });
  const cache = new Map(
    stored.map((row) => [
      `${row.category}:${row.key_id}`,
      decrypt<unknown>(row.encrypted_payload),
    ]),
  );
  const creds =
    (cache.get("creds:main") as AuthenticationCreds | undefined) ??
    initAuthCreds();

  const keys: AuthenticationState["keys"] = {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      const result: { [id: string]: SignalDataTypeMap[T] } = {};
      for (const keyId of ids) {
        const value = cache.get(`${type}:${keyId}`) as
          SignalDataTypeMap[T] | undefined;
        if (value !== undefined) result[keyId] = value;
      }
      return result;
    },
    async set(data: SignalDataSet) {
      await transaction(tenantId, async (db) => {
        for (const [category, entries] of Object.entries(data)) {
          for (const [keyId, value] of Object.entries(entries ?? {})) {
            const cacheKey = `${category}:${keyId}`;
            if (value === null || value === undefined) {
              cache.delete(cacheKey);
              await db.query(
                "DELETE FROM whatsapp_auth_keys WHERE connection_id=$1 AND category=$2 AND key_id=$3",
                [connectionId, category, keyId],
              );
            } else {
              cache.set(cacheKey, value);
              await db.query(
                `INSERT INTO whatsapp_auth_keys(tenant_id,connection_id,category,key_id,encrypted_payload)
                 VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,connection_id,category,key_id)
                 DO UPDATE SET encrypted_payload=excluded.encrypted_payload,updated_at=now()`,
                [tenantId, connectionId, category, keyId, encrypt(value)],
              );
            }
          }
        }
      });
    },
  };
  return {
    state: { creds, keys },
    saveCreds: async () => {
      cache.set("creds:main", creds);
      await transaction(tenantId, (db) =>
        db.query(
          `INSERT INTO whatsapp_auth_keys(tenant_id,connection_id,category,key_id,encrypted_payload)
           VALUES($1,$2,'creds','main',$3) ON CONFLICT(tenant_id,connection_id,category,key_id)
           DO UPDATE SET encrypted_payload=excluded.encrypted_payload,updated_at=now()`,
          [tenantId, connectionId, encrypt(creds)],
        ),
      );
    },
  };
}

async function persistStatus(
  tenantId: string,
  connectionId: string,
  status: string,
  values: {
    jid?: string | null;
    phone?: string | null;
    profileName?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    attempts?: number;
  } = {},
) {
  await transaction(tenantId, (db) =>
    db.query(
      `UPDATE whatsapp_connections SET status=$2,jid=coalesce($3,jid),phone=coalesce($4,phone),
       profile_name=coalesce($5,profile_name),last_error_code=$6,last_error_message=$7,
       reconnect_attempts=coalesce($8,reconnect_attempts),last_seen_at=CASE WHEN $2='connected' THEN now() ELSE last_seen_at END,
       connected_at=CASE WHEN $2='connected' THEN coalesce(connected_at,now()) ELSE connected_at END,updated_at=now() WHERE id=$1`,
      [
        connectionId,
        status,
        values.jid,
        values.phone,
        values.profileName,
        values.errorCode,
        values.errorMessage,
        values.attempts,
      ],
    ),
  );
}

function disconnectCode(error: unknown) {
  const shaped = error as {
    output?: { statusCode?: number };
    data?: { statusCode?: number };
  };
  return shaped?.output?.statusCode ?? shaped?.data?.statusCode ?? 0;
}

function messageTimestamp(value: unknown) {
  if (typeof value === "number") return new Date(value * 1000);
  if (typeof value === "string" && /^\d+$/.test(value)) return new Date(Number(value) * 1000);
  if (value && typeof value === "object" && "low" in value) return new Date(Number((value as { low: number }).low) * 1000);
  return new Date();
}

function normalizeIncoming(message: any) {
  const content = message?.message;
  if (!message?.key?.id || !message?.key?.remoteJid || !content) return null;
  const [kind, value] = Object.entries(content).find(([name]) =>
    ["conversation", "extendedTextMessage", "imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(name),
  ) ?? [];
  if (!kind) return null;
  const entry = value as any;
  const body = kind === "conversation" ? String(value ?? "") : entry?.text ?? entry?.caption ?? "";
  return {
    externalId: String(message.key.id),
    remoteJid: String(message.key.remoteJid),
    fromMe: Boolean(message.key.fromMe),
    pushName: message.pushName ?? null,
    kind: kind === "conversation" || kind === "extendedTextMessage" ? "text" : kind.replace("Message", "").toLowerCase(),
    body: String(body),
    mediaName: entry?.fileName ?? null,
    sentAt: messageTimestamp(message.messageTimestamp),
    replyToExternalId: message.message?.extendedTextMessage?.contextInfo?.stanzaId ?? null,
  } as const;
}

export class BaileysGateway implements WhatsAppGateway {
  private live = new Map<string, LiveConnection>();
  private readonly workerId = randomUUID();
  private sweep?: NodeJS.Timeout;

  state(connectionId: string) {
    return this.live.get(connectionId)?.runtime;
  }

  async start(tenantId: string, connectionId: string) {
    const existing = this.live.get(connectionId);
    if (existing && !existing.stopped) return;
    if (!(await this.claim(tenantId, connectionId))) return;
    const connection: LiveConnection = {
      tenantId,
      generation: (existing?.generation ?? 0) + 1,
      stopped: false,
      reconnectAttempts: 0,
      runtime: { status: "connecting", qr: null, qrExpiresAt: null },
    };
    this.live.set(connectionId, connection);
    connection.heartbeat = setInterval(
      () => this.renew(connectionId, connection).catch(() => {}),
      15_000,
    );
    connection.heartbeat.unref();
    await this.open(connectionId, connection);
  }

  async reconnect(tenantId: string, connectionId: string) {
    await this.stopSocket(connectionId);
    await this.start(tenantId, connectionId);
  }

  async remove(tenantId: string, connectionId: string) {
    const connection = this.live.get(connectionId);
    if (connection) {
      connection.stopped = true;
      if (connection.retry) clearTimeout(connection.retry);
      if (connection.heartbeat) clearInterval(connection.heartbeat);
      await connection.socket?.logout().catch(() => {});
      await connection.socket?.end(undefined).catch(() => {});
      this.live.delete(connectionId);
    }
  }

  async resumeAll() {
    await this.resumeTargets();
    this.sweep ??= setInterval(
      () => this.resumeTargets().catch(() => {}),
      20_000,
    );
    this.sweep.unref();
  }

  async close() {
    if (this.sweep) clearInterval(this.sweep);
    await Promise.all([...this.live.keys()].map((id) => this.stopSocket(id)));
  }

  private async stopSocket(connectionId: string) {
    const connection = this.live.get(connectionId);
    if (!connection) return;
    connection.stopped = true;
    if (connection.retry) clearTimeout(connection.retry);
    if (connection.heartbeat) clearInterval(connection.heartbeat);
    await connection.socket?.end(undefined).catch(() => {});
    this.live.delete(connectionId);
    await transaction(connection.tenantId, (db) =>
      db.query(
        "UPDATE whatsapp_connections SET worker_id=NULL,lease_until=NULL WHERE id=$1 AND worker_id=$2",
        [connectionId, this.workerId],
      ),
    ).catch(() => {});
  }

  private async resumeTargets() {
    const { rows } = await pool.query(
      "SELECT tenant_id,connection_id FROM whatsapp_resume_targets()",
    );
    for (const row of rows)
      await this.start(row.tenant_id, row.connection_id).catch(() => {});
  }

  private async claim(tenantId: string, connectionId: string) {
    return transaction(tenantId, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE whatsapp_connections SET worker_id=$2,lease_until=now()+interval '45 seconds'
         WHERE id=$1 AND (lease_until IS NULL OR lease_until<now() OR worker_id=$2)`,
        [connectionId, this.workerId],
      );
      return Boolean(rowCount);
    });
  }

  private async renew(connectionId: string, connection: LiveConnection) {
    const renewed = await transaction(connection.tenantId, async (db) => {
      const { rowCount } = await db.query(
        "UPDATE whatsapp_connections SET lease_until=now()+interval '45 seconds' WHERE id=$1 AND worker_id=$2",
        [connectionId, this.workerId],
      );
      return Boolean(rowCount);
    });
    if (!renewed) await this.stopSocket(connectionId);
  }

  private async open(connectionId: string, connection: LiveConnection) {
    const generation = ++connection.generation;
    connection.runtime = { status: "connecting", qr: null, qrExpiresAt: null };
    await persistStatus(connection.tenantId, connectionId, "connecting", {
      attempts: connection.reconnectAttempts,
      errorCode: null,
      errorMessage: null,
    });
    try {
      const { state, saveCreds } = await authState(
        connection.tenantId,
        connectionId,
      );
      const socket = makeWASocket({
        auth: state,
        logger: silentLogger,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        shouldSyncHistoryMessage: () => false,
        browser: ["Caju", "Chrome", "1.0.0"],
      });
      connection.socket = socket;
      socket.ev.on("creds.update", saveCreds);
      socket.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type === "append" || type === "notify") {
          for (const message of messages) {
            const normalized = normalizeIncoming(message);
            if (normalized)
              await ingestIncomingMessage(connection.tenantId, connectionId, normalized).catch((error) =>
                log.error({ err: error, connectionId, externalId: normalized.externalId }, "falha ao registrar mensagem recebida"),
              );
          }
        }
      });
      socket.ev.on("connection.update", async (update) => {
        if (
          connection.stopped ||
          connection.generation !== generation ||
          this.live.get(connectionId) !== connection
        )
          return;
        if (update.qr) {
          const expires = new Date(Date.now() + 55_000).toISOString();
          connection.runtime = {
            status: "qr_ready",
            qr: update.qr,
            qrExpiresAt: expires,
          };
          await persistStatus(connection.tenantId, connectionId, "qr_ready");
        }
        if (update.connection === "open") {
          connection.reconnectAttempts = 0;
          const jid = socket.user?.id ?? null;
          const phone = jid ? `+${jid.split(":")[0].split("@")[0]}` : null;
          connection.runtime = {
            status: "connected",
            qr: null,
            qrExpiresAt: null,
          };
          await persistStatus(connection.tenantId, connectionId, "connected", {
            jid,
            phone,
            profileName: socket.user?.name ?? null,
            attempts: 0,
          });
        }
        if (update.connection === "close")
          await this.handleClose(
            connectionId,
            connection,
            disconnectCode(update.lastDisconnect?.error),
          );
      });
    } catch (error) {
      await this.handleClose(connectionId, connection, disconnectCode(error));
    }
  }

  private async handleClose(
    connectionId: string,
    connection: LiveConnection,
    code: number,
  ) {
    if (connection.stopped || this.live.get(connectionId) !== connection)
      return;
    connection.socket = undefined;
    connection.runtime.qr = null;
    connection.runtime.qrExpiresAt = null;
    if (
      code === DisconnectReason.loggedOut ||
      code === DisconnectReason.badSession ||
      code === DisconnectReason.forbidden
    ) {
      connection.runtime.status = "attention";
      await persistStatus(connection.tenantId, connectionId, "attention", {
        errorCode: String(code),
        errorMessage:
          code === DisconnectReason.loggedOut
            ? "A sessão foi removida no celular. Conecte o número novamente."
            : "O WhatsApp recusou esta sessão. Remova a conexão e gere um novo QR Code.",
      });
      return;
    }
    connection.reconnectAttempts += 1;
    connection.runtime.status = "reconnecting";
    await persistStatus(connection.tenantId, connectionId, "reconnecting", {
      attempts: connection.reconnectAttempts,
      errorCode: code ? String(code) : "CONNECTION_LOST",
      errorMessage: "A conexão caiu. O Caju está tentando reconectar sozinho.",
    });
    const delay = Math.min(
      30_000,
      1_000 * 2 ** Math.min(connection.reconnectAttempts - 1, 5),
    );
    connection.retry = setTimeout(
      () => this.open(connectionId, connection).catch(() => {}),
      delay + Math.floor(Math.random() * 750),
    );
    connection.retry.unref();
  }
}
