import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCheck,
  ChevronDown,
  FileText,
  Inbox as InboxIcon,
  MessageCircle,
  Search,
  SearchX,
} from "lucide-react";
import { api, type User } from "./api";
import { Avatar, Empty, ErrorMessage, Loading, Retry } from "./ui";
import { useSession, can } from "./App";

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
};
type InboxResponse = { items: Conversation[]; counts: Record<string, number> };

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
const phoneLabel = (value: string | null) => {
  // +5511912345678 → +55 11 91234-5678; outros países ficam como vieram.
  const m = value?.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : value;
};

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
  const [status, setStatus] = useState("all"),
    [q, setQ] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const mobile = useIsMobile();
  const list = useQuery({
    queryKey: ["inbox", q, status],
    queryFn: () =>
      api<InboxResponse>(`/inbox?q=${encodeURIComponent(q)}&status=${status}`),
    refetchInterval: 2500,
  });
  const items = list.data?.items ?? [];
  const counts = list.data?.counts ?? {};
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  // No desktop a primeira conversa abre sozinha; no celular só a que a pessoa tocou, senão a lista fica inacessível.
  const active =
    items.find((item) => item.id === selected) ??
    (mobile ? undefined : items[0]);
  const filtering = q.trim() !== "" || status !== "all";
  const move = (offset: number) => {
    const index = items.findIndex((item) => item.id === active?.id);
    const next = items[Math.min(items.length - 1, Math.max(0, index + offset))];
    if (next) setSelected(next.id);
  };
  if (list.isPending) return <Loading />;
  if (list.error)
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
            placeholder="Buscar nome, telefone ou protocolo"
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
      {items.length === 0 ? (
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
                onClick={() => setSelected(item.id)}
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
  conversation,
  onBack,
}: {
  conversation: Conversation;
  onBack: () => void;
}) {
  const session = useSession(),
    queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null),
    [saving, setSaving] = useState(false);
  const stream = useRef<HTMLDivElement>(null),
    firstScroll = useRef(true);
  const details = useQuery({
    queryKey: ["inbox-conversation", conversation.id],
    queryFn: () =>
      api<{ conversation: Conversation; messages: Message[] }>(
        `/inbox/${conversation.id}/messages`,
      ),
    refetchInterval: 2000,
  });
  const messages = details.data?.messages ?? [];
  const lastId = messages.at(-1)?.id;
  // Marca como lido ao abrir e sempre que chegar mensagem nova enquanto a conversa está na tela.
  useEffect(() => {
    if (!lastId && details.isPending) return;
    api(`/inbox/${conversation.id}/read`, { method: "POST" })
      .then(() => queryClient.invalidateQueries({ queryKey: ["inbox"] }))
      .catch(() => {});
  }, [conversation.id, lastId, details.isPending, queryClient]);
  // Abre no fim da conversa; depois só acompanha se a pessoa já estava perto do fim.
  useEffect(() => {
    const el = stream.current;
    if (!el || !lastId) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (firstScroll.current || nearBottom)
      el.scrollTo({
        top: el.scrollHeight,
        behavior: firstScroll.current ? "auto" : "smooth",
      });
    firstScroll.current = false;
  }, [lastId]);
  const canManage = can(session.user as User, "inbox:manage");
  const changeStatus = async (status: string) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/inbox/${conversation.id}`, {
        method: "PATCH",
        body: { status },
      });
      await queryClient.invalidateQueries({ queryKey: ["inbox"] });
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
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
          <strong>{conversation.contact_name}</strong>
          <small>
            {conversation.is_group
              ? "Grupo"
              : (phoneLabel(conversation.contact_phone) ??
                "Número não informado")}
            <span aria-hidden="true"> · </span>
            <span className="protocol">{conversation.protocol}</span>
          </small>
        </div>
        {canManage ? (
          <label className={`status-select status-${conversation.status}`}>
            <span className="sr-only">Status do atendimento</span>
            <select
              value={conversation.status}
              disabled={saving}
              onChange={(e) => changeStatus(e.target.value)}
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
      <ErrorMessage error={error} />
      {details.isPending ? (
        <Loading />
      ) : details.error ? (
        <Retry error={details.error} retry={() => details.refetch()} />
      ) : (
        <div className="message-stream" ref={stream}>
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
                    className={`message-bubble ${outbound ? "outbound" : "inbound"}`}
                  >
                    {conversation.is_group &&
                      !outbound &&
                      message.sender_name && (
                        <strong className="message-sender">
                          {message.sender_name}
                        </strong>
                      )}
                    <p>
                      {message.body || (
                        <span className="media-placeholder">
                          <FileText size={15} />
                          {message.media_name ||
                            mediaLabels[message.kind] ||
                            "Arquivo"}
                        </span>
                      )}
                    </p>
                    <footer>
                      <time dateTime={message.sent_at}>
                        {time(message.sent_at)}
                      </time>
                      {outbound && (
                        <>
                          <CheckCheck size={13} />
                          <span className="sr-only">Enviada</span>
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
    </section>
  );
}
