import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { SMTPServer } from "smtp-server";
import { migrate } from "../src/migrate.js";
let ingestIncomingMessage: typeof import("../src/inbox-ingest.js").ingestIncomingMessage;
let dispatchOutbox: typeof import("../src/outbox.js").dispatchOutbox;
let recordReceipt: typeof import("../src/outbox.js").recordReceipt;
const testName = `caju_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  connectionTimeoutMillis: 10000,
});
let app: FastifyInstance;
const whatsappStates = new Map<
  string,
  { status: string; qr: string | null; qrExpiresAt: string | null }
>();
const whatsappGateway = {
  async start(_tenantId: string, connectionId: string) {
    whatsappStates.set(connectionId, {
      status: "qr_ready",
      qr: "qr-de-teste",
      qrExpiresAt: new Date(Date.now() + 55_000).toISOString(),
    });
  },
  async reconnect(tenantId: string, connectionId: string) {
    await this.start(tenantId, connectionId);
  },
  async remove(_tenantId: string, connectionId: string) {
    whatsappStates.delete(connectionId);
  },
  state(connectionId: string) {
    return whatsappStates.get(connectionId);
  },
  async resumeAll() {},
  async close() {},
};
let pool: pg.Pool;
let tx: typeof import("../src/db.js").transaction;
const passwords = "Uma senha bastante segura 2026!";
let a = "",
  b = "",
  agent = "",
  tenantA = "",
  tenantB = "",
  contactA = "",
  tagA = "",
  departmentA = "",
  agentId = "";
const tenantIds: string[] = [];
const call = (
  method: string,
  url: string,
  body?: unknown,
  session = "",
  headers = {},
) =>
  app.inject({
    method: method as "GET",
    url,
    headers: {
      "x-caju-request": "1",
      origin: "http://127.0.0.1:5173",
      ...(session ? { cookie: session } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
const session = (response: { cookies: { name: string; value: string }[] }) =>
  response.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
before(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${testName}`);
  const migrationURL = new URL(process.env.MIGRATION_DATABASE_URL!);
  migrationURL.pathname = `/${testName}`;
  const runtimeURL = new URL(process.env.DATABASE_URL!);
  runtimeURL.pathname = `/${testName}`;
  process.env.DATABASE_URL = runtimeURL.toString();
  ({ ingestIncomingMessage } = await import("../src/inbox-ingest.js"));
  ({ dispatchOutbox, recordReceipt } = await import("../src/outbox.js"));
  await migrate(migrationURL.toString());
  const db = await import("../src/db.js");
  pool = db.pool;
  tx = db.transaction;
  await db.assertDatabaseRole();
  app = await (await import("../src/app.js")).buildApp(false, whatsappGateway);
});
after(async () => {
  await app?.close();
  await pool?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${testName} WITH (FORCE)`);
    await admin.end();
  }
});
test("cadastro real, cookie HttpOnly e empresas independentes", async () => {
  let r = await call("POST", "/api/auth/register", {
    name: "Ana Gestora",
    company: "Empresa Alfa",
    email: "ana@example.test",
    password: passwords,
  });
  assert.equal(r.statusCode, 201, r.body);
  a = session(r);
  assert.match(r.headers["set-cookie"] as string, /HttpOnly/i);
  assert.match(r.headers["set-cookie"] as string, /SameSite=Lax/i);
  r = await call("POST", "/api/auth/register", {
    name: "Bruno Gestor",
    company: "Empresa Beta",
    email: "bruno@example.test",
    password: passwords,
  });
  assert.equal(r.statusCode, 201, r.body);
  b = session(r);
  const meA = (await call("GET", "/api/auth/me", undefined, a)).json(),
    meB = (await call("GET", "/api/auth/me", undefined, b)).json();
  tenantA = meA.user.tenantId;
  tenantB = meB.user.tenantId;
  assert.notEqual(tenantA, tenantB);
  const ws = (await call("GET", "/api/workspace", undefined, a)).json();
  assert.equal(ws.company.name, "Empresa Alfa");
  assert.equal(ws.counts.contacts, 0);
});
test("nega ausência de sessão, CSRF e origem não autorizada", async () => {
  assert.equal((await call("GET", "/api/contacts")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "ana@example.test", password: passwords },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call("PATCH", "/api/workspace", { name: "Invasão" }, a, {
        origin: "https://attacker.example",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call("POST", "/api/auth/login", {
        email: "ana@example.test",
        password: "incorreta",
      })
    ).statusCode,
    401,
  );
});
test("onboarding persistido e validação de horários", async () => {
  const settings = {
    timezone: "America/Sao_Paulo",
    hours: Array.from({ length: 7 }, () => ({
      enabled: true,
      start: "08:00",
      end: "18:00",
    })),
    outsideMessage: "Retornaremos no próximo expediente.",
  };
  assert.equal(
    (await call("PATCH", "/api/workspace", { settings }, a)).statusCode,
    200,
  );
  assert.deepEqual(
    (await call("GET", "/api/workspace", undefined, a)).json().company.settings,
    settings,
  );
  const invalid = {
    ...settings,
    hours: settings.hours.map((h) => ({ ...h, start: "19:00" })),
  };
  assert.equal(
    (await call("PATCH", "/api/workspace", { settings: invalid }, a))
      .statusCode,
    400,
  );
});
test("conexão por QR respeita permissão, tenant e limite do plano", async () => {
  let r = await call("POST", "/api/whatsapp/connections", undefined, a);
  assert.equal(r.statusCode, 201, r.body);
  const connectionId = r.json().id;
  let list = (
    await call("GET", "/api/whatsapp/connections", undefined, a)
  ).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, connectionId);
  assert.equal(list[0].qr, "qr-de-teste");
  assert.equal(
    (await call("POST", "/api/whatsapp/connections", undefined, a)).statusCode,
    409,
  );
  list = (await call("GET", "/api/whatsapp/connections", undefined, b)).json();
  assert.equal(list.length, 0);
  assert.equal(
    (
      await call(
        "DELETE",
        `/api/whatsapp/connections/${connectionId}`,
        undefined,
        a,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", "/api/whatsapp/connections", undefined, a)).json()
      .length,
    0,
  );
});
test("mensagens recebidas criam inbox idempotente e respeitam tenant", async () => {
  const connectionId = randomUUID();
  await tx(tenantA, (db) =>
    db.query(
      "INSERT INTO whatsapp_connections(id,tenant_id,label,status) VALUES($1,$2,'Inbox de teste','connected')",
      [connectionId, tenantA],
    ),
  );
  const sentAt = new Date("2026-09-11T12:00:00.000Z");
  const first = await ingestIncomingMessage(tenantA, connectionId, {
    externalId: "wamid-test-1",
    remoteJid: "5511991112222@s.whatsapp.net",
    fromMe: false,
    pushName: "Cliente Inbox",
    kind: "text",
    body: "Olá, preciso de ajuda",
    sentAt,
  });
  const duplicate = await ingestIncomingMessage(tenantA, connectionId, {
    externalId: "wamid-test-1",
    remoteJid: "5511991112222@s.whatsapp.net",
    fromMe: false,
    pushName: "Cliente Inbox",
    kind: "text",
    body: "Olá, preciso de ajuda",
    sentAt,
  });
  assert.equal(first?.duplicate, false);
  assert.equal(duplicate?.duplicate, true);
  const inbox = (await call("GET", "/api/inbox?q=Inbox", undefined, a)).json();
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].unread_count, 1);
  assert.equal(
    (await call("POST", `/api/inbox/${first?.conversationId}/read`, {}, a))
      .statusCode,
    200,
  );
  assert.equal(
    (await call("GET", "/api/inbox", undefined, b)).json().items.length,
    0,
  );
});
test("atendimento: concorrência, fila durável, idempotência, recibos e histórico", async () => {
  const conversation = (
    await call("GET", "/api/inbox?q=Inbox", undefined, a)
  ).json().items[0];
  const id = conversation.id;
  const me = (await call("GET", "/api/auth/me", undefined, a)).json().user;
  const other = (await call("GET", "/api/auth/me", undefined, b)).json().user;
  const patch = (body: object, cookie = a) =>
    call("PATCH", `/api/inbox/${id}`, body, cookie);
  assert.equal(
    (
      await patch({
        version: conversation.version,
        assigneeId: other.membershipId,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await patch(
        { version: conversation.version, assigneeId: me.membershipId },
        b,
      )
    ).statusCode,
    404,
  );
  const races = await Promise.all([
    patch({
      version: conversation.version,
      assigneeId: me.membershipId,
      status: "open",
    }),
    patch({
      version: conversation.version,
      assigneeId: me.membershipId,
      status: "open",
    }),
  ]);
  assert.deepEqual(races.map((r) => r.statusCode).sort(), [200, 409]);
  const requestId = randomUUID();
  const send = (body: object, cookie = a) =>
    call("POST", `/api/inbox/${id}/messages`, body, cookie);
  const sent = await Promise.all([
    send({ requestId, body: "Resposta persistida" }),
    send({ requestId, body: "Resposta persistida" }),
  ]);
  assert.equal(sent[0].statusCode, 201, sent[0].body);
  assert.equal(sent[0].json().id, sent[1].json().id);
  assert.equal(sent[0].json().status, "queued");
  assert.equal(
    (await send({ requestId, body: "Outra resposta" })).statusCode,
    409,
  );
  assert.equal(
    (await send({ requestId: randomUUID(), body: "   " })).statusCode,
    400,
  );
  assert.equal(
    (await send({ requestId: randomUUID(), body: "Tentativa cruzada" }, b))
      .statusCode,
    404,
  );
  const connectionId = (
    await tx(tenantA, (db) =>
      db.query("SELECT whatsapp_connection_id FROM conversations WHERE id=$1", [
        id,
      ]),
    )
  ).rows[0].whatsapp_connection_id;
  let dispatches = 0,
    externalId = "";
  const transport = async (jid: string, body: string, external: string) => {
    assert.match(jid, /@s.whatsapp.net$/);
    assert.equal(body, "Resposta persistida");
    dispatches++;
    externalId = external;
  };
  await Promise.all([
    dispatchOutbox(tenantA, connectionId, transport),
    dispatchOutbox(tenantA, connectionId, transport),
  ]);
  assert.equal(dispatches, 1);
  await recordReceipt(tenantA, connectionId, externalId, "read");
  await recordReceipt(tenantA, connectionId, externalId, "delivered");
  let details = (
    await call("GET", `/api/inbox/${id}/messages`, undefined, a)
  ).json();
  assert.equal(
    details.messages.find((m: any) => m.id === sent[0].json().id).status,
    "read",
  );
  const uncertain = await send({
    requestId: randomUUID(),
    body: "Resultado incerto",
  });
  await dispatchOutbox(tenantA, connectionId, async () => {
    throw new Error("socket closed after write");
  });
  await dispatchOutbox(tenantA, connectionId, async () => {
    throw new Error("Must never resend automatically");
  });
  details = (
    await call("GET", `/api/inbox/${id}/messages`, undefined, a)
  ).json();
  assert.equal(
    details.messages.find((m: any) => m.id === uncertain.json().id).status,
    "uncertain",
  );
  await send({
    requestId: randomUUID(),
    body: "Contexto somente para a equipe",
    internal: true,
  });
  let noteDispatched = false;
  await dispatchOutbox(tenantA, connectionId, async () => {
    noteDispatched = true;
  });
  assert.equal(noteDispatched, false);
  assert.equal(
    (await patch({ version: details.conversation.version, status: "closed" }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await patch({
        version: details.conversation.version,
        status: "closed",
        reason: "Solicitação resolvida",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await send({ requestId: randomUUID(), body: "Não enviar encerrado" }))
      .statusCode,
    409,
  );
  await ingestIncomingMessage(tenantA, connectionId, {
    externalId: "reopen-inbound",
    remoteJid: "5511991112222@s.whatsapp.net",
    fromMe: false,
    kind: "text",
    body: "Uma nova dúvida",
    sentAt: new Date(),
  });
  details = (
    await call("GET", `/api/inbox/${id}/messages`, undefined, a)
  ).json();
  assert.equal(details.conversation.status, "waiting");
  assert.equal(
    (await patch({ version: details.conversation.version, assigneeId: null }))
      .statusCode,
    200,
  );
  details = (
    await call("GET", `/api/inbox/${id}/messages`, undefined, a)
  ).json();
  assert.equal(details.conversation.assignee_id, null);
  assert.equal(
    (await send({ requestId: randomUUID(), body: "Sem assumir" })).statusCode,
    409,
  );
  const oldestId = details.messages[0].id;
  await call("POST", `/api/inbox/${id}/read`, { throughId: oldestId }, a);
  assert.equal(
    (await call("GET", `/api/inbox/${id}/messages`, undefined, a)).json()
      .conversation.unread_count,
    1,
  );
  await tx(tenantA, (db) =>
    db.query(
      `INSERT INTO messages(id,tenant_id,conversation_id,whatsapp_connection_id,external_id,direction,kind,body,sent_at)
    SELECT gen_random_uuid(),$1,$2,$3,'history-'||n,'inbound','text','Histórico '||n,now()+n*interval '1 second' FROM generate_series(1,120) n`,
      [tenantA, id, connectionId],
    ),
  );
  const recent = (
    await call("GET", `/api/inbox/${id}/messages`, undefined, a)
  ).json();
  assert.equal(recent.messages.length, 100);
  assert.equal(recent.hasMore, true);
  assert.equal(recent.messages.at(-1).body, "Histórico 120");
  const older = (
    await call(
      "GET",
      `/api/inbox/${id}/messages?before=${recent.messages[0].id}`,
      undefined,
      a,
    )
  ).json();
  assert.equal(older.hasMore, false);
  assert.ok(
    older.messages.some(
      (m: any) => m.body === "Contexto somente para a equipe",
    ),
  );
  assert.equal(
    (await call("GET", "/api/inbox?q=Contexto", undefined, a)).json().items
      .length,
    1,
  );
  assert.equal(
    (await call("GET", `/api/inbox/${id}/messages`, undefined, b)).statusCode,
    404,
  );
});

test("mídia privada valida conteúdo, mantém idempotência e impede acesso cruzado", async () => {
  const connectionId = randomUUID();
  await tx(tenantA, (db) => db.query("INSERT INTO whatsapp_connections(id,tenant_id,label,status) VALUES($1,$2,'Mídia de teste','attention')", [connectionId, tenantA]));
  const result = await ingestIncomingMessage(tenantA, connectionId, { externalId: "media-inbound", remoteJid: "5511999997777@s.whatsapp.net", fromMe: false, kind: "text", body: "Pode mandar o documento?", sentAt: new Date() });
  const id = result!.conversationId;
  const details = (await call("GET", `/api/inbox/${id}/messages`, undefined, a)).json();
  const me = (await call("GET", "/api/auth/me", undefined, a)).json().user;
  await call("PATCH", `/api/inbox/${id}`, { version: details.conversation.version, assigneeId: me.membershipId, status: "open" }, a);
  const attachment = { name: "comprovante.pdf", base64: Buffer.from("%PDF-1.4\n% Documento de teste isolado\n%%EOF").toString("base64") };
  const requestId = randomUUID();
  const posted = await call("POST", `/api/inbox/${id}/messages`, { requestId, attachment }, a);
  assert.equal(posted.statusCode, 201, posted.body);
  const messageId = posted.json().id;
  assert.equal((await call("POST", `/api/inbox/${id}/messages`, { requestId, attachment }, a)).json().id, messageId);
  assert.equal((await call("POST", `/api/inbox/${id}/messages`, { requestId, attachment: { ...attachment, name: "outro.pdf" } }, a)).statusCode, 409);
  const url = `/api/inbox/${id}/messages/${messageId}/media`;
  const media = await call("GET", url, undefined, a);
  assert.equal(media.statusCode, 200); assert.equal(media.headers["content-type"], "application/pdf");
  assert.match(String(media.headers["content-disposition"]), /^attachment/);
  assert.match(String(media.headers["cache-control"]), /no-store/);
  assert.deepEqual(media.rawPayload, Buffer.from(attachment.base64, "base64"));
  assert.equal((await call("GET", url, undefined, b)).statusCode, 404);
  assert.equal((await call("GET", url)).statusCode, 401);
  assert.equal((await call("POST", `/api/inbox/${id}/messages`, { requestId: randomUUID(), attachment: { name: "imagem.png", base64: Buffer.from("<html>Não é imagem</html>").toString("base64") } }, a)).statusCode, 400);
  assert.equal((await call("POST", `/api/inbox/${id}/messages`, { requestId: randomUUID(), internal: true, attachment }, a)).statusCode, 400);
  let delivered = false;
  await dispatchOutbox(tenantA, connectionId, async (_jid, _body, _externalId, file) => { assert.equal(file?.mime, "application/pdf"); assert.deepEqual(file?.content, media.rawPayload); delivered = true; });
  assert.equal(delivered, true);
});

test("contatos e etiquetas persistem, filtros e edição funcionam", async () => {
  let r = await call(
    "POST",
    "/api/tags",
    { name: "Recorrente", color: "coral" },
    a,
  );
  assert.equal(r.statusCode, 201, r.body);
  tagA = r.json().id;
  r = await call(
    "POST",
    "/api/contacts",
    {
      name: "Cliente de verdade no teste",
      phone: "+5511999998888",
      notes: "Preferência de horário",
      tagIds: [tagA],
    },
    a,
  );
  assert.equal(r.statusCode, 201, r.body);
  contactA = r.json().id;
  const found = (
    await call("GET", `/api/contacts?q=verdade&tag=${tagA}`, undefined, a)
  ).json();
  assert.equal(found.total, 1);
  assert.equal(found.items[0].tags[0].name, "Recorrente");
  r = await call(
    "PATCH",
    `/api/contacts/${contactA}`,
    {
      name: "Contato atualizado",
      phone: "+5511999998888",
      notes: "Atualizado",
      tagIds: [tagA],
    },
    a,
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(
    (await call("GET", `/api/contacts/${contactA}`, undefined, a)).json().notes,
    "Atualizado",
  );
  assert.equal(
    (
      await call(
        "POST",
        "/api/contacts",
        { name: "Duplicado", phone: "+5511999998888" },
        a,
      )
    ).statusCode,
    409,
  );
});
test("fronteira de tenant bloqueia leitura, alteração e associação cruzada", async () => {
  assert.equal(
    (await call("GET", "/api/contacts", undefined, b)).json().total,
    0,
  );
  assert.equal(
    (await call("GET", `/api/contacts/${contactA}`, undefined, b)).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        `/api/contacts/${contactA}`,
        { name: "Vazamento", phone: "+5511999998888" },
        b,
      )
    ).statusCode,
    404,
  );
  const r = await call(
    "POST",
    "/api/contacts",
    { name: "Contato beta", phone: "+5511999997777", tagIds: [tagA] },
    b,
  );
  assert.equal(r.statusCode, 400, r.body);
  assert.equal(
    (await call("GET", "/api/contacts", undefined, b)).json().total,
    0,
    "Partial insert must roll back",
  );
  assert.equal(
    (await call("POST", "/api/auth/switch", { tenantId: tenantA }, b))
      .statusCode,
    403,
  );
  const unscoped = await pool.query("SELECT id FROM contacts");
  assert.equal(unscoped.rows.length, 0, "RLS fails closed without tenant");
  assert.equal(
    (
      await tx(tenantB, (db) =>
        db.query("SELECT id FROM contacts WHERE id=$1", [contactA]),
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    tx(tenantB, (db) =>
      db.query(
        "INSERT INTO contacts(id,tenant_id,name,phone) VALUES($1,$2,$3,$4)",
        [randomUUID(), tenantA, "Cross tenant", "+5511000000000"],
      ),
    ),
  );
});
test("limites são serializados sob concorrência", async () => {
  const r = await Promise.all(
    Array.from({ length: 7 }, (_, i) =>
      call("POST", "/api/departments", { name: `Departamento ${i}` }, a),
    ),
  );
  assert.equal(r.filter((x) => x.statusCode === 201).length, 5);
  assert.equal(r.filter((x) => x.statusCode === 409).length, 2);
  departmentA = r.find((x) => x.statusCode === 201)!.json().id;
});
test("convite é aceito uma vez, gera sessão real e restringe o atendente", async () => {
  const r = await call(
    "POST",
    "/api/team/invitations",
    { email: "atendente@example.test", role: "agent" },
    a,
  );
  assert.equal(r.statusCode, 201, r.body);
  const raw = new URL(r.json().url).searchParams.get("token");
  assert.equal(
    (await call("GET", `/api/auth/invitation?token=${raw}`)).statusCode,
    200,
  );
  const accepted = await call("POST", "/api/auth/accept-invitation", {
    token: raw,
    name: "Carla Atendente",
    password: passwords,
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  agent = session(accepted);
  assert.equal(
    (await call("GET", "/api/whatsapp/connections", undefined, agent))
      .statusCode,
    403,
  );
  assert.equal(
    (await call("GET", `/api/auth/invitation?token=${raw}`)).statusCode,
    404,
  );
  const user = (await call("GET", "/api/auth/me", undefined, agent)).json()
    .user;
  agentId = user.membershipId;
  assert.equal(user.role, "agent");
  assert.equal(
    (await call("GET", "/api/team", undefined, agent)).statusCode,
    403,
  );
  assert.equal(
    (await call("PATCH", "/api/workspace", { name: "Indevido" }, agent))
      .statusCode,
    403,
  );
  assert.equal(
    (await call("GET", "/api/contacts", undefined, agent)).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", "/api/audit", undefined, agent)).statusCode,
    403,
  );
});
test("respostas departamentais respeitam associação da equipe", async () => {
  const r = await call(
    "POST",
    "/api/quick-replies",
    {
      title: "Orientação comercial",
      shortcut: "comercial",
      body: "Mensagem comercial",
      departmentId: departmentA,
    },
    a,
  );
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(
    (await call("GET", "/api/quick-replies", undefined, agent)).json().length,
    0,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        `/api/team/${agentId}`,
        { role: "agent", active: true, departmentIds: [departmentA] },
        a,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", "/api/quick-replies", undefined, agent)).json().length,
    1,
  );
  assert.equal(
    (await call("GET", "/api/quick-replies", undefined, b)).json().length,
    0,
  );
});
test("retornos são pessoais, persistem e permitem reabrir", async () => {
  const r = await call(
    "POST",
    "/api/followups",
    {
      contactId: contactA,
      note: "Confirmar orçamento",
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    },
    agent,
  );
  assert.equal(r.statusCode, 201, r.body);
  const followup = r.json().id;
  assert.equal(
    (await call("GET", "/api/followups", undefined, a)).json().length,
    0,
  );
  assert.equal(
    (await call("PATCH", `/api/followups/${followup}`, { completed: true }, a))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        `/api/followups/${followup}`,
        { completed: true },
        agent,
      )
    ).statusCode,
    200,
  );
  assert.ok(
    (await call("GET", "/api/followups", undefined, agent)).json()[0]
      .completed_at,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        `/api/followups/${followup}`,
        { completed: false },
        agent,
      )
    ).statusCode,
    200,
  );
});
test("último administrador não pode ser desativado; revogação é imediata", async () => {
  const me = (await call("GET", "/api/auth/me", undefined, a)).json().user;
  assert.equal(
    (
      await call(
        "PATCH",
        `/api/team/${me.membershipId}`,
        { role: "agent", active: false, departmentIds: [] },
        a,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "PATCH",
        `/api/team/${agentId}`,
        { role: "agent", active: false, departmentIds: [] },
        a,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", "/api/contacts", undefined, agent)).statusCode,
    401,
  );
  assert.equal(
    (
      await call("POST", "/api/auth/login", {
        email: "atendente@example.test",
        password: passwords,
      })
    ).statusCode,
    403,
  );
});
test("preferência de tema e logout persistem corretamente", async () => {
  assert.equal(
    (await call("PATCH", "/api/auth/profile", { theme: "cafe" }, b)).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", "/api/auth/me", undefined, b)).json().user.theme,
    "cafe",
  );
  assert.equal((await call("POST", "/api/auth/logout", {}, b)).statusCode, 200);
  assert.equal(
    (await call("GET", "/api/auth/me", undefined, b)).statusCode,
    401,
  );
});
test("auditoria é real, isolada e imutável no papel da aplicação", async () => {
  const events = (await call("GET", "/api/audit", undefined, a)).json();
  assert.ok(
    events.some((e: { action: string }) => e.action === "Contato criado"),
  );
  assert.ok(
    events.every(
      (e: { actor_name: string }) => e.actor_name !== "Bruno Gestor",
    ),
  );
  await assert.rejects(
    tx(tenantA, (db) => db.query("DELETE FROM audit_events")),
  );
});
test("recuperação indisponível é explícita; entrega e token de uso único funcionam", async () => {
  if (
    !(
      await pool.query("SELECT 1 FROM identities WHERE email=$1", [
        "ana@example.test",
      ])
    ).rowCount
  ) {
    const registered = await call("POST", "/api/auth/register", {
      name: "Ana Gestora",
      company: "Empresa Alfa",
      email: "ana@example.test",
      password: passwords,
    });
    assert.equal(registered.statusCode, 201, registered.body);
    a = session(registered);
  }
  assert.equal(
    (await call("POST", "/api/auth/forgot", { email: "ana@example.test" }))
      .statusCode,
    503,
  );
  let message = "";
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, _session, callback) {
      stream.on("data", (chunk) => (message += chunk.toString()));
      stream.on("end", () => callback());
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  const address = smtp.server.address();
  assert.ok(address && typeof address === "object");
  process.env.SMTP_URL = `smtp://127.0.0.1:${address.port}`;
  process.env.MAIL_FROM = "Caju <acesso@caju.test>";
  try {
    const forgot = await call("POST", "/api/auth/forgot", {
      email: "ana@example.test",
    });
    assert.equal(forgot.statusCode, 200, forgot.body);
    const decoded = message.replace(/=\r?\n/g, "").replaceAll("=3D", "=");
    const raw = /token=([A-Za-z0-9_-]+)/.exec(decoded)?.[1];
    assert.ok(raw, `Recovery email must carry a reset token: ${message}`);
    assert.equal(
      (
        await call("POST", "/api/auth/reset", {
          token: raw,
          password: passwords + "nova",
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await call("POST", "/api/auth/reset", {
          token: raw,
          password: passwords + "outra",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await call("GET", "/api/auth/me", undefined, a)).statusCode,
      401,
    );
    assert.equal(
      (
        await call("POST", "/api/auth/login", {
          email: "ana@example.test",
          password: passwords + "nova",
        })
      ).statusCode,
      200,
    );
  } finally {
    smtp.close();
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
  }
});
