import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CheckCheck,
  Clock3,
  Inbox as InboxIcon,
  MessageCircle,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { api, type User } from "./api";
import { Avatar, Empty, ErrorMessage, Loading, PageTitle, Retry } from "./ui";
import { useSession, can } from "./App";

type Conversation = {
  id: string;
  protocol: string;
  status: string;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string;
  last_message_from_me: boolean;
  contact_name: string;
  contact_phone: string;
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
const statusLabels: Record<string, string> = {
  all: "Todos",
  waiting: "Aguardando",
  open: "Em atendimento",
  closed: "Finalizados",
  followup: "Retorno",
};
const mediaLabels: Record<string, string> = {
  audio: "Áudio",
  image: "Imagem",
  video: "Vídeo",
  sticker: "Figurinha",
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
  const now = new Date();
  const day = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((day(now) - day(d)) / 86_400_000);
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
      api<{ items: Conversation[] }>(
        `/inbox?q=${encodeURIComponent(q)}&status=${status}`,
      ),
    refetchInterval: 2500,
  });
  const items = list.data?.items ?? [];
  // No desktop a primeira conversa abre sozinha; no celular só a que a pessoa tocou, senão a lista fica inacessível.
  const active =
    items.find((item) => item.id === selected) ??
    (mobile ? undefined : items[0]);
  const filtering = q.trim() !== "" || status !== "all";
  if (list.isPending) return <Loading />;
  if (list.error)
    return <Retry error={list.error} retry={() => list.refetch()} />;
  return (
    <div className="page inbox-page">
      <PageTitle
        title="Atendimento"
        description="Acompanhe e organize as conversas que chegam pelo WhatsApp."
      />
      <div className="inbox-toolbar">
        <label className="search-input">
          <Search size={17} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, telefone ou protocolo"
            aria-label="Buscar atendimentos"
          />
        </label>
        <div
          className="inbox-filters"
          role="group"
          aria-label="Filtrar atendimentos por status"
        >
          {Object.entries(statusLabels).map(([key, label]) => (
            <button
              key={key}
              className={status === key ? "active" : ""}
              onClick={() => setStatus(key)}
              aria-pressed={status === key}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
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
        <div className={`inbox-layout ${active ? "is-reading" : ""}`}>
          <section className="inbox-list" aria-label="Lista de atendimentos">
            <div className="inbox-list-heading">
              <strong>
                {items.length}{" "}
                {items.length === 1 ? "atendimento" : "atendimentos"}
              </strong>
              <span>Atualização automática</span>
            </div>
            {items.map((item) => (
              <button
                key={item.id}
                className={`inbox-row ${active?.id === item.id ? "selected" : ""}`}
                aria-current={active?.id === item.id ? "true" : undefined}
                onClick={() => setSelected(item.id)}
              >
                <Avatar name={item.contact_name} />
                <span className="inbox-row-copy">
                  <strong>{item.contact_name}</strong>
                  <small>
                    {item.last_message_from_me && "Você: "}
                    {item.last_message_preview || "Sem mensagem"}
                  </small>
                  <em>{item.department_name || statusLabels[item.status]}</em>
                </span>
                <span className="inbox-row-meta">
                  <time dateTime={item.last_message_at ?? undefined}>
                    {rowTime(item.last_message_at)}
                  </time>
                  {item.unread_count > 0 && (
                    <b>
                      {item.unread_count > 99 ? "99+" : item.unread_count}
                      <span className="sr-only"> não lidas</span>
                    </b>
                  )}
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
  // Abre no fim da conversa; depois só acompanha se a pessoa já estava perto do fim (não puxa quem está lendo o histórico).
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
  if (details.isPending)
    return (
      <section className="inbox-conversation">
        <Loading />
      </section>
    );
  if (details.error)
    return (
      <section className="inbox-conversation">
        <Retry error={details.error} retry={() => details.refetch()} />
      </section>
    );
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
          aria-label="Voltar para atendimentos"
        >
          <X size={19} />
        </button>
        <Avatar name={conversation.contact_name} />
        <div>
          <strong>{conversation.contact_name}</strong>
          <small>
            {conversation.contact_phone} · {conversation.protocol}
          </small>
        </div>
        <span className={`conversation-status status-${conversation.status}`}>
          {statusLabels[conversation.status]}
        </span>
      </header>
      <div className="message-stream" ref={stream} aria-live="polite">
        {messages.length === 0 ? (
          <Empty icon={<MessageCircle />} title="Nenhuma mensagem ainda">
            As mensagens novas desta conversa aparecerão aqui.
          </Empty>
        ) : (
          messages.map((message, index) => {
            const sent = new Date(message.sent_at),
              previous = messages[index - 1];
            return (
              <Fragment key={message.id}>
                {(!previous ||
                  dayKey(new Date(previous.sent_at)) !== dayKey(sent)) && (
                  <div className="message-day" role="separator">
                    <span>{dayLabel(sent)}</span>
                  </div>
                )}
                <article
                  className={`message-bubble ${message.direction === "outbound" ? "outbound" : "inbound"}`}
                >
                  <div>
                    {message.body || (
                      <span className="media-placeholder">
                        <Archive size={15} />
                        {message.media_name ||
                          mediaLabels[message.kind] ||
                          "Arquivo"}
                      </span>
                    )}
                  </div>
                  <footer>
                    {message.sender_name &&
                      message.direction !== "outbound" &&
                      `${message.sender_name} · `}
                    {time(message.sent_at)}{" "}
                    {message.direction === "outbound" && (
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
      <ErrorMessage error={error} />
      <footer className="conversation-footer">
        <span>
          <Clock3 size={15} /> Mensagens sincronizadas automaticamente
        </span>
        {canManage && (
          <select
            aria-label="Alterar status do atendimento"
            value={conversation.status}
            disabled={saving}
            onChange={(e) => changeStatus(e.target.value)}
          >
            <option value="waiting">Aguardando</option>
            <option value="open">Em atendimento</option>
            <option value="followup">Retorno</option>
            <option value="closed">Finalizado</option>
          </select>
        )}
      </footer>
    </section>
  );
}
