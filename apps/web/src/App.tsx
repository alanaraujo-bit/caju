import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  Clock3,
  ContactRound,
  Home,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Users,
  WifiOff,
  X,
  Menu,
  Smartphone,
  CalendarClock,
  MessageSquareText,
  Plus,
} from "lucide-react";
import { api, ApiError, type Session, type Workspace, type User } from "./api";
import {
  Avatar,
  Empty,
  Loading,
  Logo,
  PageTitle,
  Retry,
  StepLink,
  Confirm,
} from "./ui";
import { Auth } from "./Auth";
import {
  Contacts,
  ContactEditor,
  Followups,
  QuickReplies,
  ReplyEditor,
} from "./Operations";
import {
  SettingsLayout,
  CompanySettings,
  Team,
  Departments,
  HoursSettings,
  WhatsAppSettings,
  Appearance,
  MyAccount,
  Tags,
  Audit,
} from "./Settings";
const SessionContext = createContext<Session>(null!);
export const useSession = () => useContext(SessionContext);
export const useWorkspace = () =>
  useQuery({
    queryKey: ["workspace"],
    queryFn: () => api<Workspace>("/workspace"),
  });
export const can = (user: User, permission: string) =>
  user.permissions.includes(permission);
export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<Auth />} />
      <Route path="/criar-conta" element={<Auth />} />
      <Route path="/recuperar" element={<Auth />} />
      <Route path="/redefinir" element={<Auth />} />
      <Route path="/convite" element={<Auth />} />
      <Route element={<Authenticated />}>
        <Route index element={<HomePage />} />
        <Route path="contatos" element={<Contacts />} />
        <Route path="contatos/novo" element={<ContactEditor />} />
        <Route path="contatos/:id" element={<ContactEditor />} />
        <Route path="retornos" element={<Followups />} />
        <Route path="respostas" element={<QuickReplies />} />
        <Route path="respostas/nova" element={<ReplyEditor />} />
        <Route path="respostas/:id" element={<ReplyEditor />} />
        <Route path="configuracoes" element={<SettingsLayout />}>
          <Route index element={<Navigate to="empresa" replace />} />
          <Route path="empresa" element={<CompanySettings />} />
          <Route path="equipe" element={<Team />} />
          <Route path="departamentos" element={<Departments />} />
          <Route path="horarios" element={<HoursSettings />} />
          <Route path="whatsapp" element={<WhatsAppSettings />} />
          <Route path="etiquetas" element={<Tags />} />
          <Route path="aparencia" element={<Appearance />} />
          <Route path="conta" element={<MyAccount />} />
          <Route path="historico" element={<Audit />} />
        </Route>
        <Route
          path="*"
          element={
            <Empty
              icon={<Search />}
              title="Esta página não foi encontrada"
              action={
                <Link to="/" className="button">
                  Voltar ao início
                </Link>
              }
            >
              Confira o endereço ou volte para seu espaço.
            </Empty>
          }
        />
      </Route>
    </Routes>
  );
}
function Authenticated() {
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/auth/me"),
    retry: false,
    refetchInterval: 60000,
  });
  const queryClient = useQueryClient();
  useEffect(() => {
    if (session.data) {
      const theme = session.data.user.theme;
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem("caju-theme", theme);
      } catch {}
    }
  }, [session.data?.user.theme]);
  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401)
      queryClient.removeQueries({
        predicate: (q) => q.queryKey[0] !== "session",
      });
  }, [session.error, queryClient]);
  if (session.isPending) return <Loading />;
  if (session.error instanceof ApiError && session.error.status === 401)
    return <Navigate to="/entrar" replace />;
  if (session.error)
    return (
      <main className="fatal">
        <Retry error={session.error} retry={() => session.refetch()} />
        <Link to="/entrar">Voltar para entrar</Link>
      </main>
    );
  return (
    <SessionContext.Provider value={session.data!}>
      <Shell />
    </SessionContext.Provider>
  );
}
function Shell() {
  const { user, companies } = useSession(),
    workspace = useWorkspace(),
    navigate = useNavigate(),
    location = useLocation(),
    queryClient = useQueryClient();
  const [online, setOnline] = useState(navigator.onLine),
    [logout, setLogout] = useState(false),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    setMenu(false);
    document.querySelector(".main-content")?.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const fn = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        navigate("/contatos");
        setTimeout(
          () =>
            document.querySelector<HTMLInputElement>("[data-search]")?.focus(),
          100,
        );
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [navigate]);
  const links = [
    { to: "/", icon: Home, label: "Início" },
    { to: "/contatos", icon: ContactRound, label: "Contatos" },
    { to: "/retornos", icon: CalendarClock, label: "Retornos" },
    { to: "/respostas", icon: MessageSquareText, label: "Respostas rápidas" },
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <aside className={`sidebar ${menu ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <Link to="/" aria-label="Caju, início">
            <Logo />
          </Link>
          <button
            className="icon-button mobile-only"
            onClick={() => setMenu(false)}
            aria-label="Fechar navegação"
          >
            <X />
          </button>
        </div>
        <div className="company-switch">
          <span className="company-avatar">
            {workspace.data?.company.name[0] ?? "C"}
          </span>
          <div>
            <strong>{workspace.data?.company.name ?? "Sua empresa"}</strong>
            <small>Seu espaço de atendimento</small>
          </div>
          {companies.length > 1 && (
            <select
              aria-label="Trocar empresa"
              value={user.tenantId}
              onChange={async (e) => {
                await api("/auth/switch", {
                  method: "POST",
                  body: { tenantId: e.target.value },
                });
                queryClient.clear();
                navigate("/");
              }}
            >
              {companies.map((c) => (
                <option key={c.tenant_id} value={c.tenant_id}>
                  {c.company_name}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          className="search-shortcut"
          onClick={() => {
            navigate("/contatos");
            setTimeout(
              () =>
                document
                  .querySelector<HTMLInputElement>("[data-search]")
                  ?.focus(),
              100,
            );
          }}
        >
          <Search size={17} />
          <span>Buscar contato</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav aria-label="Navegação principal">
          {links.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === "/"}>
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink className="settings-link" to="/configuracoes">
            <Settings size={19} />
            Configurações
          </NavLink>
          <div className="sidebar-divider" />
          <Link className="profile" to="/configuracoes/conta">
            <Avatar name={user.name} />
            <span>
              <strong>{user.name}</strong>
              <small>
                {user.role === "admin"
                  ? "Administrador"
                  : user.role === "supervisor"
                    ? "Supervisor"
                    : "Atendente"}
              </small>
            </span>
            <ChevronDown size={16} />
          </Link>
          <button className="logout-button" onClick={() => setLogout(true)}>
            <LogOut size={16} />
            Sair da conta
          </button>
        </div>
      </aside>
      {menu && (
        <button
          className="nav-backdrop"
          onClick={() => setMenu(false)}
          aria-label="Fechar menu"
        />
      )}
      <section className="workspace">
        <header className="topbar" role="banner">
          <div className="mobile-top">
            <button
              className="icon-button"
              aria-label="Abrir navegação"
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <Logo />
          </div>
          <span className="desktop-top">
            {location.pathname.startsWith("/configuracoes")
              ? "Configurações"
              : location.pathname.startsWith("/contatos")
                ? "Relacionamento"
                : location.pathname.startsWith("/retornos")
                  ? "Acompanhamento"
                  : location.pathname.startsWith("/respostas")
                    ? "Produtividade"
                    : "Seu espaço"}
          </span>
          <Link className="connection-state" to="/configuracoes/whatsapp">
            <span className="status-dot" />
            WhatsApp não conectado
            <ArrowUpRight size={14} />
          </Link>
        </header>
        {!online && (
          <div className="offline-banner" role="alert">
            <WifiOff size={17} />
            Você está sem conexão. Reconecte-se para salvar alterações.
          </div>
        )}
        <main id="conteudo" className="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <nav className="bottom-nav" aria-label="Navegação no celular">
          {links.slice(0, 3).map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === "/"}>
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
          <NavLink to="/configuracoes">
            <Settings size={20} />
            <span>Ajustes</span>
          </NavLink>
        </nav>
      </section>
      {logout && (
        <Confirm
          title="Sair do Caju?"
          description="Sua sessão neste dispositivo será encerrada. Você poderá entrar novamente quando precisar."
          label="Sair da conta"
          onClose={() => setLogout(false)}
          onConfirm={async () => {
            await api("/auth/logout", { method: "POST" });
            queryClient.clear();
            navigate("/entrar", { replace: true });
          }}
        />
      )}
    </div>
  );
}
function HomePage() {
  const { user } = useSession(),
    workspace = useWorkspace();
  if (workspace.isPending) return <Loading />;
  if (workspace.error)
    return <Retry error={workspace.error} retry={() => workspace.refetch()} />;
  const { company, counts } = workspace.data!,
    settings = company.settings,
    admin = can(user, "company:manage");
  const steps = [
    {
      title: "Os dados da sua empresa",
      description: company.name,
      to: "/configuracoes/empresa",
      done: true,
    },
    {
      title: "Sua equipe por perto",
      description: "Convide quem vai atender com você.",
      to: "/configuracoes/equipe",
      done:
        counts.users > 1 || counts.invitations > 0 || !!settings.teamConfirmed,
    },
    {
      title: "Cada assunto no lugar certo",
      description: "Organize o atendimento por departamentos.",
      to: "/configuracoes/departamentos",
      done: counts.departments > 0,
    },
    {
      title: "Um horário para atender",
      description: "Defina quando sua empresa está disponível.",
      to: "/configuracoes/horarios",
      done: !!settings.hours,
    },
    {
      title: "O WhatsApp da sua empresa",
      description: "Conecte o número que seus clientes já conhecem.",
      to: "/configuracoes/whatsapp",
      done: false,
    },
  ];
  const completed = steps.filter((s) => s.done).length;
  return (
    <div className="page home-page">
      <PageTitle
        title={`Olá, ${user.name.split(" ")[0]}.`}
        description={
          admin
            ? "Vamos deixar tudo pronto para sua equipe atender bem."
            : "Tudo organizado para cuidar dos seus clientes."
        }
      />
      {admin ? (
        <div className="home-grid">
          <section className="setup-panel">
            <div className="setup-heading">
              <div>
                <h2>Um bom começo faz diferença.</h2>
                <p>Prepare seu espaço, um passo de cada vez.</p>
              </div>
              <span className="setup-count">
                {completed}
                <span> de 5</span>
              </span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Configuração da empresa"
              aria-valuenow={completed}
              aria-valuemin={0}
              aria-valuemax={5}
            >
              <span style={{ transform: `scaleX(${completed / 5})` }} />
            </div>
            <div className="setup-list">
              {steps.map((step, i) => (
                <StepLink key={step.to} {...step} number={i + 1} />
              ))}
            </div>
            <div className="setup-footnote">
              <ShieldCheck size={17} />
              <span>
                Seu progresso é salvo. Continue quando for melhor para você.
              </span>
            </div>
          </section>
          <aside className="home-aside">
            <div className="welcome-note">
              <img src="/brand/caju.png" alt="Mascote Caju" />
              <h2>
                Tem gente do
                <br />
                outro lado.
              </h2>
              <p>
                E uma equipe inteira deste lado. Vamos cuidar de cada conversa,
                juntos.
              </p>
            </div>
            <div className="channel-note">
              <Smartphone size={22} />
              <h3>Primeiro, a conexão.</h3>
              <p>
                As conversas aparecem aqui quando o WhatsApp estiver conectado.
              </p>
              <Link to="/configuracoes/whatsapp">
                Preparar meu WhatsApp
                <ArrowRight size={16} />
              </Link>
            </div>
          </aside>
        </div>
      ) : (
        <section className="agent-welcome">
          <MessageSquareText size={36} />
          <h2>Seu espaço está sendo preparado</h2>
          <p>
            O administrador ainda precisa conectar o WhatsApp da empresa.
            Enquanto isso, você já pode organizar contatos e retornos.
          </p>
          <Link className="button" to="/contatos">
            Ver contatos
            <ArrowRight size={17} />
          </Link>
        </section>
      )}
      <section className="home-tools">
        <div className="section-heading">
          <h2>Enquanto isso, adiante o dia a dia.</h2>
        </div>
        <Link to="/contatos">
          <ContactRound size={24} />
          <div>
            <h3>Seus contatos</h3>
            <p>
              {counts.contacts > 0
                ? `${counts.contacts} contatos organizados na empresa.`
                : "Comece pelas pessoas que você já atende."}
            </p>
          </div>
          <ArrowUpRight size={19} />
        </Link>
        <Link to="/respostas">
          <MessageSquareText size={24} />
          <div>
            <h3>Respostas que poupam tempo</h3>
            <p>Deixe por perto as informações mais usadas.</p>
          </div>
          <ArrowUpRight size={19} />
        </Link>
      </section>
    </div>
  );
}
