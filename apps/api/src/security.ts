import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { DB } from "./db.js";
const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString("base64url");
export const digest = (input: string) =>
  createHash("sha256").update(input).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}
export async function checkPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_ERROR",
  ) {
    super(message);
  }
}
export const roles: Record<string, string[]> = {
  admin: [
    "company:manage",
    "team:manage",
    "departments:manage",
    "contacts:read",
    "contacts:write",
    "replies:manage",
    "followups:read",
    "followups:write",
    "audit:read",
    "whatsapp:manage",
  ],
  supervisor: [
    "contacts:read",
    "contacts:write",
    "followups:read",
    "followups:write",
  ],
  agent: [
    "contacts:read",
    "contacts:write",
    "followups:read",
    "followups:write",
  ],
};
export function permissions(role: string, extra: string[]) {
  return [...new Set([...(roles[role] ?? []), ...extra])];
}
export async function limit(db: DB, key: string, max = 10, seconds = 900) {
  const {
    rows: [r],
  } = await db.query(
    `INSERT INTO rate_limits(key,count,expires_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END,
    expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING count`,
    [key, seconds],
  );
  return r.count <= max;
}
export async function audit(
  db: DB,
  tenant: string,
  actor: string | null,
  action: string,
  entity: string | null,
  requestId: string,
  metadata = {},
) {
  await db.query(
    "INSERT INTO audit_events(tenant_id,actor_id,action,entity_id,request_id,metadata) VALUES($1,$2,$3,$4,$5,$6)",
    [tenant, actor, action, entity, requestId, JSON.stringify(metadata)],
  );
}
