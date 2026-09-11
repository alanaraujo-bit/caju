import { Fragment, useEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCheck,
  ChevronDown,
  FileText,
  Inbox as InboxIcon,
  MessageCircle,
  Search,
  SearchX,
  Send,
  StickyNote,
  UserRoundCheck,
  Check,
  Clock3,
  AlertCircle,
  ArrowDown,
  Zap,
  Paperclip,
  X,
  Download,
  MapPin,
  Contact,
  BarChart3,
  HelpCircle,
  UserRound,
  Smartphone,
} from "lucide-react";
import { api, phoneLabel, type User } from "./api";
import {
  Avatar,
  Empty,
  ErrorMessage,
  Loading,
  Retry,
  Spinner,
  Modal,
} from "./ui";
import { Link, useSearchParams } from "react-router-dom";
import { useSession, can, useWorkspace } from "./App";

type Conversation = {
  id: string;
  protocol: string;
  status: string;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string;
  last_message_from_me: boolean;
  is_group: boolean;
  contact_name: string;
  contact_phone: string | null;
  assignee_name: string | null;
  department_name: string | null;
  assignee_id: string | null;
  department_id: string | null;
  version: number;
  closed_reason?: string | null;
  contact_id?: string | null;
};
type Message = {
  id: string;
  direction: string;
  kind: string;
  body: string;
  media_name: string | null;
  sender_name: string | null;
  sent_at: string;
  status: string;
  has_media?: boolean;
  media_mime?: string;
};
type Upload = { name: string; base64: string };
type SendRequest = {
  id: string;
  body: string;
  internal: boolean;
  attachment: Upload | null;
};
type InboxResponse = {
  items: Conversation[];
  counts: Record<string, number>;
  hasMore: boolean;
};
type Details = {
  conversation: Conversation;
  messages: Message[];
  hasMore: boolean;
};

const statuses = ["waiting", "open", "followup", "closed"] as const;
const statusLabels: Record<string, string> = {
  all: "Todos",
  waiting: "Aguardando",
  open: "Em atendimento",
  followup: "Retorno",
  closed: "Finalizado",
};
const mediaLabels: Record<string, string> = {
  audio: "Áudio",
  image: "Imagem",
  video: "Vídeo",
  sticker: "Figurinha",
  document: "Documento",
  location: "Localização",
  contact: "Contato compartilhado",
  poll: "Enquete",
  unknown: "Mensagem sem visualização no Caju",
};
const kindIcons: Record<string, typeof MapPin> = {
  location: MapPin,
  contact: Contact,
  poll: BarChart3,
  unknown: HelpCircle,
};
// Links do cliente (rastreio, localização, catálogo) precisam abrir sem copiar e colar.
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return parts.map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a key={index} href={part} target="_blank" rel="noreferrer noopener">
        {part}
      </a>
    ) : (
      part
    ),
  );
}
const deliveryLabels: Record<string, string> = {
  queued: "Na fila",
  sending: "Enviando",
  uncertain: "Envio sem confirmação",
  failed: "Falhou",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
};
const deliveryHints: Record<string, string> = {
  queued: "Sai assim que o WhatsApp da empresa estiver conectado.",
  uncertain:
    "A conexão caiu durante o envio. Confira no celular se chegou antes de escrever de novo.",
  failed: "O WhatsApp recusou o envio.",
};
const clock = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});
const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
});
const longDate = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
});
const fullDate = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dayKey = (d: Date) => d.toDateString();
const daysAgo = (d: Date) => {
  const day = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((day(new Date()) - day(d)) / 86_400_000);
};
const time = (value: string) => clock.format(new Date(value));
// Lista: hora se foi hoje, senão a data — "14:32" sozinho não diz nada sobre uma conversa da semana passada.
const rowTime = (value: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  return daysAgo(d) === 0
    ? clock.format(d)
    : daysAgo(d) === 1
      ? "Ontem"
      : d.getFullYear() === new Date().getFullYear()
        ? shortDate.format(d).replace(" de ", " ").replace(".", "")
        : d.toLocaleDateString("pt-BR");
};
const dayLabel = (d: Date) =>
  daysAgo(d) === 0
    ? "Hoje"
    : daysAgo(d) === 1
      ? "Ontem"
      : d.getFullYear() === new Date().getFullYear()
        ? longDate.format(d)
        : fullDate.format(d);

const placeholderConversation = (id: string): Conversation => ({
  id,
  protocol: "",
  status: "waiting",
  unread_count: 0,
  last_message_at: null,
  last_message_preview: "",
  last_message_from_me: false,
  is_group: false,
  contact_name: "Atendimento",
  contact_phone: null,
  assignee_name: null,
  department_name: null,
  assignee_id: null,
  department_id: null,
  version: 1,
});

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const sync = () => setMobile(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}

export function Inbox() {
  // /inbox?c=<id> abre um atendimento específico (vindo do contato ou de um link compartilhado).
  const [params, setParams] = useSearchParams();
  const linked = params.get("c");
  const [status, setStatus] = useState("all"),
    [q, setQ] = useState(""),
    [selected, setSelected] = useState<string | null>(linked),
    // Só o atendimento vindo do link abre fora da lista; ao filtrar ou tocar em outro, volta ao normal.
    [pinned, setPinned] = useState<string | null>(linked),
    [offset, setOffset] = useState(0);
  const mobile = useIsMobile();
  useEffect(() => {
    if (linked) {
      setSelected(linked);
      setPinned(linked);
      setParams({}, { replace: true });
    }
  }, [linked]);
  const list = useQuery({
    queryKey: ["inbox", q, status, offset],
    queryFn: () =>
      api<InboxResponse>(
        `/inbox?q=${encodeURIComponent(q)}&status=${status}&offset=${offset}`,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 2500,
  });
  const items = list.data?.items ?? [];
  useEffect(() => {
    if (!mobile && !selected && items[0]) setSelected(items[0].id);
  }, [mobile, selected, items[0]?.id]);
  const filtersTouched = useRef(false);
  useEffect(() => {
    if (!filtersTouched.current) {
      filtersTouched.current = true;
      return;
    }
    setOffset(0);
    setSelected(null);
    setPinned(null);
  }, [q, status]);
  const counts = list.data?.counts ?? {};
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  // A aba do navegador mostra quantas conversas aguardam, para quem trabalha com várias abas.
  const waiting = counts.waiting ?? 0;
  useEffect(() => {
    const base = "Caju · Atendimento";
    document.title = waiting > 0 ? `(${waiting}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [waiting]);
  // No desktop a primeira conversa abre sozinha; no celular só a que a pessoa tocou, senão a lista fica inacessível.
  const active =
    items.find((item) => item.id === selected) ??
    (selected && selected === pinned && list.data
      ? placeholderConversation(selected)
      : mobile
        ? undefined
        : items[0]);
  const filtering = q.trim() !== "" || status !== "all";
  const move = (offset: number) => {
    const index = items.findIndex((item) => item.id === active?.id);
    const next = items[Math.min(items.length - 1, Math.max(0, index + offset))];
    if (next) setSelected(next.id);
  };
  if (list.isPending) return <Loading />;
  if (list.error && !list.data)
    return <Retry error={list.error} retry={() => list.refetch()} />;
  return (
    <div className={`inbox-page ${active ? "is-reading" : ""}`}>
      <header className="inbox-toolbar">
        <h1>Atendimento</h1>
        <label className="search-input">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar contato, protocolo ou mensagem"
            aria-label="Buscar atendimentos"
          />
        </label>
        <div
          className="segmented"
          role="group"
          aria-label="Filtrar atendimentos por status"
        >
          {["all", ...statuses].map((key) => {
            const n = key === "all" ? total : (counts[key] ?? 0);
            return (
              <button
                key={key}
                className={status === key ? "active" : ""}
                aria-pressed={status === key}
                onClick={() => setStatus(key)}
              >
                {statusLabels[key]}
                {n > 0 && <span className="count">{n}</span>}
              </button>
            );
          })}
        </div>
      </header>
      {list.error && (
        <ErrorMessage
          error={
            new Error("A atualização foi interrompida. Tentando reconectar…")
          }
        />
      )}
      {items.length === 0 && !active ? (
        filtering ? (
          <Empty
            icon={<SearchX />}
            title="Nenhum atendimento encontrado"
            action={
              <button
                className="button secondary"
                onClick={() => {
                  setQ("");
                  setStatus("all");
                }}
              >
                Limpar filtros
              </button>
            }
          >
            Tente outro nome, telefone ou protocolo, ou mude o filtro de status.
          </Empty>
        ) : (
          <Empty icon={<InboxIcon />} title="Sua fila está tranquila">
            Quando uma nova mensagem chegar, o atendimento aparecerá aqui
            automaticamente.
          </Empty>
        )
      ) : (
        <div className="inbox-layout">
          <section
            className="inbox-list"
            aria-label="Lista de atendimentos"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), move(1));
              if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
            }}
          >
            {items.map((item) => (
              <button
                key={item.id}
                className={`inbox-row ${active?.id === item.id ? "selected" : ""} ${item.unread_count > 0 ? "unread" : ""}`}
                aria-current={active?.id === item.id ? "true" : undefined}
                onClick={() => {
                  setSelected(item.id);
                  setPinned(null);
                }}
              >
                <Avatar name={item.contact_name} />
                <span className="inbox-row-main">
                  <span className="inbox-row-top">
                    <strong>{item.contact_name}</strong>
                    <time dateTime={item.last_message_at ?? undefined}>
                      {rowTime(item.last_message_at)}
                    </time>
                  </span>
                  <span className="inbox-row-bottom">
                    <small>
                      {item.last_message_from_me && "Você: "}
                      {item.last_message_preview || "Sem mensagens"}
                    </small>
                    {item.unread_count > 0 && (
                      <b>
                        {item.unread_count > 99 ? "99+" : item.unread_count}
                        <span className="sr-only"> não lidas</span>
                      </b>
                    )}
                    {item.status === "waiting" && status !== "waiting" && (
                      <em className="status-pill status-waiting">Aguardando</em>
                    )}
                  </span>
                </span>
              </button>
            ))}
            {(offset > 0 || list.data?.hasMore) && (
              <div className="inbox-pagination">
                <button
                  className="button secondary"
                  disabled={!offset || list.isFetching}
                  onClick={() => {
                    setOffset(Math.max(0, offset - 100));
                    setSelected(null);
                  }}
                >
                  Anteriores
                </button>
                <button
                  className="button secondary"
                  disabled={!list.data?.hasMore || list.isFetching}
                  onClick={() => {
                    setOffset(offset + 100);
                    setSelected(null);
                  }}
                >
                  Próximos
                </button>
              </div>
            )}
          </section>
          {active && (
            <ConversationView
              key={active.id}
              conversation={active}
              onBack={() => setSelected(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ConversationView({
  conversation: initialConversation,
  onBack,
}: {
  conversation: Conversation;
  onBack: () => void;
}) {
  const session = useSession(),
    queryClient = useQueryClient(),
    workspace = useWorkspace();
  const whatsappStatus = workspace.data?.whatsapp.status ?? "connected";
  const conversationId = initialConversation.id;
  const mobile = useIsMobile();
  const [internal, setInternal] = useState(false);
  const draftKey = [
    "inbox-draft",
    session.user.tenantId,
    session.user.userId,
    conversationId,
    internal,
  ];
  const [draft, setDraft] = useState(
    () => queryClient.getQueryData<string>(draftKey) ?? "",
  );
  const [sending, setSending] = useState(false),
    [closing, setClosing] = useState(false),
    [reason, setReason] = useState(""),
    [older, setOlder] = useState<Message[]>([]),
    [loadingOlder, setLoadingOlder] = useState(false),
    [olderHasMore, setOlderHasMore] = useState<boolean | null>(null),
    [newBelow, setNewBelow] = useState(false),
    [quickOpen, setQuickOpen] = useState(false);
  const attachmentKey = [
    "inbox-attachment",
    session.user.tenantId,
    session.user.userId,
    conversationId,
  ];
  const requestKey = [
    "inbox-send-request",
    session.user.tenantId,
    session.user.userId,
    conversationId,
  ];
  const [attachment, setAttachment] = useState<Upload | null>(
    () => queryClient.getQueryData<Upload>(attachmentKey) ?? null,
  );
  const request = useRef<SendRequest | null>(
    queryClient.getQueryData<SendRequest>(requestKey) ?? null,
  );
  const composer = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<unknown>(null),
    [saving, setSaving] = useState(false);
  const stream = useRef<HTMLDivElement>(null),
    firstScroll = useRef(true),
    // Imagens carregam depois do primeiro scroll; enquanto a pessoa estiver no fim, seguimos o fim.
    stickToEnd = useRef(true);
  const followEnd = () => {
    const el = stream.current;
    if (el && stickToEnd.current) el.scrollTop = el.scrollHeight;
  };
  const details = useQuery({
    queryKey: ["inbox-conversation", conversationId],
    queryFn: () => api<Details>(`/inbox/${conversationId}/messages`),
    refetchInterval: 2000,
  });
  const conversation = details.data?.conversation ?? initialConversation;
  const team = useQuery({
    queryKey: ["inbox-team"],
    queryFn: () => api<{ id: string; name: string }[]>("/inbox/team"),
  });
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api<{ id: string; name: string }[]>("/departments"),
  });
  const quick = useQuery({
    queryKey: ["composer-replies"],
    queryFn: () =>
      api<{ id: string; title: string; body: string; shortcut: string }[]>(
        "/quick-replies",
      ),
    enabled: quickOpen,
  });
  const currentMessages = details.data?.messages ?? [];
  const messages = [
    ...older.filter((m) => !currentMessages.some((x) => x.id === m.id)),
    ...currentMessages,
  ];
  const lastId = messages.at(-1)?.id;
  // Marca como lido ao abrir e sempre que chegar mensagem nova enquanto a conversa está na tela.
  useEffect(() => {
    if (!lastId || document.visibilityState !== "visible") return;
    api(`/inbox/${conversation.id}/read`, {
      method: "POST",
      body: { throughId: lastId },
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["inbox"] }))
      .catch(() => {});
  }, [conversation.id, lastId, details.isPending, queryClient]);
  // Abre no fim da conversa; depois só acompanha se a pessoa já estava perto do fim.
  useEffect(() => {
    const el = stream.current;
    if (!el || !lastId) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    stickToEnd.current = firstScroll.current || nearBottom;
    if (firstScroll.current || nearBottom)
      el.scrollTo({
        top: el.scrollHeight,
        behavior:
          firstScroll.current ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
      });
    else setNewBelow(true);
    firstScroll.current = false;
  }, [lastId]);
  const canManage = can(session.user as User, "inbox:manage");
  const own = conversation.assignee_id === session.user.membershipId;
  const canChange = canManage || own || !conversation.assignee_id;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["inbox"] }),
      queryClient.invalidateQueries({
        queryKey: ["inbox-conversation", conversationId],
      }),
    ]);
  const change = async (body: object) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/inbox/${conversation.id}`, {
        method: "PATCH",
        body: { ...body, version: conversation.version },
      });
      await refresh();
      setClosing(false);
    } catch (e) {
      setError(e);
      await refresh();
    } finally {
      setSaving(false);
    }
  };
  const updateDraft = (value: string) => {
    setDraft(value);
    queryClient.setQueryData(draftKey, value);
  };
  const switchMode = (value: boolean) => {
    setInternal(value);
    setDraft(
      queryClient.getQueryData<string>([...draftKey.slice(0, -1), value]) ?? "",
    );
  };
  const updateAttachment = (value: Upload | null) => {
    setAttachment(value);
    queryClient.setQueryData(attachmentKey, value);
  };
  const attach = async (file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024 || !file.size) {
      setError(new Error("Escolha um arquivo de até 10 MB."));
      return;
    }
    setError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      updateAttachment({ name: file.name, base64 });
    } catch {
      setError(
        new Error("Não foi possível ler o arquivo. Escolha-o novamente."),
      );
    }
  };
  const send = async () => {
    const upload = internal ? null : attachment;
    if (sending || (!draft.trim() && !upload)) return;
    const text = draft.trim();
    if (
      !request.current ||
      request.current.body !== text ||
      request.current.internal !== internal ||
      request.current.attachment !== upload
    )
      request.current = {
        id: crypto.randomUUID(),
        body: text,
        internal,
        attachment: upload,
      };
    queryClient.setQueryData(requestKey, request.current);
    setSending(true);
    setError(null);
    try {
      await api(`/inbox/${conversationId}/messages`, {
        method: "POST",
        body: {
          requestId: request.current.id,
          body: text,
          internal,
          attachment: upload ?? undefined,
        },
      });
      updateDraft("");
      request.current = null;
      queryClient.removeQueries({ queryKey: requestKey });
      if (!internal) updateAttachment(null);
      await refresh();
      stream.current?.scrollTo({ top: stream.current.scrollHeight });
      composer.current?.focus();
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };
  const loadOlder = async () => {
    setLoadingOlder(true);
    setError(null);
    const el = stream.current,
      height = el?.scrollHeight ?? 0;
    try {
      const result = await api<Details>(
        `/inbox/${conversationId}/messages?before=${messages[0].id}`,
      );
      setOlder((existing) => [...result.messages, ...existing]);
      setOlderHasMore(result.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - height;
      });
    } catch (e) {
      setError(e);
    } finally {
      setLoadingOlder(false);
    }
  };
  return (
    <section
      className="inbox-conversation"
      aria-label={`Conversa com ${conversation.contact_name}`}
    >
      <header className="conversation-header">
        <button
          className="icon-button inbox-back"
          onClick={onBack}
          aria-label="Voltar para a lista"
        >
          <ArrowLeft size={19} />
        </button>
        <Avatar name={conversation.contact_name} />
        <div className="conversation-identity">
          <strong role="heading" aria-level={mobile ? 1 : 2}>
            {conversation.contact_name}
          </strong>
          <small>
            {conversation.is_group
              ? "Grupo"
              : (phoneLabel(conversation.contact_phone) ??
                "Número não informado")}
            <span aria-hidden="true"> · </span>
            <span className="protocol">{conversation.protocol}</span>
            {conversation.contact_id && (
              <>
                <span aria-hidden="true"> · </span>
                <Link
                  className="contact-link"
                  to={`/contatos/${conversation.contact_id}`}
                >
                  <UserRound size={12} /> Ver contato
                </Link>
              </>
            )}
          </small>
        </div>
        {canChange ? (
          <label className={`status-select status-${conversation.status}`}>
            <span className="sr-only">Status do atendimento</span>
            <select
              value={conversation.status}
              disabled={saving}
              onChange={(e) =>
                e.target.value === "closed"
                  ? setClosing(true)
                  : change({ status: e.target.value })
              }
            >
              {statuses.map((key) => (
                <option key={key} value={key}>
                  {statusLabels[key]}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
        ) : (
          <span className={`status-pill status-${conversation.status}`}>
            {statusLabels[conversation.status]}
          </span>
        )}
      </header>
      <div className="conversation-ownership">
        <span>
          <UserRoundCheck size={15} />
          {own
            ? "Você está cuidando deste atendimento"
            : conversation.assignee_name
              ? `Com ${conversation.assignee_name}`
              : "Ainda sem responsável"}
        </span>
        {!own && canChange && conversation.status !== "closed" && (
          <button
            className="button secondary"
            disabled={saving}
            onClick={() =>
              change({ assigneeId: session.user.membershipId, status: "open" })
            }
          >
            Assumir atendimento
          </button>
        )}
        {canManage && (
          <details className="conversation-transfer">
            <summary>Transferir</summary>
            <div>
              <label>
                Responsável
                <select
                  aria-label="Responsável pelo atendimento"
                  value={conversation.assignee_id ?? ""}
                  disabled={saving}
                  onChange={(e) =>
                    change({ assigneeId: e.target.value || null })
                  }
                >
                  <option value="">Sem responsável</option>
                  {team.data?.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Departamento
                <select
                  aria-label="Departamento do atendimento"
                  value={conversation.department_id ?? ""}
                  disabled={saving}
                  onChange={(e) =>
                    change({ departmentId: e.target.value || null })
                  }
                >
                  <option value="">Sem departamento</option>
                  {departments.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        )}
      </div>
      <ErrorMessage error={error} />
      {details.isPending ? (
        <Loading />
      ) : details.error ? (
        <Retry error={details.error} retry={() => details.refetch()} />
      ) : (
        <div
          className="message-stream"
          tabIndex={0}
          role="region"
          aria-label="Histórico de mensagens"
          ref={stream}
          onScroll={() => {
            const el = stream.current;
            if (!el) return;
            stickToEnd.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            if (stickToEnd.current) setNewBelow(false);
          }}
        >
          {(olderHasMore ?? details.data?.hasMore) && (
            <button
              className="button secondary older-messages"
              disabled={loadingOlder}
              onClick={loadOlder}
            >
              {loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}
            </button>
          )}
          {messages.length === 0 ? (
            <Empty icon={<MessageCircle />} title="Nenhuma mensagem ainda">
              As mensagens desta conversa aparecerão aqui.
            </Empty>
          ) : (
            messages.map((message, index) => {
              const sent = new Date(message.sent_at),
                previous = messages[index - 1];
              const outbound = message.direction === "outbound";
              return (
                <Fragment key={message.id}>
                  {(!previous ||
                    dayKey(new Date(previous.sent_at)) !== dayKey(sent)) && (
                    <div className="message-day" role="separator">
                      <span>{dayLabel(sent)}</span>
                    </div>
                  )}
                  <article
                    className={`message-bubble ${outbound ? "outbound" : message.direction === "internal" ? "internal" : "inbound"}`}
                  >
                    {message.direction === "internal" && (
                      <strong className="message-sender">
                        <StickyNote size={13} /> Nota interna ·{" "}
                        {message.sender_name}
                      </strong>
                    )}
                    {conversation.is_group &&
                      !outbound &&
                      message.sender_name && (
                        <strong className="message-sender">
                          {message.sender_name}
                        </strong>
                      )}
                    {message.has_media && (
                      <div className="message-media">
                        {message.media_mime?.startsWith("image/") ? (
                          <a
                            href={`/api/inbox/${conversationId}/messages/${message.id}/media`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              src={`/api/inbox/${conversationId}/messages/${message.id}/media`}
                              alt={message.media_name ?? "Imagem recebida"}
                              loading="lazy"
                              onLoad={followEnd}
                            />
                          </a>
                        ) : message.media_mime?.startsWith("audio/") ? (
                          <audio
                            controls
                            preload="none"
                            src={`/api/inbox/${conversationId}/messages/${message.id}/media`}
                            aria-label={
                              message.media_name ?? "Mensagem de áudio"
                            }
                          />
                        ) : message.media_mime?.startsWith("video/") ? (
                          <video
                            controls
                            preload="metadata"
                            src={`/api/inbox/${conversationId}/messages/${message.id}/media`}
                            aria-label={message.media_name ?? "Vídeo recebido"}
                          />
                        ) : (
                          <a
                            href={`/api/inbox/${conversationId}/messages/${message.id}/media`}
                            download
                          >
                            <Download size={16} />
                            {message.media_name ?? "Baixar arquivo"}
                          </a>
                        )}
                      </div>
                    )}
                    {kindIcons[message.kind] && (
                      <strong className="message-kind">
                        {(() => {
                          const Icon = kindIcons[message.kind];
                          return <Icon size={13} />;
                        })()}{" "}
                        {mediaLabels[message.kind]}
                      </strong>
                    )}
                    <p>
                      {message.body
                        ? linkify(message.body)
                        : !message.has_media &&
                          !kindIcons[message.kind] && (
                            <span className="media-placeholder">
                              <FileText size={15} />
                              {message.media_name ||
                                mediaLabels[message.kind] ||
                                "Arquivo"}
                              {message.kind !== "text" && (
                                <span> · indisponível no Caju</span>
                              )}
                            </span>
                          )}
                    </p>
                    <footer>
                      <time dateTime={message.sent_at}>
                        {time(message.sent_at)}
                      </time>
                      {outbound && (
                        <>
                          {message.status === "read" ||
                          message.status === "delivered" ? (
                            <CheckCheck size={13} />
                          ) : message.status === "sent" ? (
                            <Check size={13} />
                          ) : message.status === "uncertain" ||
                            message.status === "failed" ? (
                            <AlertCircle size={13} />
                          ) : (
                            <Clock3 size={13} />
                          )}
                          <span title={deliveryHints[message.status]}>
                            {deliveryLabels[message.status]}
                          </span>
                        </>
                      )}
                    </footer>
                  </article>
                </Fragment>
              );
            })
          )}
        </div>
      )}
      {newBelow && (
        <button
          className="button secondary new-messages"
          onClick={() => {
            stream.current?.scrollTo({ top: stream.current.scrollHeight });
            setNewBelow(false);
          }}
        >
          <ArrowDown size={15} /> Novas mensagens
        </button>
      )}
      {conversation.status === "closed" ? (
        <div className="conversation-closed">
          <CheckCheck size={18} />
          <div>
            <strong>Atendimento finalizado</strong>
            <p>{conversation.closed_reason}</p>
          </div>
          {canChange && (
            <button
              className="button secondary"
              disabled={saving}
              onClick={() => change({ status: "open" })}
            >
              Reabrir
            </button>
          )}
        </div>
      ) : (
        <form
          className={`message-composer ${internal ? "is-internal" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div
            className="composer-modes"
            role="group"
            aria-label="Tipo de mensagem"
          >
            <button
              type="button"
              aria-pressed={!internal}
              onClick={() => switchMode(false)}
              disabled={sending}
            >
              <MessageCircle size={15} /> Responder
            </button>
            <button
              type="button"
              aria-pressed={internal}
              onClick={() => switchMode(true)}
              disabled={sending}
            >
              <StickyNote size={15} /> Nota interna
            </button>
            <button
              type="button"
              className="quick-toggle"
              aria-expanded={quickOpen}
              onClick={() => setQuickOpen(!quickOpen)}
              disabled={sending}
            >
              <Zap size={15} /> Respostas rápidas
            </button>
          </div>
          {!internal && own && whatsappStatus !== "connected" && (
            <p className="composer-notice" role="status">
              <Smartphone size={15} />
              <span>
                {whatsappStatus === "not_configured"
                  ? "O WhatsApp da empresa ainda não foi conectado. Suas mensagens ficam na fila até a conexão existir."
                  : whatsappStatus === "connecting" ||
                      whatsappStatus === "reconnecting" ||
                      whatsappStatus === "qr_ready"
                    ? "O WhatsApp está reconectando. Suas mensagens ficam na fila e saem assim que a conexão voltar."
                    : "O WhatsApp da empresa está desconectado. Suas mensagens ficam na fila até alguém reconectar."}
              </span>
              {canManage && (
                <Link to="/configuracoes/whatsapp">Ver conexão</Link>
              )}
            </p>
          )}
          {!internal && attachment && (
            <div className="composer-attachment">
              <Paperclip size={15} />
              <span>{attachment.name}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="Remover anexo"
                disabled={sending}
                onClick={() => updateAttachment(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {quickOpen && (
            <div className="composer-quick">
              {quick.isPending ? (
                <Spinner />
              ) : quick.error ? (
                <Retry error={quick.error} retry={() => quick.refetch()} />
              ) : !quick.data?.length ? (
                <p>Cadastre suas mensagens em Respostas rápidas.</p>
              ) : (
                quick.data.map((reply) => (
                  <button
                    type="button"
                    key={reply.id}
                    onClick={() => {
                      updateDraft(reply.body);
                      setQuickOpen(false);
                      composer.current?.focus();
                    }}
                  >
                    <strong>{reply.title}</strong>
                    <span>/{reply.shortcut}</span>
                  </button>
                ))
              )}
            </div>
          )}
          <label className="sr-only" htmlFor={`message-${conversationId}`}>
            {internal ? "Nota interna" : "Mensagem"}
          </label>
          <textarea
            id={`message-${conversationId}`}
            ref={composer}
            value={draft}
            maxLength={4000}
            disabled={sending || (!own && !internal)}
            placeholder={
              internal
                ? "Deixe o contexto que a equipe precisa. Só vocês podem ver."
                : own
                  ? "Escreva sua mensagem…"
                  : "Assuma o atendimento para responder ao cliente."
            }
            onChange={(e) => updateDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.ctrlKey || e.metaKey) &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-bottom">
            {!internal && (
              <label
                className="attach-button"
                title="Anexar arquivo de até 10 MB"
              >
                <Paperclip size={18} />
                <span className="sr-only">Anexar arquivo</span>
                <input
                  type="file"
                  aria-label="Anexar arquivo"
                  disabled={sending || !own}
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,audio/mpeg,audio/ogg,audio/wav,video/mp4"
                  onChange={(e) => {
                    void attach(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            <small>
              {internal
                ? "Visível apenas para sua equipe"
                : "Ctrl + Enter para enviar"}
              {draft.length > 3500 && ` · ${draft.length}/4000`}
            </small>
            <button
              className="button"
              disabled={
                sending ||
                (!draft.trim() && (internal || !attachment)) ||
                (!own && !internal)
              }
            >
              {sending ? (
                <Spinner />
              ) : internal ? (
                <StickyNote size={16} />
              ) : (
                <Send size={16} />
              )}
              {internal ? "Adicionar nota" : "Enviar mensagem"}
            </button>
          </div>
        </form>
      )}
      {closing && (
        <Modal
          title="Finalizar atendimento"
          onClose={() => !saving && setClosing(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void change({ status: "closed", reason });
            }}
          >
            <label className="field">
              Motivo da finalização
              <textarea
                aria-label="Motivo da finalização"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={3}
                maxLength={500}
                required
                placeholder="Ex.: dúvida resolvida e orientações enviadas"
              />
            </label>
            <ErrorMessage error={error} />
            <button className="button" disabled={saving}>
              {saving ? "Finalizando…" : "Confirmar finalização"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
