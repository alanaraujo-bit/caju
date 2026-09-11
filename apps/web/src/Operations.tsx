import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Copy,
  MessageSquareText,
  Plus,
  Search,
  ContactRound,
  CalendarClock,
  Undo2,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import {
  api,
  type Contact,
  type Tag,
  type QuickReply,
  type Department,
  type Followup,
} from "./api";
import { useSession, can } from "./App";
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
function useDebounce(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 200);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}
export function Contacts() {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [tag, setTag] = useState(""),
    q = useDebounce(search);
  const contacts = useQuery({
    queryKey: ["contacts", q, page, tag],
    queryFn: () =>
      api<{ items: Contact[]; total: number; page: number }>(
        `/contacts?q=${encodeURIComponent(q)}&page=${page}&tag=${tag}`,
      ),
  });
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: () => api<Tag[]>("/tags"),
  });
  const { user } = useSession();
  return (
    <div className="page">
      <PageTitle
        title="Contatos"
        description="Conheça quem está do outro lado da conversa."
        action={
          can(user, "contacts:write") && (
            <Link className="button" to="/contatos/novo">
              <Plus size={18} />
              Novo contato
            </Link>
          )
        }
      />
      <div className="toolbar">
        <label className="search-input">
          <Search size={18} />
          <input
            data-search
            aria-label="Buscar contatos"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nome, telefone ou e-mail"
          />
          <kbd>Ctrl K</kbd>
        </label>
        <select
          aria-label="Filtrar por etiqueta"
          value={tag}
          onChange={(e) => {
            setTag(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todas as etiquetas</option>
          {tags.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {contacts.error ? (
        <Retry error={contacts.error} retry={() => contacts.refetch()} />
      ) : contacts.isPending ? (
        <Loading />
      ) : !contacts.data.items.length ? (
        <Empty
          icon={<ContactRound size={36} />}
          title={
            q || tag
              ? "Nenhum contato encontrado"
              : "Toda boa conversa começa com uma pessoa."
          }
          action={
            q || tag ? (
              <button
                className="button secondary"
                onClick={() => {
                  setSearch("");
                  setTag("");
                }}
              >
                Limpar busca
              </button>
            ) : (
              <Link className="button" to="/contatos/novo">
                <Plus size={18} />
                Adicionar primeiro contato
              </Link>
            )
          }
        >
          {q || tag
            ? "Tente outro nome, telefone ou filtro."
            : "Cadastre seu primeiro contato para reunir informações e acompanhar cada retorno."}
        </Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contato</th>
                  <th>Telefone</th>
                  <th>Etiquetas</th>
                  <th>Última atualização</th>
                  <th>
                    <span className="sr-only">Abrir contato</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {contacts.data.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link className="person-cell" to={`/contatos/${c.id}`}>
                        <Avatar name={c.name} />
                        <span>
                          <strong>{c.name}</strong>
                          <small>{c.email || "Sem e-mail cadastrado"}</small>
                        </span>
                      </Link>
                    </td>
                    <td className="tabular">{c.phone}</td>
                    <td>
                      <div className="tag-list">
                        {c.tags.length ? (
                          c.tags.map((t) => (
                            <Badge key={t.id} color={t.color}>
                              {t.name}
                            </Badge>
                          ))
                        ) : (
                          <span className="muted">Sem etiquetas</span>
                        )}
                      </div>
                    </td>
                    <td className="muted nowrap">{date(c.updated_at)}</td>
                    <td>
                      <Link
                        className="icon-button"
                        to={`/contatos/${c.id}`}
                        aria-label={`Abrir ${c.name}`}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              {contacts.data.total}{" "}
              {contacts.data.total === 1 ? "contato" : "contatos"}
            </span>
            <div>
              <button
                className="icon-button"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Página anterior"
              >
                <ArrowLeft size={18} />
              </button>
              <span>Página {page}</span>
              <button
                className="icon-button"
                disabled={page * 30 >= contacts.data.total}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Próxima página"
              >
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
export function ContactEditor() {
  const { id } = useParams(),
    navigate = useNavigate(),
    client = useQueryClient(),
    [returnForm, setReturnForm] = useState(false);
  const contact = useQuery({
    queryKey: ["contact", id],
    queryFn: () => api<Contact>(`/contacts/${id}`),
    enabled: !!id,
  });
  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: () => api<Tag[]>("/tags"),
  });
  if ((id && contact.isPending) || tags.isPending) return <Loading />;
  if (contact.error || tags.error)
    return (
      <Retry
        error={contact.error ?? tags.error}
        retry={() => {
          contact.refetch();
          tags.refetch();
        }}
      />
    );
  const c = contact.data;
  return (
    <div className="page">
      <PageTitle
        title={id ? (c?.name ?? "Contato") : "Novo contato"}
        description={
          id
            ? "O contexto que ajuda sua equipe a atender melhor."
            : "Comece pelo essencial. Você pode completar depois."
        }
        back="/contatos"
        action={
          id && (
            <button
              className="button secondary"
              onClick={() => setReturnForm(!returnForm)}
            >
              <CalendarClock size={18} />
              {returnForm ? "Fechar retorno" : "Marcar retorno"}
            </button>
          )
        }
      />
      <div className="editor-grid">
        <section className="form-section">
          <Form
            key={id ?? "new"}
            label={id ? "Salvar contato" : "Adicionar contato"}
            onSubmit={async (data) => {
              const result = await api<{ id: string }>(
                id ? `/contacts/${id}` : "/contacts",
                {
                  method: id ? "PATCH" : "POST",
                  body: {
                    name: field(data, "name"),
                    phone: field(data, "phone").replace(/[ ()-]/g, ""),
                    email: field(data, "email"),
                    notes: field(data, "notes"),
                    tagIds: data.getAll("tagIds"),
                  },
                },
              );
              await client.invalidateQueries({ queryKey: ["contacts"] });
              await client.invalidateQueries({ queryKey: ["workspace"] });
              await client.invalidateQueries({ queryKey: ["contact", id] });
              if (!id) navigate(`/contatos/${result.id}`, { replace: true });
            }}
          >
            <h2>Informações do contato</h2>
            <Field label="Nome">
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={c?.name}
                placeholder="Nome da pessoa ou empresa"
              />
            </Field>
            <div className="form-grid">
              <Field label="WhatsApp" hint="Inclua o código do país e o DDD.">
                <input
                  name="phone"
                  type="tel"
                  required
                  defaultValue={c?.phone}
                  placeholder="+55 11 99999-9999"
                />
              </Field>
              <Field label="E-mail (opcional)">
                <input
                  name="email"
                  type="email"
                  maxLength={254}
                  defaultValue={c?.email}
                  placeholder="contato@empresa.com.br"
                />
              </Field>
            </div>
            <Field
              label="Observações internas"
              hint="Visíveis apenas para sua equipe. Não são enviadas ao contato."
            >
              <textarea
                name="notes"
                rows={5}
                maxLength={5000}
                defaultValue={c?.notes}
                placeholder="O que sua equipe precisa saber para atender bem?"
              />
            </Field>
            <div className="field">
              <span>Etiquetas</span>
              {tags.data?.length ? (
                <div className="check-tags">
                  {tags.data.map((t) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        name="tagIds"
                        value={t.id}
                        defaultChecked={c?.tag_ids?.includes(t.id)}
                      />
                      <Badge color={t.color}>{t.name}</Badge>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="muted">Sua empresa ainda não criou etiquetas.</p>
              )}
            </div>
          </Form>
        </section>
        <aside className="context-column">
          {returnForm && id ? (
            <section className="context-section">
              <h2>Marcar um retorno</h2>
              <p>
                Um lembrete para você. Nenhuma mensagem será enviada
                automaticamente.
              </p>
              <Form
                label="Salvar retorno"
                onSubmit={async (data) => {
                  await api("/followups", {
                    method: "POST",
                    body: {
                      contactId: id,
                      note: field(data, "note"),
                      dueAt: new Date(field(data, "dueAt")).toISOString(),
                    },
                  });
                  await client.invalidateQueries({ queryKey: ["followups"] });
                  setReturnForm(false);
                  navigate("/retornos");
                }}
              >
                <Field label="Quando retornar">
                  <input name="dueAt" type="datetime-local" required />
                </Field>
                <Field label="O que você precisa fazer?">
                  <textarea
                    name="note"
                    required
                    maxLength={1000}
                    rows={3}
                    placeholder="Ex.: confirmar se recebeu o orçamento"
                  />
                </Field>
              </Form>
            </section>
          ) : (
            <section className="context-section">
              <ContactRound size={25} />
              <h2>Contexto sempre por perto.</h2>
              <p>
                Use observações e etiquetas para que toda a equipe conheça este
                contato.
              </p>
              {c && (
                <dl className="detail-list">
                  <dt>Cadastrado em</dt>
                  <dd>{date(c.created_at)}</dd>
                  <dt>Atualizado em</dt>
                  <dd>{date(c.updated_at)}</dd>
                </dl>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
export function QuickReplies() {
  const replies = useQuery({
      queryKey: ["replies"],
      queryFn: () => api<QuickReply[]>("/quick-replies"),
    }),
    { user } = useSession(),
    [search, setSearch] = useState(""),
    [copied, setCopied] = useState(""),
    [error, setError] = useState<unknown>();
  const items = replies.data?.filter((r) =>
    `${r.title} ${r.shortcut} ${r.body}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="page">
      <PageTitle
        title="Respostas rápidas"
        description="As palavras certas, sem começar do zero."
        action={
          can(user, "replies:manage") && (
            <Link className="button" to="/respostas/nova">
              <Plus size={18} />
              Nova resposta
            </Link>
          )
        }
      />
      <div className="toolbar">
        <label className="search-input">
          <Search size={18} />
          <input
            aria-label="Buscar respostas"
            placeholder="Buscar por título, atalho ou mensagem"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <ErrorMessage error={error} />
      {replies.isPending ? (
        <Loading />
      ) : replies.error ? (
        <Retry error={replies.error} retry={() => replies.refetch()} />
      ) : !items?.length ? (
        <Empty
          icon={<MessageSquareText size={35} />}
          title={
            search
              ? "Nenhuma resposta encontrada"
              : "Algumas respostas merecem ficar por perto."
          }
          action={
            can(user, "replies:manage") && (
              <Link className="button" to="/respostas/nova">
                Criar resposta rápida
              </Link>
            )
          }
        >
          {search
            ? "Tente buscar por outra palavra."
            : "Horários, formas de pagamento e orientações. Prepare as mensagens que sua equipe usa todos os dias."}
        </Empty>
      ) : (
        <div className="reply-list">
          {items.map((r) => (
            <article key={r.id}>
              <div className="reply-top">
                <div>
                  <h2>
                    {can(user, "replies:manage") ? (
                      <Link to={`/respostas/${r.id}`}>{r.title}</Link>
                    ) : (
                      r.title
                    )}
                  </h2>
                  <span className="muted">
                    {r.department_name ?? "Toda a empresa"}
                  </span>
                </div>
                <code>/{r.shortcut}</code>
              </div>
              <p>{r.body}</p>
              <div className="reply-actions">
                {can(user, "replies:manage") && (
                  <Link to={`/respostas/${r.id}`}>Editar resposta</Link>
                )}
                <button
                  className="button secondary small"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(r.body);
                      setCopied(r.id);
                      setError(undefined);
                    } catch {
                      setError(
                        new Error(
                          "Não foi possível copiar. Selecione a mensagem e copie pelo teclado.",
                        ),
                      );
                    }
                  }}
                >
                  {copied === r.id ? <Check size={16} /> : <Copy size={16} />}{" "}
                  {copied === r.id ? "Copiado" : "Copiar mensagem"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
export function ReplyEditor() {
  const { id } = useParams(),
    client = useQueryClient(),
    navigate = useNavigate(),
    [remove, setRemove] = useState(false),
    { user } = useSession();
  const replies = useQuery({
    queryKey: ["replies"],
    queryFn: () => api<QuickReply[]>("/quick-replies"),
  });
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api<Department[]>("/departments"),
  });
  if (!can(user, "replies:manage"))
    return (
      <Empty icon={<MessageSquareText />} title="Acesso restrito">
        Peça a um administrador para alterar a biblioteca de respostas.
      </Empty>
    );
  if (replies.isPending || departments.isPending) return <Loading />;
  if (replies.error || departments.error)
    return (
      <Retry
        error={replies.error ?? departments.error}
        retry={() => {
          replies.refetch();
          departments.refetch();
        }}
      />
    );
  const r = replies.data?.find((item) => item.id === id);
  if (id && !r)
    return (
      <Empty icon={<Search />} title="Resposta não encontrada">
        Ela pode ter sido removida.
      </Empty>
    );
  return (
    <div className="page">
      <PageTitle
        title={id ? "Editar resposta" : "Nova resposta rápida"}
        description="Escreva como sua equipe fala com os clientes."
        back="/respostas"
        action={
          id && (
            <button
              className="button secondary"
              onClick={() => setRemove(true)}
            >
              <Trash2 size={17} />
              Excluir resposta
            </button>
          )
        }
      />
      <section className="form-section narrow">
        <Form
          label="Salvar resposta"
          onSubmit={async (data) => {
            await api(id ? `/quick-replies/${id}` : "/quick-replies", {
              method: id ? "PATCH" : "POST",
              body: {
                title: field(data, "title"),
                shortcut: field(data, "shortcut"),
                body: field(data, "body"),
                departmentId: field(data, "departmentId") || null,
              },
            });
            await client.invalidateQueries({ queryKey: ["replies"] });
            navigate("/respostas");
          }}
        >
          <Field label="Título">
            <input
              name="title"
              required
              maxLength={100}
              defaultValue={r?.title}
              placeholder="Ex.: Horário de atendimento"
            />
          </Field>
          <div className="form-grid">
            <Field
              label="Atalho"
              hint="Letras minúsculas, números e hífens. Sem espaços."
            >
              <div className="prefixed-input">
                <span>/</span>
                <input
                  name="shortcut"
                  required
                  pattern="[a-z0-9\-]{2,30}"
                  defaultValue={r?.shortcut}
                  placeholder="horarios"
                />
              </div>
            </Field>
            <Field label="Disponível para">
              <select name="departmentId" defaultValue={r?.department_id ?? ""}>
                <option value="">Toda a empresa</option>
                {departments.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Mensagem">
            <textarea
              name="body"
              required
              rows={8}
              maxLength={4000}
              defaultValue={r?.body}
              placeholder="Digite a resposta que sua equipe poderá reutilizar."
            />
          </Field>
        </Form>
      </section>
      {remove && (
        <Confirm
          danger
          title="Excluir esta resposta?"
          description="Ela deixará de aparecer na biblioteca da equipe. Esta exclusão não pode ser desfeita."
          label="Excluir resposta"
          onClose={() => setRemove(false)}
          onConfirm={async () => {
            await api(`/quick-replies/${id}`, { method: "DELETE" });
            await client.invalidateQueries({ queryKey: ["replies"] });
            navigate("/respostas");
          }}
        />
      )}
    </div>
  );
}
export function Followups() {
  const [filter, setFilter] = useState("hoje"),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(""),
    client = useQueryClient();
  const returns = useQuery({
    queryKey: ["followups"],
    queryFn: () => api<Followup[]>("/followups"),
    refetchInterval: 30000,
  });
  const now = new Date(),
    end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const group = (f: Followup) =>
    f.completed_at
      ? "concluidos"
      : new Date(f.due_at) < now
        ? "atrasados"
        : new Date(f.due_at) <= end
          ? "hoje"
          : "proximos";
  const tabs = [
    ["atrasados", "Atrasados"],
    ["hoje", "Hoje"],
    ["proximos", "Próximos"],
    ["concluidos", "Concluídos"],
  ];
  const items = returns.data?.filter((f) => group(f) === filter);
  return (
    <div className="page">
      <PageTitle
        title="Seus retornos"
        description="Lembretes para continuar uma conversa no momento certo."
        action={
          <Link className="button secondary" to="/contatos">
            <Plus size={17} />
            Marcar em um contato
          </Link>
        }
      />
      <div className="tabs" role="tablist" aria-label="Período dos retornos">
        {tabs.map(([key, label]) => (
          <button
            role="tab"
            aria-selected={filter === key}
            key={key}
            onClick={() => setFilter(key)}
          >
            {label}
            <span>
              {returns.data?.filter((f) => group(f) === key).length ?? 0}
            </span>
          </button>
        ))}
      </div>
      <ErrorMessage error={error} />
      {returns.isPending ? (
        <Loading />
      ) : returns.error ? (
        <Retry error={returns.error} retry={() => returns.refetch()} />
      ) : !items?.length ? (
        <Empty
          icon={<CalendarClock size={35} />}
          title={
            filter === "atrasados"
              ? "Nenhum retorno atrasado."
              : filter === "concluidos"
                ? "Seus retornos concluídos ficarão aqui."
                : filter === "hoje"
                  ? "Seu dia está em dia."
                  : "Nada marcado para os próximos dias."
          }
          action={
            <Link className="button secondary" to="/contatos">
              Ver contatos
              <ArrowRight size={16} />
            </Link>
          }
        >
          Abra um contato e escolha “Marcar retorno”. O lembrete fica aqui e não
          envia mensagens automaticamente.
        </Empty>
      ) : (
        <div className="followup-list">
          {items.map((f) => (
            <article key={f.id}>
              <span
                className={`return-marker ${filter === "atrasados" ? "late" : ""}`}
              >
                <Clock3 size={20} />
              </span>
              <div>
                <Link to={`/contatos/${f.contact_id}`}>
                  <h2>{f.contact_name}</h2>
                </Link>
                <p>{f.note}</p>
                <time dateTime={f.due_at}>{date(f.due_at)}</time>
              </div>
              <button
                disabled={pending === f.id}
                className="button secondary small"
                onClick={async () => {
                  setPending(f.id);
                  setError(undefined);
                  try {
                    await api(`/followups/${f.id}`, {
                      method: "PATCH",
                      body: { completed: !f.completed_at },
                    });
                    await client.invalidateQueries({ queryKey: ["followups"] });
                  } catch (e) {
                    setError(e);
                  } finally {
                    setPending("");
                  }
                }}
              >
                {f.completed_at ? <Undo2 size={17} /> : <Check size={17} />}{" "}
                {f.completed_at ? "Reabrir" : "Concluir"}
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
