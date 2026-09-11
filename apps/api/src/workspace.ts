import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, type DB } from "./db.js";
import { allow, authenticate } from "./auth.js";
import { AppError, audit, digest, token } from "./security.js";

const text = z.string().trim().min(1).max(100);
const id = (req: FastifyRequest) =>
  z.object({ id: z.uuid() }).parse(req.params).id;
const page = z.object({
  q: z.string().max(100).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
const contactSchema = z.object({
  name: text,
  phone: z
    .string()
    .regex(
      /^\+[1-9]\d{7,14}$/,
      "Informe o telefone com +, código do país e DDD.",
    ),
  email: z.union([z.email(), z.literal("")]).default(""),
  notes: z.string().max(5000).default(""),
  tagIds: z.array(z.uuid()).max(30).default([]),
});
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const day = z
  .object({ enabled: z.boolean(), start: time, end: time })
  .refine(
    (x) => !x.enabled || x.start < x.end,
    "O fechamento precisa ser depois da abertura.",
  );
const settingsSchema = z.object({
  timezone: z.string().refine((t) => {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: t });
      return true;
    } catch {
      return false;
    }
  }, "Fuso horário inválido."),
  hours: z.array(day).length(7),
  outsideMessage: z.string().max(1000),
  teamConfirmed: z.boolean().optional(),
});
async function event(
  db: DB,
  req: FastifyRequest,
  action: string,
  entity: string,
  metadata = {},
) {
  await audit(
    db,
    req.user.tenantId,
    req.user.userId,
    action,
    entity,
    req.id,
    metadata,
  );
}
async function ensureLimit(
  db: DB,
  tenantId: string,
  key: "users" | "departments",
) {
  const {
    rows: [company],
  } = await db.query(
    "SELECT c.id,p.limits FROM companies c JOIN plans p ON p.code=c.plan_code WHERE c.id=$1 FOR UPDATE OF c",
    [tenantId],
  );
  const query =
    key === "departments"
      ? "SELECT count(*)::int AS total FROM departments"
      : "SELECT ((SELECT count(*) FROM memberships WHERE active)+(SELECT count(*) FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()))::int AS total";
  const {
    rows: [count],
  } = await db.query(query);
  if (count.total >= company.limits[key])
    throw new AppError(
      409,
      "O limite do plano foi atingido. Revise os itens existentes ou fale com o responsável pelo Caju.",
      "PLAN_LIMIT",
    );
}
export async function workspaceRoutes(app: FastifyInstance) {
  app.get("/api/workspace", { preHandler: authenticate }, async (req) =>
    transaction(req.user.tenantId, async (db) => {
      const {
        rows: [company],
      } = await db.query(
        "SELECT c.*,p.name AS plan_name,p.limits,p.features FROM companies c JOIN plans p ON p.code=c.plan_code WHERE c.id=$1",
        [req.user.tenantId],
      );
      const {
        rows: [counts],
      } =
        await db.query(`SELECT (SELECT count(*)::int FROM memberships WHERE active) AS users,(SELECT count(*)::int FROM departments) AS departments,
      (SELECT count(*)::int FROM contacts WHERE NOT archived) AS contacts,(SELECT count(*)::int FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()) AS invitations`);
      return {
        company,
        counts,
        whatsapp: await db
          .query(
            "SELECT status,phone,profile_name,last_error_message FROM whatsapp_connections ORDER BY created_at LIMIT 1",
          )
          .then(
            ({ rows }) =>
              rows[0] ?? {
                status: "not_configured",
                message: "Conecte um número para começar a receber mensagens.",
              },
          ),
      };
    }),
  );
  app.patch(
    "/api/workspace",
    { preHandler: allow("company:manage") },
    async (req) => {
      const body = z
        .object({
          name: text.optional(),
          settings: settingsSchema.partial().optional(),
        })
        .parse(req.body);
      return transaction(req.user.tenantId, async (db) => {
        await db.query(
          "UPDATE companies SET name=coalesce($1,name),settings=settings || coalesce($2::jsonb,'{}'::jsonb) WHERE id=$3",
          [
            body.name,
            body.settings ? JSON.stringify(body.settings) : null,
            req.user.tenantId,
          ],
        );
        await event(
          db,
          req,
          "Configurações da empresa alteradas",
          req.user.tenantId,
        );
        return { ok: true };
      });
    },
  );
  app.get("/api/team", { preHandler: allow("team:manage") }, async (req) =>
    transaction(req.user.tenantId, async (db) => {
      const { rows: members } =
        await db.query(`SELECT m.id,m.role,m.active,m.user_id,u.name,u.email,m.created_at,coalesce((SELECT json_agg(dm.department_id) FROM department_members dm WHERE dm.membership_id=m.id),'[]') AS department_ids
      FROM memberships m JOIN identities u ON u.id=m.user_id ORDER BY m.created_at`);
      const { rows: invitations } = await db.query(
        "SELECT id,email,role,expires_at,created_at FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC",
      );
      return { members, invitations };
    }),
  );
  app.post(
    "/api/team/invitations",
    { preHandler: allow("team:manage") },
    async (req, reply) => {
      const body = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((x) => x.toLowerCase()),
          role: z.enum(["admin", "supervisor", "agent"]),
        })
        .parse(req.body);
      const raw = token(),
        inviteId = randomUUID();
      await transaction(req.user.tenantId, async (db) => {
        await ensureLimit(db, req.user.tenantId, "users");
        const { rowCount } = await db.query(
          "SELECT m.id FROM memberships m JOIN identities u ON u.id=m.user_id WHERE u.email=$1",
          [body.email],
        );
        if (rowCount)
          throw new AppError(409, "Esta pessoa já faz parte da empresa.");
        await db.query(
          "UPDATE invitations SET revoked_at=now() WHERE email=$1 AND expires_at<=now() AND accepted_at IS NULL AND revoked_at IS NULL",
          [body.email],
        );
        await db.query(
          "INSERT INTO invitations(id,tenant_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days')",
          [inviteId, req.user.tenantId, body.email, body.role, digest(raw)],
        );
        await event(db, req, "Convite criado", inviteId, { role: body.role });
      });
      return reply
        .code(201)
        .send({ url: `${process.env.APP_URL}/convite?token=${raw}` });
    },
  );
  app.delete(
    "/api/team/invitations/:id",
    { preHandler: allow("team:manage") },
    async (req) =>
      transaction(req.user.tenantId, async (db) => {
        const inviteId = id(req);
        const { rowCount } = await db.query(
          "UPDATE invitations SET revoked_at=now() WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL",
          [inviteId],
        );
        if (!rowCount)
          throw new AppError(404, "O convite não está mais disponível.");
        await event(db, req, "Convite cancelado", inviteId);
        return { ok: true };
      }),
  );
  app.patch(
    "/api/team/:id",
    { preHandler: allow("team:manage") },
    async (req) => {
      const memberId = id(req);
      const body = z
        .object({
          role: z.enum(["admin", "supervisor", "agent"]),
          active: z.boolean(),
          departmentIds: z.array(z.uuid()).max(100),
        })
        .parse(req.body);
      return transaction(req.user.tenantId, async (db) => {
        await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
          req.user.tenantId,
        ]);
        const {
          rows: [member],
        } = await db.query("SELECT * FROM memberships WHERE id=$1 FOR UPDATE", [
          memberId,
        ]);
        if (!member) throw new AppError(404, "Pessoa não encontrada.");
        if (
          member.role === "admin" &&
          member.active &&
          (!body.active || body.role !== "admin")
        ) {
          const {
            rows: [r],
          } = await db.query(
            "SELECT count(*)::int AS count FROM memberships WHERE role='admin' AND active",
          );
          if (r.count <= 1)
            throw new AppError(
              409,
              "Mantenha pelo menos um administrador ativo na empresa.",
            );
        }
        if (!member.active && body.active)
          await ensureLimit(db, req.user.tenantId, "users");
        await db.query("UPDATE memberships SET role=$1,active=$2 WHERE id=$3", [
          body.role,
          body.active,
          memberId,
        ]);
        await db.query(
          "DELETE FROM department_members WHERE membership_id=$1",
          [memberId],
        );
        for (const departmentId of new Set(body.departmentIds))
          await db.query(
            "INSERT INTO department_members(tenant_id,department_id,membership_id) VALUES($1,$2,$3)",
            [req.user.tenantId, departmentId, memberId],
          );
        if (!body.active)
          await db.query(
            "DELETE FROM sessions WHERE user_id=$1 AND tenant_id=$2",
            [member.user_id, req.user.tenantId],
          );
        await event(db, req, "Acesso da equipe alterado", memberId, {
          role: body.role,
          active: body.active,
        });
        return { ok: true };
      });
    },
  );
  app.get("/api/departments", { preHandler: authenticate }, async (req) =>
    transaction(req.user.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT d.*,(SELECT count(*)::int FROM department_members dm WHERE dm.department_id=d.id) AS members FROM departments d
      WHERE $1='admin' OR EXISTS(SELECT 1 FROM department_members dm WHERE dm.department_id=d.id AND dm.membership_id=$2) ORDER BY name`,
        [req.user.role, req.user.membershipId],
      );
      return rows;
    }),
  );
  app.post(
    "/api/departments",
    { preHandler: allow("departments:manage") },
    async (req, reply) => {
      const body = z
        .object({ name: text, description: z.string().max(500).default("") })
        .parse(req.body);
      const departmentId = randomUUID();
      await transaction(req.user.tenantId, async (db) => {
        await ensureLimit(db, req.user.tenantId, "departments");
        await db.query(
          "INSERT INTO departments(id,tenant_id,name,description) VALUES($1,$2,$3,$4)",
          [departmentId, req.user.tenantId, body.name, body.description],
        );
        await event(db, req, "Departamento criado", departmentId);
      });
      return reply.code(201).send({ id: departmentId });
    },
  );
  app.patch(
    "/api/departments/:id",
    { preHandler: allow("departments:manage") },
    async (req) => {
      const departmentId = id(req);
      const body = z
        .object({ name: text, description: z.string().max(500) })
        .parse(req.body);
      return transaction(req.user.tenantId, async (db) => {
        const { rowCount } = await db.query(
          "UPDATE departments SET name=$1,description=$2 WHERE id=$3",
          [body.name, body.description, departmentId],
        );
        if (!rowCount) throw new AppError(404, "Departamento não encontrado.");
        await event(db, req, "Departamento alterado", departmentId);
        return { ok: true };
      });
    },
  );
  app.get(
    "/api/contacts",
    { preHandler: allow("contacts:read") },
    async (req) => {
      const { q, page: current } = page
        .extend({ tag: z.union([z.uuid(), z.literal("")]).default("") })
        .parse(req.query);
      const { tag } = page
        .extend({ tag: z.union([z.uuid(), z.literal("")]).default("") })
        .parse(req.query);
      return transaction(req.user.tenantId, async (db) => {
        const filter =
          "NOT c.archived AND (c.name ILIKE $1 OR c.phone LIKE $1 OR c.email ILIKE $1) AND ($2='' OR EXISTS(SELECT 1 FROM contact_tags ct WHERE ct.contact_id=c.id AND ct.tag_id::text=$2))";
        const search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
        const {
          rows: [count],
        } = await db.query(
          `SELECT count(*)::int AS total FROM contacts c WHERE ${filter}`,
          [search, tag],
        );
        const { rows: items } = await db.query(
          `SELECT c.*,coalesce((SELECT json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color)) FROM contact_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.contact_id=c.id),'[]') AS tags FROM contacts c WHERE ${filter} ORDER BY c.updated_at DESC,c.id LIMIT 30 OFFSET $3`,
          [search, tag, (current - 1) * 30],
        );
        return { items, total: count.total, page: current };
      });
    },
  );
  app.get(
    "/api/contacts/:id",
    { preHandler: allow("contacts:read") },
    async (req) =>
      transaction(req.user.tenantId, async (db) => {
        const {
          rows: [contact],
        } = await db.query(
          `SELECT c.*,coalesce((SELECT json_agg(tag_id) FROM contact_tags WHERE contact_id=c.id),'[]') AS tag_ids,
           (SELECT id FROM conversations WHERE contact_id=c.id ORDER BY last_message_at DESC NULLS LAST,updated_at DESC LIMIT 1) AS conversation_id
           FROM contacts c WHERE id=$1 AND NOT archived`,
          [id(req)],
        );
        if (!contact) throw new AppError(404, "Contato não encontrado.");
        return contact;
      }),
  );
  for (const method of ["POST", "PATCH"] as const)
    app.route({
      method,
      url: method === "POST" ? "/api/contacts" : "/api/contacts/:id",
      preHandler: allow("contacts:write"),
      handler: async (req, reply) => {
        const body = contactSchema.parse(req.body),
          contactId = method === "POST" ? randomUUID() : id(req);
        await transaction(req.user.tenantId, async (db) => {
          if (method === "POST")
            await db.query(
              "INSERT INTO contacts(id,tenant_id,name,phone,email,notes) VALUES($1,$2,$3,$4,$5,$6)",
              [
                contactId,
                req.user.tenantId,
                body.name,
                body.phone,
                body.email,
                body.notes,
              ],
            );
          else {
            const { rowCount } = await db.query(
              "UPDATE contacts SET name=$1,phone=$2,email=$3,notes=$4,updated_at=now() WHERE id=$5 AND NOT archived",
              [body.name, body.phone, body.email, body.notes, contactId],
            );
            if (!rowCount) throw new AppError(404, "Contato não encontrado.");
          }
          await db.query("DELETE FROM contact_tags WHERE contact_id=$1", [
            contactId,
          ]);
          for (const tagId of new Set(body.tagIds))
            await db.query(
              "INSERT INTO contact_tags(tenant_id,contact_id,tag_id) VALUES($1,$2,$3)",
              [req.user.tenantId, contactId, tagId],
            );
          await event(
            db,
            req,
            method === "POST" ? "Contato criado" : "Contato alterado",
            contactId,
          );
        });
        return reply
          .code(method === "POST" ? 201 : 200)
          .send({ id: contactId });
      },
    });
  app.get("/api/tags", { preHandler: allow("contacts:read") }, async (req) =>
    transaction(
      req.user.tenantId,
      async (db) => (await db.query("SELECT * FROM tags ORDER BY name")).rows,
    ),
  );
  app.post(
    "/api/tags",
    { preHandler: allow("company:manage") },
    async (req, reply) => {
      const body = z
        .object({
          name: text,
          color: z.enum(["coral", "amber", "blue", "violet", "teal", "slate"]),
        })
        .parse(req.body);
      const tagId = randomUUID();
      await transaction(req.user.tenantId, async (db) => {
        await db.query(
          "INSERT INTO tags(id,tenant_id,name,color) VALUES($1,$2,$3,$4)",
          [tagId, req.user.tenantId, body.name, body.color],
        );
        await event(db, req, "Etiqueta criada", tagId);
      });
      return reply.code(201).send({ id: tagId });
    },
  );
  app.delete(
    "/api/tags/:id",
    { preHandler: allow("company:manage") },
    async (req) =>
      transaction(req.user.tenantId, async (db) => {
        const tagId = id(req);
        const { rowCount } = await db.query("DELETE FROM tags WHERE id=$1", [
          tagId,
        ]);
        if (!rowCount) throw new AppError(404, "Etiqueta não encontrada.");
        await event(db, req, "Etiqueta removida", tagId);
        return { ok: true };
      }),
  );
  app.get("/api/quick-replies", { preHandler: authenticate }, async (req) =>
    transaction(
      req.user.tenantId,
      async (db) =>
        (
          await db.query(
            `SELECT q.*,d.name AS department_name FROM quick_replies q LEFT JOIN departments d ON d.id=q.department_id
    WHERE q.department_id IS NULL OR $1='admin' OR EXISTS(SELECT 1 FROM department_members dm WHERE dm.department_id=q.department_id AND dm.membership_id=$2) ORDER BY q.title`,
            [req.user.role, req.user.membershipId],
          )
        ).rows,
    ),
  );
  const replySchema = z.object({
    shortcut: z
      .string()
      .regex(
        /^[a-z0-9-]{2,30}$/,
        "Use de 2 a 30 letras minúsculas, números ou hífens.",
      ),
    title: text,
    body: z.string().trim().min(1).max(4000),
    departmentId: z.uuid().nullable().default(null),
  });
  for (const method of ["POST", "PATCH"] as const)
    app.route({
      method,
      url: method === "POST" ? "/api/quick-replies" : "/api/quick-replies/:id",
      preHandler: allow("replies:manage"),
      handler: async (req, reply) => {
        const body = replySchema.parse(req.body),
          replyId = method === "POST" ? randomUUID() : id(req);
        await transaction(req.user.tenantId, async (db) => {
          if (method === "POST")
            await db.query(
              "INSERT INTO quick_replies(id,tenant_id,shortcut,title,body,department_id) VALUES($1,$2,$3,$4,$5,$6)",
              [
                replyId,
                req.user.tenantId,
                body.shortcut,
                body.title,
                body.body,
                body.departmentId,
              ],
            );
          else {
            const { rowCount } = await db.query(
              "UPDATE quick_replies SET shortcut=$1,title=$2,body=$3,department_id=$4 WHERE id=$5",
              [
                body.shortcut,
                body.title,
                body.body,
                body.departmentId,
                replyId,
              ],
            );
            if (!rowCount) throw new AppError(404, "Resposta não encontrada.");
          }
          await event(
            db,
            req,
            method === "POST"
              ? "Resposta rápida criada"
              : "Resposta rápida alterada",
            replyId,
          );
        });
        return reply.code(method === "POST" ? 201 : 200).send({ id: replyId });
      },
    });
  app.delete(
    "/api/quick-replies/:id",
    { preHandler: allow("replies:manage") },
    async (req) =>
      transaction(req.user.tenantId, async (db) => {
        const replyId = id(req);
        const { rowCount } = await db.query(
          "DELETE FROM quick_replies WHERE id=$1",
          [replyId],
        );
        if (!rowCount) throw new AppError(404, "Resposta não encontrada.");
        await event(db, req, "Resposta rápida removida", replyId);
        return { ok: true };
      }),
  );
  app.get(
    "/api/followups",
    { preHandler: allow("followups:read") },
    async (req) =>
      transaction(req.user.tenantId, async (db) => {
        const { rows } = await db.query(
          `SELECT f.*,c.name AS contact_name,c.phone FROM followups f JOIN contacts c ON c.id=f.contact_id
      WHERE f.membership_id=$1 AND (f.completed_at IS NULL OR f.completed_at>now()-interval '30 days') ORDER BY f.due_at LIMIT 300`,
          [req.user.membershipId],
        );
        return rows;
      }),
  );
  app.post(
    "/api/followups",
    { preHandler: allow("followups:write") },
    async (req, reply) => {
      const body = z
        .object({
          contactId: z.uuid(),
          note: z.string().trim().min(1).max(1000),
          dueAt: z.iso
            .datetime({ offset: true })
            .refine(
              (x) => new Date(x).getTime() > Date.now(),
              "Escolha um horário futuro.",
            ),
        })
        .parse(req.body);
      const followupId = randomUUID();
      await transaction(req.user.tenantId, async (db) => {
        await db.query(
          "INSERT INTO followups(id,tenant_id,contact_id,membership_id,note,due_at) VALUES($1,$2,$3,$4,$5,$6)",
          [
            followupId,
            req.user.tenantId,
            body.contactId,
            req.user.membershipId,
            body.note,
            body.dueAt,
          ],
        );
        await event(db, req, "Retorno criado", followupId);
      });
      return reply.code(201).send({ id: followupId });
    },
  );
  app.patch(
    "/api/followups/:id",
    { preHandler: allow("followups:write") },
    async (req) => {
      const followupId = id(req),
        { completed } = z.object({ completed: z.boolean() }).parse(req.body);
      return transaction(req.user.tenantId, async (db) => {
        const { rowCount } = await db.query(
          "UPDATE followups SET completed_at=CASE WHEN $1 THEN now() ELSE NULL END WHERE id=$2 AND membership_id=$3",
          [completed, followupId, req.user.membershipId],
        );
        if (!rowCount) throw new AppError(404, "Retorno não encontrado.");
        await event(
          db,
          req,
          completed ? "Retorno concluído" : "Retorno reaberto",
          followupId,
        );
        return { ok: true };
      });
    },
  );
  app.get("/api/audit", { preHandler: allow("audit:read") }, async (req) =>
    transaction(req.user.tenantId, async (db) => {
      const { before } = z
        .object({ before: z.string().regex(/^\d+$/).optional() })
        .parse(req.query);
      const { rows } = await db.query(
        "SELECT a.id,a.action,a.entity_id,a.metadata,a.created_at,u.name AS actor_name FROM audit_events a LEFT JOIN identities u ON u.id=a.actor_id WHERE ($1::bigint IS NULL OR a.id<$1) ORDER BY a.id DESC LIMIT 50",
        [before ?? null],
      );
      return rows;
    }),
  );
}
