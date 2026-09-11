import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import nodemailer from "nodemailer";
import { pool, transaction, type DB } from "./db.js";
import {
  AppError,
  audit,
  checkPassword,
  digest,
  hashPassword,
  limit,
  permissions,
  token,
} from "./security.js";

const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase().trim());
const password = z.string().min(12, "Use pelo menos 12 caracteres.").max(128);
const name = z.string().trim().min(2).max(100);
export type Context = {
  userId: string;
  tenantId: string;
  membershipId: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  theme: string;
  sessionHash: string;
};
declare module "fastify" {
  interface FastifyRequest {
    user: Context;
  }
}
const cookie = "caju_session";
async function issue(
  db: DB,
  reply: FastifyReply,
  userId: string,
  tenantId: string,
) {
  const raw = token();
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
    [digest(raw), userId, tenantId],
  );
  reply.setCookie(cookie, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
}
export async function authenticate(req: FastifyRequest) {
  const raw = req.cookies[cookie];
  if (!raw)
    throw new AppError(
      401,
      "Entre na sua conta para continuar.",
      "UNAUTHENTICATED",
    );
  const sessionHash = digest(raw);
  const {
    rows: [session],
  } = await pool.query(
    "SELECT s.*,u.name,u.email,u.theme FROM sessions s JOIN identities u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND last_seen_at>now()-interval '24 hours'",
    [sessionHash],
  );
  if (!session)
    throw new AppError(
      401,
      "Sua sessão expirou. Entre novamente.",
      "UNAUTHENTICATED",
    );
  const membership = await transaction(session.tenant_id, async (db) => {
    const {
      rows: [m],
    } = await db.query(
      "SELECT m.*,c.status FROM memberships m JOIN companies c ON c.id=m.tenant_id WHERE m.user_id=$1 AND m.tenant_id=$2",
      [session.user_id, session.tenant_id],
    );
    return m;
  });
  if (!membership?.active || membership.status !== "active")
    throw new AppError(
      403,
      "Seu acesso está desativado. Fale com o administrador da empresa.",
      "ACCOUNT_DISABLED",
    );
  req.user = {
    userId: session.user_id,
    tenantId: session.tenant_id,
    membershipId: membership.id,
    name: session.name,
    email: session.email,
    role: membership.role,
    permissions: permissions(membership.role, membership.permissions),
    theme: session.theme,
    sessionHash,
  };
  await pool.query(
    "UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1 AND last_seen_at<now()-interval '1 minute'",
    [sessionHash],
  );
}
export function allow(permission: string) {
  return async (req: FastifyRequest) => {
    await authenticate(req);
    if (!req.user.permissions.includes(permission))
      throw new AppError(
        403,
        "Você não tem permissão para realizar esta ação.",
        "FORBIDDEN",
      );
  };
}
async function throttle(
  req: FastifyRequest,
  kind: string,
  max: number,
  subject = "",
) {
  const allowed = await transaction(null, (db) =>
    limit(db, digest(`${kind}:${req.ip}:${subject}`), max),
  );
  if (!allowed)
    throw new AppError(
      429,
      "Muitas tentativas. Aguarde 15 minutos e tente novamente.",
      "RATE_LIMIT",
    );
}
export function mailReady() {
  return !!(process.env.SMTP_URL && process.env.MAIL_FROM);
}
export async function authRoutes(app: FastifyInstance) {
  app.get("/api/auth/capabilities", async () => ({
    passwordRecovery: mailReady(),
  }));
  app.post("/api/auth/register", async (req, reply) => {
    await throttle(req, "register", 5);
    const body = z
      .object({ name, email, password, company: name })
      .parse(req.body);
    const passwordHash = await hashPassword(body.password);
    const userId = randomUUID(),
      tenantId = randomUUID();
    await transaction(tenantId, async (db) => {
      const { rows } = await db.query(
        "SELECT id FROM identities WHERE email=$1",
        [body.email],
      );
      if (rows.length)
        throw new AppError(
          409,
          "Não foi possível criar a conta com este e-mail. Tente entrar ou recuperar seu acesso.",
        );
      await db.query(
        "INSERT INTO companies(id,name,plan_code) VALUES($1,$2,'setup')",
        [tenantId, body.company],
      );
      await db.query(
        "INSERT INTO identities(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
        [userId, body.name, body.email, passwordHash],
      );
      await db.query(
        "INSERT INTO memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'admin')",
        [randomUUID(), tenantId, userId],
      );
      await audit(db, tenantId, userId, "Empresa criada", tenantId, req.id);
      await issue(db, reply, userId, tenantId);
    });
    return reply.code(201).send({ ok: true });
  });
  app.post("/api/auth/login", async (req, reply) => {
    const body = z
      .object({ email, password: z.string().max(128) })
      .parse(req.body);
    await throttle(req, "login", 15, body.email);
    const {
      rows: [user],
    } = await pool.query("SELECT * FROM identities WHERE email=$1", [
      body.email,
    ]);
    const fallback =
      "scrypt:00000000000000000000000000000000:" + "0".repeat(128);
    const valid = await checkPassword(
      body.password,
      user?.password_hash ?? fallback,
    );
    if (!user || !valid)
      throw new AppError(
        401,
        "E-mail ou senha incorretos. Confira os dados e tente novamente.",
      );
    const { rows: members } = await pool.query(
      "SELECT * FROM auth_memberships($1)",
      [user.id],
    );
    const company = members.find((m) => m.active);
    if (!company)
      throw new AppError(
        403,
        "Seu acesso está desativado. Fale com o administrador da empresa.",
        "ACCOUNT_DISABLED",
      );
    await transaction(company.tenant_id, async (db) => {
      await issue(db, reply, user.id, company.tenant_id);
      await audit(
        db,
        company.tenant_id,
        user.id,
        "Entrada na conta",
        user.id,
        req.id,
      );
    });
    return { ok: true };
  });
  app.get("/api/auth/me", { preHandler: authenticate }, async (req) => {
    const { sessionHash, ...user } = req.user;
    const { rows: companies } = await pool.query(
      "SELECT tenant_id,company_name FROM auth_memberships($1) WHERE active",
      [user.userId],
    );
    return { user, companies };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    if (req.cookies[cookie])
      await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(req.cookies[cookie]!),
      ]);
    reply.clearCookie(cookie, { path: "/" });
    return { ok: true };
  });
  app.post(
    "/api/auth/switch",
    { preHandler: authenticate },
    async (req, reply) => {
      const { tenantId } = z.object({ tenantId: z.uuid() }).parse(req.body);
      const { rows } = await pool.query(
        "SELECT * FROM auth_memberships($1) WHERE tenant_id=$2 AND active",
        [req.user.userId, tenantId],
      );
      if (!rows.length)
        throw new AppError(403, "Você não tem acesso a esta empresa.");
      await transaction(tenantId, async (db) => {
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          req.user.sessionHash,
        ]);
        await issue(db, reply, req.user.userId, tenantId);
      });
      return { ok: true };
    },
  );
  app.patch("/api/auth/profile", { preHandler: authenticate }, async (req) => {
    const body = z
      .object({
        name: name.optional(),
        theme: z.enum(["claro", "escuro", "areia", "cafe"]).optional(),
      })
      .parse(req.body);
    await pool.query(
      "UPDATE identities SET name=coalesce($1,name),theme=coalesce($2,theme) WHERE id=$3",
      [body.name, body.theme, req.user.userId],
    );
    return { ok: true };
  });
  app.get("/api/auth/sessions", { preHandler: authenticate }, async (req) => {
    const { rows } = await pool.query(
      "SELECT created_at,last_seen_at,expires_at,token_hash=$2 AS current FROM sessions WHERE user_id=$1 AND expires_at>now() ORDER BY last_seen_at DESC",
      [req.user.userId, req.user.sessionHash],
    );
    return rows;
  });
  app.post(
    "/api/auth/revoke-sessions",
    { preHandler: authenticate },
    async (req) => {
      await pool.query(
        "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2",
        [req.user.userId, req.user.sessionHash],
      );
      return { ok: true };
    },
  );
  app.post(
    "/api/auth/password",
    { preHandler: authenticate },
    async (req, reply) => {
      const body = z
        .object({ currentPassword: z.string().max(128), password })
        .parse(req.body);
      await throttle(req, "password", 10);
      const {
        rows: [user],
      } = await pool.query("SELECT password_hash FROM identities WHERE id=$1", [
        req.user.userId,
      ]);
      if (!(await checkPassword(body.currentPassword, user.password_hash)))
        throw new AppError(400, "A senha atual está incorreta.");
      const hash = await hashPassword(body.password);
      await transaction(req.user.tenantId, async (db) => {
        await db.query("UPDATE identities SET password_hash=$1 WHERE id=$2", [
          hash,
          req.user.userId,
        ]);
        await db.query("DELETE FROM sessions WHERE user_id=$1", [
          req.user.userId,
        ]);
        await issue(db, reply, req.user.userId, req.user.tenantId);
        await audit(
          db,
          req.user.tenantId,
          req.user.userId,
          "Senha alterada",
          req.user.userId,
          req.id,
        );
      });
      return { ok: true };
    },
  );
  app.post("/api/auth/forgot", async (req) => {
    const body = z.object({ email }).parse(req.body);
    await throttle(req, "recovery", 5, body.email);
    if (!mailReady())
      throw new AppError(
        503,
        "A recuperação por e-mail ainda não está disponível. Entre em contato com o responsável pelo Caju.",
        "MAIL_UNAVAILABLE",
      );
    const {
      rows: [user],
    } = await pool.query("SELECT id FROM identities WHERE email=$1", [
      body.email,
    ]);
    if (user) {
      const raw = token();
      await pool.query(
        "INSERT INTO auth_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
        [digest(raw), user.id],
      );
      try {
        await nodemailer.createTransport(process.env.SMTP_URL!).sendMail({
          from: process.env.MAIL_FROM,
          to: body.email,
          subject: "Redefina sua senha do Caju",
          text: `Recebemos um pedido para redefinir sua senha. Acesse ${process.env.APP_URL}/redefinir?token=${raw}\nO link vale por 30 minutos e só pode ser usado uma vez. Se não foi você, ignore este e-mail.`,
        });
      } catch {
        await pool.query("DELETE FROM auth_tokens WHERE token_hash=$1", [
          digest(raw),
        ]);
        req.log.error(
          { operation: "password_recovery", requestId: req.id },
          "Falha na entrega de e-mail",
        );
        throw new AppError(
          503,
          "Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.",
        );
      }
    }
    return {
      ok: true,
      message:
        "Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha.",
    };
  });
  app.post("/api/auth/reset", async (req, reply) => {
    const body = z
      .object({ token: z.string().min(30).max(100), password })
      .parse(req.body);
    await throttle(req, "reset", 10);
    const hash = await hashPassword(body.password);
    await transaction(null, async (db) => {
      const {
        rows: [entry],
      } = await db.query(
        "DELETE FROM auth_tokens WHERE token_hash=$1 AND expires_at>now() RETURNING user_id",
        [digest(body.token)],
      );
      if (!entry)
        throw new AppError(
          400,
          "Este link expirou ou já foi usado. Solicite outro link.",
        );
      await db.query("UPDATE identities SET password_hash=$1 WHERE id=$2", [
        hash,
        entry.user_id,
      ]);
      await db.query("DELETE FROM sessions WHERE user_id=$1", [entry.user_id]);
      await db.query("DELETE FROM auth_tokens WHERE user_id=$1", [
        entry.user_id,
      ]);
    });
    reply.clearCookie(cookie, { path: "/" });
    return { ok: true };
  });
  app.get("/api/auth/invitation", async (req) => {
    const { token: raw } = z
      .object({ token: z.string().min(30).max(100) })
      .parse(req.query);
    const {
      rows: [invite],
    } = await pool.query("SELECT * FROM auth_invitation($1)", [digest(raw)]);
    if (!invite)
      throw new AppError(
        404,
        "Este convite expirou, foi cancelado ou já foi aceito. Peça um novo convite.",
      );
    return {
      company: invite.company_name,
      email: invite.email,
      role: invite.role,
    };
  });
  app.post("/api/auth/accept-invitation", async (req, reply) => {
    const body = z
      .object({ token: z.string().min(30).max(100), name, password })
      .parse(req.body);
    await throttle(req, "invite", 10);
    const {
      rows: [invite],
    } = await pool.query("SELECT * FROM auth_invitation($1)", [
      digest(body.token),
    ]);
    if (!invite)
      throw new AppError(
        400,
        "Este convite não está mais disponível. Peça um novo convite.",
      );
    const {
      rows: [existing],
    } = await pool.query("SELECT * FROM identities WHERE email=$1", [
      invite.email,
    ]);
    if (
      existing &&
      !(await checkPassword(body.password, existing.password_hash))
    )
      throw new AppError(
        400,
        "Você já tem uma conta. Use sua senha atual para aceitar este convite.",
      );
    const hash = existing?.password_hash ?? (await hashPassword(body.password)),
      userId = existing?.id ?? randomUUID();
    await transaction(invite.tenant_id, async (db) => {
      await db.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE", [
        invite.tenant_id,
      ]);
      const { rowCount } = await db.query(
        "UPDATE invitations SET accepted_at=now() WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()",
        [invite.id],
      );
      if (!rowCount)
        throw new AppError(409, "Este convite já foi utilizado ou cancelado.");
      if (!existing)
        await db.query(
          "INSERT INTO identities(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
          [userId, body.name, invite.email, hash],
        );
      await db.query(
        "INSERT INTO memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,$4)",
        [randomUUID(), invite.tenant_id, userId, invite.role],
      );
      await audit(
        db,
        invite.tenant_id,
        userId,
        "Convite aceito",
        userId,
        req.id,
      );
      await issue(db, reply, userId, invite.tenant_id);
    });
    return { ok: true };
  });
}
