import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  History,
  KeyRound,
  Monitor,
  Palette,
  Plus,
  QrCode,
  RefreshCw,
  Settings,
  ShieldCheck,
  Signal,
  Smartphone,
  Tag as TagIcon,
  Trash2,
  UserRound,
  Users,
  Waypoints,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  api,
  defaultSettings,
  roleNames,
  type Department,
  type Invitation,
  type Member,
  type Settings as CompanyConfig,
  type Tag,
  type Session,
  type WhatsAppConnection,
} from "./api";
import { can, useSession, useWorkspace } from "./App";
import {
  Avatar,
  Badge,
  Confirm,
  date,
  Empty,
  ErrorMessage,
  Field,
  field,
  Form,
  Loading,
  PageTitle,
  Retry,
} from "./ui";
function Forbidden() {
  return (
    <Empty
      icon={<ShieldCheck size={32} />}
      title="Este ajuste é feito pelo administrador"
    >
      Seu perfil não tem permissão para alterar esta configuração.
    </Empty>
  );
}
export function SettingsLayout() {
  const { user } = useSession(),
    location = useLocation(),
    nav = useRef<HTMLElement>(null);
  const tabs = [
    ["empresa", "Empresa", Building2, "company:manage"],
    ["equipe", "Equipe", Users, "team:manage"],
    ["departamentos", "Departamentos", Waypoints, "departments:manage"],
    ["horarios", "Horários", Clock3, "company:manage"],
    ["whatsapp", "WhatsApp", Smartphone, "whatsapp:manage"],
    ["etiquetas", "Etiquetas", TagIcon, "company:manage"],
    ["aparencia", "Aparência", Palette, ""],
    ["conta", "Minha conta", UserRound, ""],
    ["historico", "Histórico de ações", History, "audit:read"],
  ] as const;
  useEffect(() => {
    nav.current?.querySelector("a.active")?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "start",
    });
  }, [location.pathname]);
  return (
    <div className="page settings-page">
      <PageTitle
        title="Configurações"
        description="Um espaço que funciona do seu jeito."
      />
      <div className="settings-layout">
        <nav
          ref={nav}
          className="settings-nav"
          aria-label="Seções de configurações"
        >
          {tabs
            .filter((t) => !t[3] || can(user, t[3]))
            .map(([path, label, Icon]) => (
              <NavLink key={path} to={`/configuracoes/${path}`}>
                <Icon size={18} />
                {label}
              </NavLink>
            ))}
        </nav>
        <div className="settings-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
export function CompanySettings() {
  const { user } = useSession(),
    workspace = useWorkspace(),
    client = useQueryClient();
  if (!can(user, "company:manage")) return <Forbidden />;
  if (workspace.isPending) return <Loading />;
  if (workspace.error)
    return <Retry error={workspace.error} retry={() => workspace.refetch()} />;
  const { company, counts } = workspace.data!;
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Sua empresa</h2>
          <p>As informações que identificam seu espaço no Caju.</p>
        </div>
      </div>
      <Form
        onSubmit={async (data) => {
          await api("/workspace", {
            method: "PATCH",
            body: { name: field(data, "name") },
          });
          await client.invalidateQueries({ queryKey: ["workspace"] });
        }}
      >
        <Field label="Nome da empresa">
          <input
            name="name"
            required
            maxLength={100}
            defaultValue={company.name}
          />
        </Field>
        <Field
          label="Identificador da empresa"
          hint="Use este código quando precisar falar com o suporte."
        >
          <input readOnly value={company.id} />
        </Field>
      </Form>
      <section className="settings-section">
        <h2>Capacidade do seu espaço</h2>
        <p>
          Plano de configuração. A contratação comercial será definida com o
          responsável pelo Caju.
        </p>
        <dl className="capacity-list">
          <div>
            <dt>Pessoas na equipe</dt>
            <dd>
              {counts.users + counts.invitations} de {company.limits.users}
              <small>Inclui convites pendentes</small>
            </dd>
          </div>
          <div>
            <dt>Departamentos</dt>
            <dd>
              {counts.departments} de {company.limits.departments}
            </dd>
          </div>
          <div>
            <dt>Números de WhatsApp</dt>
            <dd>0 de {company.limits.numbers}</dd>
          </div>
        </dl>
      </section>
      <Link className="text-link" to="/">
        Voltar à preparação da empresa
        <ArrowRight size={16} />
      </Link>
    </>
  );
}
export function Team() {
  const { user } = useSession(),
    client = useQueryClient(),
    workspace = useWorkspace(),
    [creating, setCreating] = useState(false),
    [url, setUrl] = useState(""),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState<unknown>(),
    [editing, setEditing] = useState<Member | null>(null),
    [cancel, setCancel] = useState<Invitation | null>(null);
  const team = useQuery({
    queryKey: ["team"],
    queryFn: () =>
      api<{ members: Member[]; invitations: Invitation[] }>("/team"),
    enabled: can(user, "team:manage"),
  });
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api<Department[]>("/departments"),
  });
  if (!can(user, "team:manage")) return <Forbidden />;
  if (team.isPending) return <Loading />;
  if (team.error)
    return <Retry error={team.error} retry={() => team.refetch()} />;
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["team"] });
    await client.invalidateQueries({ queryKey: ["workspace"] });
    await client.invalidateQueries({ queryKey: ["departments"] });
  };
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Sua equipe</h2>
          <p>Gente certa, com os acessos certos.</p>
        </div>
        <button
          className="button small"
          onClick={() => {
            setCreating(!creating);
            setEditing(null);
            setUrl("");
          }}
        >
          <Plus size={17} />
          {creating ? "Fechar convite" : "Convidar pessoa"}
        </button>
      </div>
      {creating && (
        <section className="inline-editor">
          <h3>Convidar para sua empresa</h3>
          <p>
            O convite é pessoal e vale por 7 dias. Você compartilha o link com a
            pessoa convidada.
          </p>
          <Form
            label="Criar convite"
            onSubmit={async (data) => {
              const result = await api<{ url: string }>("/team/invitations", {
                method: "POST",
                body: {
                  email: field(data, "email"),
                  role: field(data, "role"),
                },
              });
              setUrl(result.url);
              setCopied(false);
              await refresh();
            }}
          >
            <Field label="E-mail da pessoa">
              <input
                name="email"
                type="email"
                required
                placeholder="pessoa@empresa.com.br"
              />
            </Field>
            <Field label="Perfil de acesso">
              <select name="role" defaultValue="agent">
                <option value="agent">Atendente</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Administrador</option>
              </select>
            </Field>
            <p className="field-hint">
              Atendentes organizam contatos e seus retornos. Supervisores terão
              acesso operacional aos seus departamentos. Administradores
              gerenciam toda a empresa.
            </p>
          </Form>
          {url && (
            <div className="invite-result" role="status">
              <h3>Convite criado</h3>
              <p>Envie este link diretamente à pessoa convidada.</p>
              <input
                aria-label="Link do convite"
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="button secondary small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  } catch {
                    setCopyError(
                      new Error("Selecione o link acima e copie pelo teclado."),
                    );
                  }
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                {copied ? "Link copiado" : "Copiar convite"}
              </button>
              <ErrorMessage error={copyError} />
            </div>
          )}
        </section>
      )}
      {editing && (
        <section className="inline-editor">
          <div className="section-heading">
            <h3>Editar acesso de {editing.name}</h3>
            <button
              className="icon-button"
              aria-label="Fechar edição de acesso"
              onClick={() => setEditing(null)}
            >
              <X size={18} />
            </button>
          </div>
          <Form
            key={editing.id}
            label="Salvar acesso"
            onSubmit={async (data) => {
              await api(`/team/${editing.id}`, {
                method: "PATCH",
                body: {
                  role: field(data, "role"),
                  active: data.get("active") === "on",
                  departmentIds: data.getAll("departmentIds"),
                },
              });
              await refresh();
              await client.invalidateQueries({ queryKey: ["session"] });
              setEditing(null);
            }}
          >
            <Field label="Perfil">
              <select name="role" defaultValue={editing.role}>
                {Object.entries(roleNames).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <label className="check-row">
              <input
                type="checkbox"
                name="active"
                defaultChecked={editing.active}
              />
              Acesso ativo
            </label>
            <div className="field">
              <span>Departamentos</span>
              {departments.data?.length ? (
                departments.data.map((d) => (
                  <label className="check-row" key={d.id}>
                    <input
                      type="checkbox"
                      name="departmentIds"
                      value={d.id}
                      defaultChecked={editing.department_ids.includes(d.id)}
                    />
                    {d.name}
                  </label>
                ))
              ) : (
                <p className="muted">
                  Crie os departamentos antes de associar pessoas.
                </p>
              )}
            </div>
            <p className="field-hint">
              Ao desativar o acesso, as sessões desta pessoa na empresa serão
              encerradas.
            </p>
          </Form>
        </section>
      )}
      <div className="member-list">
        {team.data!.members.map((m) => (
          <article key={m.id}>
            <Avatar name={m.name} />
            <div>
              <h3>
                {m.name}
                {m.id === user.membershipId && <small> Você</small>}
              </h3>
              <p>{m.email}</p>
              <span className="muted">
                {roleNames[m.role]} · {m.active ? "Acesso ativo" : "Desativado"}
              </span>
            </div>
            <button
              className="button secondary small"
              onClick={() => {
                setEditing(m);
                setCreating(false);
              }}
            >
              Editar acesso
            </button>
          </article>
        ))}
      </div>
      {!!team.data?.invitations.length && (
        <section className="settings-section">
          <h3>Convites pendentes</h3>
          {team.data.invitations.map((i) => (
            <div className="invitation-row" key={i.id}>
              <div>
                <strong>{i.email}</strong>
                <p>
                  {roleNames[i.role]} · Expira em {date(i.expires_at)}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label={`Cancelar convite para ${i.email}`}
                onClick={() => setCancel(i)}
              >
                <X size={18} />
              </button>
            </div>
          ))}
        </section>
      )}
      {team.data?.members.length === 1 &&
        workspace.data &&
        !workspace.data.company.settings.teamConfirmed && (
          <Form
            label="Continuar atendendo sozinho"
            onSubmit={async () => {
              await api("/workspace", {
                method: "PATCH",
                body: {
                  settings: {
                    teamConfirmed: true,
                  },
                },
              });
              await client.invalidateQueries({ queryKey: ["workspace"] });
            }}
          >
            <p className="field-hint">
              Vai começar sozinho? Você pode convidar a equipe depois.
            </p>
          </Form>
        )}
      {cancel && (
        <Confirm
          title="Cancelar este convite?"
          description={`O link enviado para ${cancel.email} deixará de funcionar.`}
          label="Cancelar convite"
          onClose={() => setCancel(null)}
          onConfirm={async () => {
            await api(`/team/invitations/${cancel.id}`, { method: "DELETE" });
            await refresh();
          }}
        />
      )}
    </>
  );
}
export function Departments() {
  const { user } = useSession(),
    client = useQueryClient(),
    [edit, setEdit] = useState<Department | true | null>(null);
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api<Department[]>("/departments"),
  });
  if (!can(user, "departments:manage")) return <Forbidden />;
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Departamentos</h2>
          <p>Organize sua equipe por assunto ou área.</p>
        </div>
        <button className="button small" onClick={() => setEdit(true)}>
          <Plus size={17} />
          Criar departamento
        </button>
      </div>
      {edit && (
        <section className="inline-editor">
          <div className="section-heading">
            <h3>
              {edit === true ? "Novo departamento" : "Editar departamento"}
            </h3>
            <button
              className="icon-button"
              aria-label="Fechar edição"
              onClick={() => setEdit(null)}
            >
              <X size={18} />
            </button>
          </div>
          <Form
            key={edit === true ? "new" : edit.id}
            label="Salvar departamento"
            onSubmit={async (data) => {
              await api(
                edit === true ? "/departments" : `/departments/${edit.id}`,
                {
                  method: edit === true ? "POST" : "PATCH",
                  body: {
                    name: field(data, "name"),
                    description: field(data, "description"),
                  },
                },
              );
              await client.invalidateQueries({ queryKey: ["departments"] });
              await client.invalidateQueries({ queryKey: ["workspace"] });
              setEdit(null);
            }}
          >
            <Field label="Nome">
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={edit === true ? "" : edit.name}
                placeholder="Ex.: Comercial"
              />
            </Field>
            <Field label="Descrição (opcional)">
              <textarea
                name="description"
                maxLength={500}
                rows={2}
                defaultValue={edit === true ? "" : edit.description}
                placeholder="Quais assuntos essa equipe resolve?"
              />
            </Field>
          </Form>
        </section>
      )}
      {departments.isPending ? (
        <Loading />
      ) : departments.error ? (
        <Retry error={departments.error} retry={() => departments.refetch()} />
      ) : departments.data?.length ? (
        <div className="department-list">
          {departments.data.map((d) => (
            <article key={d.id}>
              <Waypoints size={22} />
              <div>
                <h3>{d.name}</h3>
                <p>{d.description || "Sem descrição"}</p>
                <span className="muted">
                  {d.members} {d.members === 1 ? "pessoa" : "pessoas"} na equipe
                </span>
              </div>
              <button
                className="button secondary small"
                onClick={() => setEdit(d)}
              >
                Editar
              </button>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Waypoints size={34} />}
          title="Cada assunto encontra sua equipe."
          action={
            <button className="button secondary" onClick={() => setEdit(true)}>
              Criar primeiro departamento
            </button>
          }
        >
          Comercial, Financeiro, Suporte. Crie as áreas que fazem sentido para
          sua empresa.
        </Empty>
      )}
      <Link className="text-link" to="/configuracoes/equipe">
        Associar pessoas aos departamentos
        <ArrowRight size={16} />
      </Link>
    </>
  );
}
export function HoursSettings() {
  const { user } = useSession(),
    workspace = useWorkspace(),
    client = useQueryClient(),
    [values, setValues] = useState<CompanyConfig | null>(null);
  if (!can(user, "company:manage")) return <Forbidden />;
  if (workspace.isPending) return <Loading />;
  if (workspace.error)
    return <Retry error={workspace.error} retry={() => workspace.refetch()} />;
  const config = values ?? {
    ...defaultSettings,
    ...workspace.data!.company.settings,
  };
  const days = [
    "Domingo",
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado",
  ];
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Horário de atendimento</h2>
          <p>Deixe claro quando sua equipe está disponível.</p>
        </div>
      </div>
      <Form
        onSubmit={async (data) => {
          await api("/workspace", {
            method: "PATCH",
            body: {
              settings: {
                ...config,
                timezone: field(data, "timezone"),
                outsideMessage: field(data, "outsideMessage"),
              },
            },
          });
          await client.invalidateQueries({ queryKey: ["workspace"] });
        }}
      >
        <Field label="Fuso horário">
          <select name="timezone" defaultValue={config.timezone}>
            <option value="America/Sao_Paulo">Brasília · São Paulo</option>
            <option value="America/Manaus">Manaus</option>
            <option value="America/Rio_Branco">Rio Branco</option>
            <option value="America/Noronha">Fernando de Noronha</option>
          </select>
        </Field>
        <div className="hours-list">
          {config.hours.map((h, i) => (
            <div className="hours-row" key={days[i]}>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={h.enabled}
                  onChange={(e) =>
                    setValues({
                      ...config,
                      hours: config.hours.map((v, index) =>
                        index === i ? { ...v, enabled: e.target.checked } : v,
                      ),
                    })
                  }
                />
                <span>{days[i]}</span>
              </label>
              <div className="hours-inputs">
                {h.enabled ? (
                  <>
                    <input
                      aria-label={`Abertura de ${days[i]}`}
                      type="time"
                      required
                      value={h.start}
                      onChange={(e) =>
                        setValues({
                          ...config,
                          hours: config.hours.map((v, index) =>
                            index === i ? { ...v, start: e.target.value } : v,
                          ),
                        })
                      }
                    />
                    <span>até</span>
                    <input
                      aria-label={`Fechamento de ${days[i]}`}
                      type="time"
                      required
                      value={h.end}
                      onChange={(e) =>
                        setValues({
                          ...config,
                          hours: config.hours.map((v, index) =>
                            index === i ? { ...v, end: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </>
                ) : (
                  <span className="muted">Fechado</span>
                )}
              </div>
            </div>
          ))}
        </div>
        <Field
          label="Mensagem fora do expediente"
          hint="Texto preparado para o atendimento. O envio automático depende da conexão e da automação do WhatsApp."
        >
          <textarea
            name="outsideMessage"
            rows={4}
            maxLength={1000}
            defaultValue={config.outsideMessage}
          />
        </Field>
      </Form>
    </>
  );
}
export function WhatsAppSettings() {
  const { user } = useSession(),
    client = useQueryClient(),
    [working, setWorking] = useState(false),
    [error, setError] = useState<unknown>(),
    [remove, setRemove] = useState<WhatsAppConnection | null>(null),
    [seconds, setSeconds] = useState(0);
  const connections = useQuery({
    queryKey: ["whatsapp-connections"],
    queryFn: () => api<WhatsAppConnection[]>("/whatsapp/connections"),
    refetchInterval: (query) => {
      const status = query.state.data?.[0]?.status;
      return ["connecting", "qr_ready", "syncing", "reconnecting"].includes(
        status ?? "",
      )
        ? 1500
        : 15000;
    },
  });
  const connection = connections.data?.[0];
  useEffect(() => {
    if (!connection?.qrExpiresAt) return setSeconds(0);
    const update = () =>
      setSeconds(
        Math.max(
          0,
          Math.ceil(
            (new Date(connection.qrExpiresAt!).getTime() - Date.now()) / 1000,
          ),
        ),
      );
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [connection?.qrExpiresAt]);
  useEffect(() => {
    if (connection?.status)
      void client.invalidateQueries({ queryKey: ["workspace"] });
  }, [client, connection?.status]);
  if (!can(user, "whatsapp:manage")) return <Forbidden />;
  if (connections.isPending) return <Loading />;
  if (connections.error)
    return (
      <Retry error={connections.error} retry={() => connections.refetch()} />
    );
  async function act(operation: () => Promise<unknown>) {
    setWorking(true);
    setError(undefined);
    try {
      await operation();
      await Promise.all([
        connections.refetch(),
        client.invalidateQueries({ queryKey: ["workspace"] }),
      ]);
    } catch (reason) {
      setError(reason);
    } finally {
      setWorking(false);
    }
  }
  const status = connection?.status ?? "not_configured";
  const isConnecting = ["connecting", "syncing", "reconnecting"].includes(
    status,
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>WhatsApp da empresa</h2>
          <p>O ponto de encontro entre seus clientes e sua equipe.</p>
        </div>
      </div>
      {status === "not_configured" && (
        <section className="whatsapp-intro">
          <div className="whatsapp-intro-copy">
            <span className="channel-icon" aria-hidden="true">
              <QrCode size={34} />
            </span>
            <h3>Seu WhatsApp, pronto em poucos minutos.</h3>
            <p>
              Use o mesmo número que sua empresa já atende. O celular continua
              funcionando normalmente e o Caju mantém a sessão protegida para
              retomar a conexão depois de reinícios.
            </p>
            <button
              className="button"
              disabled={working}
              onClick={() =>
                act(() => api("/whatsapp/connections", { method: "POST" }))
              }
            >
              {working ? (
                <RefreshCw className="spin" size={17} />
              ) : (
                <QrCode size={17} />
              )}
              {working ? "Preparando QR Code…" : "Conectar com QR Code"}
            </button>
          </div>
          <ol className="connection-steps" aria-label="Como conectar">
            <li>
              <span>1</span>
              <div>
                <strong>Abra o WhatsApp no celular</strong>
                <p>Entre em Aparelhos conectados nas configurações.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Toque em Conectar aparelho</strong>
                <p>O WhatsApp abrirá a câmera com segurança.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Aponte para o QR Code</strong>
                <p>O Caju confirma quando a sincronização terminar.</p>
              </div>
            </li>
          </ol>
        </section>
      )}
      {status === "qr_ready" && connection?.qr && (
        <section className="qr-connect-layout" aria-live="polite">
          <div className="qr-stage">
            <p className="mobile-qr-helper">Escaneie com outro celular</p>
            <div className="qr-frame">
              <QRCodeSVG
                value={connection.qr}
                size={244}
                level="M"
                marginSize={1}
                bgColor="#ffffff"
                fgColor="#241f22"
                title="QR Code para conectar o WhatsApp"
              />
              <span className="qr-mark" aria-hidden="true">
                <img src="/brand/caju.png" alt="" />
              </span>
            </div>
            <p className="qr-timer">
              <span className={seconds < 15 ? "urgent" : ""}>
                {seconds > 0 ? `Renova em ${seconds}s` : "Renovando QR Code…"}
              </span>
            </p>
          </div>
          <div className="qr-guidance">
            <Badge color="amber">Aguardando leitura</Badge>
            <h3>
              <span className="desktop-scan-copy">
                Agora, escaneie com o celular.
              </span>
              <span className="mobile-scan-copy">
                Use outro aparelho para escanear.
              </span>
            </h3>
            <p>
              <span className="desktop-scan-copy">
                No WhatsApp, abra{" "}
                <strong>Configurações → Aparelhos conectados</strong> e toque em{" "}
                <strong>Conectar aparelho</strong>.
              </span>
              <span className="mobile-scan-copy">
                Deixe este QR aberto. No outro celular, entre em{" "}
                <strong>Configurações → Aparelhos conectados</strong> e toque em{" "}
                <strong>Conectar aparelho</strong>. Se você só tem um celular,
                abra o Caju em um computador.
              </span>
            </p>
            <div className="privacy-line">
              <ShieldCheck size={20} />
              <span>
                O QR Code é temporário. As chaves da sessão são criptografadas
                antes de serem salvas.
              </span>
            </div>
            <button
              className="button secondary small"
              disabled={working}
              onClick={() =>
                act(() =>
                  api(`/whatsapp/connections/${connection.id}/reconnect`, {
                    method: "POST",
                  }),
                )
              }
            >
              <RefreshCw size={15} />
              Gerar outro QR Code
            </button>
          </div>
        </section>
      )}
      {isConnecting && (
        <section className="connection-progress" role="status">
          <span className="connection-pulse">
            <Signal size={30} />
          </span>
          <div>
            <h3>
              {status === "reconnecting"
                ? "Recuperando a conexão…"
                : status === "syncing"
                  ? "Organizando suas conversas…"
                  : "Preparando uma conexão segura…"}
            </h3>
            <p>
              {status === "reconnecting"
                ? "Você não precisa fazer nada. O Caju está tentando voltar sozinho."
                : "Isso costuma levar apenas alguns segundos. Pode deixar esta página aberta."}
            </p>
          </div>
        </section>
      )}
      {status === "connected" && connection && (
        <section className="connected-whatsapp">
          <div className="connected-primary">
            <span className="connected-symbol" aria-hidden="true">
              <Wifi size={30} />
            </span>
            <div>
              <h3>{connection.profile_name || "WhatsApp principal"}</h3>
              <p>{connection.phone || "Número conectado"}</p>
            </div>
            <span className="live-state">
              <i /> Operando normalmente
            </span>
          </div>
          <dl className="connection-facts">
            <div>
              <dt>Conectado desde</dt>
              <dd>
                {connection.connected_at
                  ? date(connection.connected_at)
                  : "Agora"}
              </dd>
            </div>
            <div>
              <dt>Retomada automática</dt>
              <dd>Ativa</dd>
            </div>
            <div>
              <dt>Sessão protegida</dt>
              <dd>Criptografada</dd>
            </div>
          </dl>
          <div className="connection-actions">
            <button
              className="button secondary small"
              disabled={working}
              onClick={() =>
                act(() =>
                  api(`/whatsapp/connections/${connection.id}/reconnect`, {
                    method: "POST",
                  }),
                )
              }
            >
              <RefreshCw size={15} />
              Reconectar agora
            </button>
            <button
              className="button quiet-danger small"
              onClick={() => setRemove(connection)}
            >
              <WifiOff size={15} />
              Remover conexão
            </button>
          </div>
        </section>
      )}
      {["attention", "error", "disconnected"].includes(status) &&
        connection && (
          <section className="connection-attention">
            <span className="attention-symbol">
              <WifiOff size={29} />
            </span>
            <div>
              <Badge color="amber">Atenção necessária</Badge>
              <h3>Este número precisa ser conectado novamente.</h3>
              <p>
                {connection.last_error_message ||
                  "A sessão não está mais disponível. Gere um novo QR Code para retomar o atendimento."}
              </p>
              <div className="connection-actions">
                <button
                  className="button"
                  disabled={working}
                  onClick={() =>
                    act(() =>
                      api(`/whatsapp/connections/${connection.id}/reconnect`, {
                        method: "POST",
                      }),
                    )
                  }
                >
                  <QrCode size={16} />
                  Conectar novamente
                </button>
                <button
                  className="button quiet-danger"
                  onClick={() => setRemove(connection)}
                >
                  Remover número
                </button>
              </div>
            </div>
          </section>
        )}
      <ErrorMessage error={error} />
      <div className="notice info whatsapp-policy-note">
        <ShieldCheck size={19} />
        <span>
          Este modo conecta o Caju como um aparelho vinculado. Use apenas para
          atendimento solicitado pelo cliente; disparos em massa e mensagens não
          autorizadas podem causar restrições no número.
        </span>
      </div>
      <Link className="text-link" to="/">
        Voltar à preparação da empresa
        <ArrowRight size={16} />
      </Link>
      {remove && (
        <Confirm
          title="Remover este WhatsApp?"
          description="O Caju encerrará a sessão neste aparelho e apagará as chaves protegidas. Para usar o número novamente, será necessário escanear outro QR Code."
          label="Remover conexão"
          danger
          onClose={() => setRemove(null)}
          onConfirm={() =>
            act(async () => {
              await api(`/whatsapp/connections/${remove.id}`, {
                method: "DELETE",
              });
              setRemove(null);
            })
          }
        />
      )}
    </>
  );
}
const themes = [
  {
    id: "claro",
    name: "Caju claro",
    description: "Leve e direto para o dia a dia.",
  },
  {
    id: "escuro",
    name: "Caju escuro",
    description: "Grafite, com contraste confortável.",
  },
  {
    id: "areia",
    name: "Areia",
    description: "Tons de papel, quentes e tranquilos.",
  },
  {
    id: "cafe",
    name: "Café",
    description: "Escuro acolhedor, com nuances de cacau.",
  },
];
export function Appearance() {
  const { user } = useSession(),
    client = useQueryClient(),
    [pending, setPending] = useState(""),
    [error, setError] = useState<unknown>();
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Um Caju com a sua cara.</h2>
          <p>Escolha o que deixa suas horas de trabalho mais confortáveis.</p>
        </div>
      </div>
      <div className="theme-grid">
        {themes.map((t) => (
          <button
            key={t.id}
            disabled={!!pending}
            aria-pressed={user.theme === t.id}
            className={`theme-option ${user.theme === t.id ? "selected" : ""}`}
            onClick={async () => {
              setPending(t.id);
              setError(undefined);
              try {
                await api("/auth/profile", {
                  method: "PATCH",
                  body: { theme: t.id },
                });
                document.documentElement.dataset.theme = t.id;
                try {
                  localStorage.setItem("caju-theme", t.id);
                } catch {}
                client.setQueryData<Session>(["session"], (old) =>
                  old ? { ...old, user: { ...old.user, theme: t.id } } : old,
                );
              } catch (e) {
                setError(e);
              } finally {
                setPending("");
              }
            }}
          >
            <span className="theme-preview" data-theme={t.id}>
              <span className="preview-sidebar">
                <i />
                <i />
                <i />
              </span>
              <span className="preview-content">
                <i />
                <span>
                  <i />
                  <i />
                </span>
                <i />
              </span>
              <span className="preview-button" />
            </span>
            <span className="theme-label">
              <strong>{t.name}</strong>
              {user.theme === t.id && <Check size={19} />}
            </span>
            <span className="theme-description">
              {pending === t.id ? "Aplicando tema…" : t.description}
            </span>
          </button>
        ))}
      </div>
      <ErrorMessage error={error} />
      <p className="field-hint">
        Sua preferência é salva na conta e acompanha você nos outros
        dispositivos.
      </p>
      <section className="settings-section">
        <h3>Feito para ser confortável</h3>
        <p>
          Os quatro temas ajustam fundos, textos, campos, divisores e estados. O
          Caju também respeita a preferência de redução de movimento do seu
          dispositivo.
        </p>
      </section>
    </>
  );
}
export function MyAccount() {
  const { user } = useSession(),
    client = useQueryClient(),
    [revoke, setRevoke] = useState(false);
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () =>
      api<
        {
          created_at: string;
          last_seen_at: string;
          expires_at: string;
          current: boolean;
        }[]
      >("/auth/sessions"),
  });
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Minha conta</h2>
          <p>Seus dados e a segurança do seu acesso.</p>
        </div>
        <Avatar name={user.name} />
      </div>
      <Form
        onSubmit={async (data) => {
          await api("/auth/profile", {
            method: "PATCH",
            body: { name: field(data, "name") },
          });
          await client.invalidateQueries({ queryKey: ["session"] });
        }}
      >
        <Field label="Seu nome">
          <input
            name="name"
            required
            minLength={2}
            maxLength={100}
            defaultValue={user.name}
          />
        </Field>
        <Field label="E-mail de acesso">
          <input type="email" readOnly value={user.email} />
        </Field>
      </Form>
      <section className="settings-section">
        <h2>Alterar senha</h2>
        <p>As outras sessões serão encerradas ao alterar a senha.</p>
        <Form
          label="Alterar senha"
          onSubmit={async (data) => {
            await api("/auth/password", {
              method: "POST",
              body: {
                currentPassword: field(data, "currentPassword"),
                password: field(data, "password"),
              },
            });
            await client.invalidateQueries({ queryKey: ["sessions"] });
          }}
        >
          <Field label="Senha atual">
            <input
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              maxLength={128}
            />
          </Field>
          <Field label="Nova senha" hint="Use pelo menos 12 caracteres.">
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </Field>
        </Form>
      </section>
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <h2>Sessões ativas</h2>
            <p>Acompanhe seus acessos ao Caju.</p>
          </div>
        </div>
        {sessions.error ? (
          <Retry error={sessions.error} retry={() => sessions.refetch()} />
        ) : sessions.isPending ? (
          <Loading />
        ) : (
          sessions.data?.map((s, i) => (
            <div className="session-row" key={i}>
              <Monitor size={20} />
              <div>
                <strong>
                  {s.current ? "Este dispositivo" : "Outro acesso"}
                </strong>
                <p>Última atividade em {date(s.last_seen_at)}</p>
              </div>
              {s.current && <Badge color="teal">Atual</Badge>}
            </div>
          ))
        )}
        {sessions.data && sessions.data.length > 1 && (
          <button className="button secondary" onClick={() => setRevoke(true)}>
            Encerrar as outras sessões
          </button>
        )}
      </section>
      {revoke && (
        <Confirm
          title="Encerrar as outras sessões?"
          description="Sua conta continuará aberta neste dispositivo. Nos outros acessos, será necessário entrar novamente."
          label="Encerrar sessões"
          onClose={() => setRevoke(false)}
          onConfirm={async () => {
            await api("/auth/revoke-sessions", { method: "POST" });
            await client.invalidateQueries({ queryKey: ["sessions"] });
          }}
        />
      )}
    </>
  );
}
export function Tags() {
  const { user } = useSession(),
    client = useQueryClient(),
    [add, setAdd] = useState(false),
    [remove, setRemove] = useState<Tag | null>(null);
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: () => api<Tag[]>("/tags"),
  });
  if (!can(user, "company:manage")) return <Forbidden />;
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Etiquetas</h2>
          <p>Identifique o contexto de cada contato rapidamente.</p>
        </div>
        <button className="button small" onClick={() => setAdd(!add)}>
          <Plus size={17} />
          {add ? "Fechar" : "Nova etiqueta"}
        </button>
      </div>
      {add && (
        <section className="inline-editor">
          <Form
            label="Criar etiqueta"
            onSubmit={async (data) => {
              await api("/tags", {
                method: "POST",
                body: {
                  name: field(data, "name"),
                  color: field(data, "color"),
                },
              });
              await client.invalidateQueries({ queryKey: ["tags"] });
              setAdd(false);
            }}
          >
            <Field label="Nome da etiqueta">
              <input
                name="name"
                required
                maxLength={100}
                placeholder="Ex.: Cliente recorrente"
              />
            </Field>
            <Field label="Cor">
              <select name="color">
                <option value="coral">Coral</option>
                <option value="amber">Âmbar</option>
                <option value="blue">Azul</option>
                <option value="violet">Violeta</option>
                <option value="teal">Petróleo</option>
                <option value="slate">Cinza</option>
              </select>
            </Field>
          </Form>
        </section>
      )}
      {tags.isPending ? (
        <Loading />
      ) : tags.error ? (
        <Retry error={tags.error} retry={() => tags.refetch()} />
      ) : tags.data?.length ? (
        <div className="tag-settings-list">
          {tags.data.map((t) => (
            <div key={t.id}>
              <Badge color={t.color}>{t.name}</Badge>
              <button
                className="icon-button"
                aria-label={`Excluir etiqueta ${t.name}`}
                onClick={() => setRemove(t)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={<TagIcon size={32} />}
          title="Um detalhe que organiza muito."
        >
          Crie etiquetas para encontrar contatos por assunto, interesse ou
          relacionamento.
        </Empty>
      )}
      {remove && (
        <Confirm
          danger
          title={`Excluir a etiqueta “${remove.name}”?`}
          description="Ela será removida dos contatos associados. Os contatos serão preservados. Esta ação não pode ser desfeita."
          label="Excluir etiqueta"
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await api(`/tags/${remove.id}`, { method: "DELETE" });
            await client.invalidateQueries({ queryKey: ["tags"] });
            await client.invalidateQueries({ queryKey: ["contacts"] });
          }}
        />
      )}
    </>
  );
}
type AuditEntry = {
  id: string;
  action: string;
  actor_name: string | null;
  created_at: string;
  entity_id: string;
  metadata: Record<string, unknown>;
};
export function Audit() {
  const { user } = useSession(),
    [before, setBefore] = useState<string[]>([]),
    cursor = before.at(-1);
  const logs = useQuery({
    queryKey: ["audit", cursor],
    queryFn: () =>
      api<AuditEntry[]>(`/audit${cursor ? `?before=${cursor}` : ""}`),
    enabled: can(user, "audit:read"),
  });
  if (!can(user, "audit:read")) return <Forbidden />;
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Histórico de ações</h2>
          <p>O que mudou na empresa, quando e por quem.</p>
        </div>
      </div>
      {logs.isPending ? (
        <Loading />
      ) : logs.error ? (
        <Retry error={logs.error} retry={() => logs.refetch()} />
      ) : logs.data?.length ? (
        <>
          <div className="audit-list">
            {logs.data.map((a) => (
              <article key={a.id}>
                <span className="audit-dot" />
                <div>
                  <h3>{a.action}</h3>
                  <p>
                    {a.actor_name ?? "Sistema"}
                    <span> · </span>
                    <time dateTime={a.created_at}>{date(a.created_at)}</time>
                  </p>
                </div>
              </article>
            ))}
          </div>
          <div className="pagination">
            <button
              className="button secondary small"
              disabled={!before.length}
              onClick={() => setBefore((v) => v.slice(0, -1))}
            >
              Mais recentes
            </button>
            <button
              className="button secondary small"
              disabled={logs.data.length < 50}
              onClick={() => setBefore((v) => [...v, logs.data!.at(-1)!.id])}
            >
              Mais antigas
            </button>
          </div>
        </>
      ) : (
        <Empty icon={<History size={30} />} title="Nenhuma ação neste período">
          As alterações importantes da empresa aparecerão aqui.
        </Empty>
      )}
    </>
  );
}
