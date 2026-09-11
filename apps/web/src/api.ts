export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: {
        "X-Caju-Request": "1",
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      "Não foi possível conectar ao Caju. Confira sua conexão e tente novamente.",
      0,
    );
  }
  const body = await response.json().catch(() => ({
    message: "O serviço está temporariamente indisponível. Tente novamente.",
  }));
  if (!response.ok)
    throw new ApiError(
      body.fields?.length
        ? `${body.message} ${body.fields.map((x: { message: string }) => x.message).join(" ")}`
        : body.message,
      response.status,
      body.code,
    );
  return body;
}
export type User = {
  userId: string;
  tenantId: string;
  membershipId: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  theme: string;
};
export type Session = {
  user: User;
  companies: { tenant_id: string; company_name: string }[];
};
export type Hours = { enabled: boolean; start: string; end: string };
export type Settings = {
  timezone: string;
  hours: Hours[];
  outsideMessage: string;
  teamConfirmed?: boolean;
};
export type Workspace = {
  company: {
    id: string;
    name: string;
    plan_name: string;
    settings: Partial<Settings>;
    limits: { users: number; departments: number; numbers: number };
    created_at: string;
  };
  counts: {
    users: number;
    departments: number;
    contacts: number;
    invitations: number;
  };
  whatsapp: {
    status: string;
    message?: string;
    phone?: string;
    profile_name?: string;
    last_error_message?: string;
  };
};
export type WhatsAppConnection = {
  id: string;
  label: string;
  status: string;
  phone: string | null;
  profile_name: string | null;
  connected_at: string | null;
  last_seen_at: string | null;
  last_error_message: string | null;
  reconnect_attempts: number;
  created_at: string;
  updated_at: string;
  qr: string | null;
  qrExpiresAt: string | null;
};
export type Department = {
  id: string;
  name: string;
  description: string;
  members: number;
};
export type Tag = { id: string; name: string; color: string };
export type Contact = {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  tags: Tag[];
  tag_ids?: string[];
  created_at: string;
  updated_at: string;
};
export type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  department_ids: string[];
};
export type Invitation = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
};
export type QuickReply = {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  department_id: string | null;
  department_name: string | null;
};
export type Followup = {
  id: string;
  contact_id: string;
  contact_name: string;
  phone: string;
  note: string;
  due_at: string;
  completed_at: string | null;
};
export const roleNames: Record<string, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  agent: "Atendente",
};
export const defaultSettings: Settings = {
  timezone: "America/Sao_Paulo",
  hours: Array.from({ length: 7 }, (_, i) => ({
    enabled: i > 0 && i < 6,
    start: "08:00",
    end: "18:00",
  })),
  outsideMessage:
    "Olá! Recebemos sua mensagem fora do nosso horário de atendimento. Nossa equipe retorna assim que o expediente começar.",
};
