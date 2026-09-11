import {
  useEffect,
  useRef,
  useState,
  useId,
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  LoaderCircle,
  X,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
export function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className={`brand ${large ? "brand-large" : ""}`}>
      <img src="/brand/caju.png" alt="" />
      <span>
        caju<span className="brand-period">.</span>
      </span>
    </span>
  );
}
export function Spinner() {
  return <LoaderCircle className="spin" size={18} aria-hidden="true" />;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <Spinner />
      <span>Carregando seu espaço…</span>
    </div>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <div className="notice error" role="alert">
      <AlertCircle size={18} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  ) : null;
}
export function Retry({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="load-error">
      <ErrorMessage error={error} />
      <button className="button secondary" onClick={retry}>
        Tentar novamente
      </button>
    </div>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">{icon}</span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function PageTitle({
  title,
  description,
  action,
  back,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  back?: string;
}) {
  return (
    <header className="page-heading">
      <div>
        {back && (
          <Link className="back-link" to={back}>
            <ArrowLeft size={16} />
            Voltar
          </Link>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const fieldId = useId();
  const labelControls = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (node) => {
      if (!isValidElement<Record<string, unknown>>(node)) return node;
      if (
        typeof node.type === "string" &&
        ["input", "select", "textarea"].includes(node.type)
      )
        return cloneElement(node, {
          "aria-labelledby": `${fieldId}-label`,
          "aria-describedby": hint ? `${fieldId}-hint` : undefined,
        });
      if (node.props.children)
        return cloneElement(node, {
          children: labelControls(node.props.children as ReactNode),
        });
      return node;
    });
  return (
    <label className="field">
      <span id={`${fieldId}-label`}>{label}</span>
      {labelControls(children)}
      {hint && <small id={`${fieldId}-hint`}>{hint}</small>}
    </label>
  );
}
export function Form({
  onSubmit,
  children,
  label = "Salvar alterações",
  className = "",
  onSaved,
}: {
  onSubmit: (data: FormData) => Promise<unknown>;
  children: ReactNode;
  label?: string;
  className?: string;
  onSaved?: () => void;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(),
    [saved, setSaved] = useState(false),
    [dirty, setDirty] = useState(false);
  const [leave, setLeave] = useState<string | null>(null),
    navigate = useNavigate();
  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const fn = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.button !== 0
      )
        return;
      const destination = new URL(anchor.href);
      if (
        destination.origin === location.origin &&
        destination.pathname !== location.pathname
      ) {
        e.preventDefault();
        e.stopPropagation();
        setLeave(destination.pathname + destination.search);
      }
    };
    document.addEventListener("click", fn, true);
    return () => document.removeEventListener("click", fn, true);
  }, [dirty]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    setSaved(false);
    try {
      await onSubmit(new FormData(e.currentTarget));
      setDirty(false);
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <form
        className={className}
        onSubmit={submit}
        onChange={() => {
          setSaved(false);
          setDirty(true);
        }}
      >
        <fieldset disabled={pending}>{children}</fieldset>
        <ErrorMessage error={error} />
        <div className="form-actions">
          <button className="button" type="submit" disabled={pending}>
            {pending ? <Spinner /> : saved ? <Check size={17} /> : null}
            {pending ? "Salvando…" : label}
          </button>
          {saved && (
            <span className="saved" role="status">
              Alterações salvas
            </span>
          )}
        </div>
      </form>
      {leave && (
        <Confirm
          title="Sair sem salvar?"
          description="Você tem alterações nesta página que ainda não foram salvas."
          label="Sair sem salvar"
          onClose={() => setLeave(null)}
          onConfirm={async () => {
            setDirty(false);
            navigate(leave);
          }}
        />
      )}
    </>
  );
}
export function Confirm({
  title,
  description,
  onConfirm,
  onClose,
  label = "Confirmar",
  danger = false,
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
  label?: string;
  danger?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
      aria-labelledby="confirm-title"
    >
      <h2 id="confirm-title">{title}</h2>
      <p>{description}</p>
      <ErrorMessage error={error} />
      <div className="form-actions">
        <button
          className="button secondary"
          disabled={pending}
          onClick={onClose}
          autoFocus
        >
          Cancelar
        </button>
        <button
          className={`button ${danger ? "danger" : ""}`}
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError(e);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending && <Spinner />}
          {label}
        </button>
      </div>
    </dialog>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm confirm-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Fechar janela"
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((n) => n[0])
        .join("")
        .toUpperCase()}
    </span>
  );
}
export function Badge({
  children,
  color = "slate",
}: {
  children: ReactNode;
  color?: string;
}) {
  return <span className={`badge tag-${color}`}>{children}</span>;
}
export function StepLink({
  to,
  title,
  description,
  done,
  number,
}: {
  to: string;
  title: string;
  description: string;
  done: boolean;
  number: number;
}) {
  return (
    <Link className={`setup-step ${done ? "done" : ""}`} to={to}>
      <span className="step-number">{done ? <Check size={18} /> : number}</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <span className="step-state">{done ? "Concluído" : "Configurar"}</span>
      <ChevronRight size={18} />
    </Link>
  );
}
export function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const id = setTimeout(onClose, 5000);
    return () => clearTimeout(id);
  }, [onClose]);
  return (
    <div className="toast" role="status">
      <Check size={18} />
      {message}
      <button
        className="icon-button"
        aria-label="Fechar aviso"
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
  );
}
export const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export const field = (data: FormData, key: string) =>
  String(data.get(key) ?? "");
