import { useState } from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  MessagesSquare,
  ShieldCheck,
} from "lucide-react";
import { api, roleNames } from "./api";
import { Field, Form, Logo, field, Loading, ErrorMessage } from "./ui";
export function Auth() {
  const { pathname } = useLocation(),
    navigate = useNavigate(),
    queryClient = useQueryClient(),
    [params] = useSearchParams(),
    [show, setShow] = useState(false),
    [sent, setSent] = useState(false);
  const signup = pathname === "/criar-conta",
    forgot = pathname === "/recuperar",
    reset = pathname === "/redefinir",
    invite = pathname === "/convite";
  const token = params.get("token") ?? "";
  const invitation = useQuery({
    queryKey: ["invitation", token],
    queryFn: () =>
      api<{ company: string; email: string; role: string }>(
        `/auth/invitation?token=${encodeURIComponent(token)}`,
      ),
    enabled: invite,
    retry: false,
  });
  const capabilities = useQuery({
    queryKey: ["capabilities"],
    queryFn: () => api<{ passwordRecovery: boolean }>("/auth/capabilities"),
    enabled: forgot,
  });
  const title = signup
    ? "Seu próximo capítulo começa aqui."
    : forgot
      ? "Vamos recuperar seu acesso."
      : reset
        ? "Escolha uma nova senha."
        : invite
          ? "Sua equipe espera por você."
          : "Bom ter você por aqui.";
  const subtitle = signup
    ? "Crie o espaço da sua empresa. Depois, configure tudo no seu ritmo."
    : forgot
      ? "Informe o e-mail que você usa para entrar no Caju."
      : reset
        ? "Use uma senha exclusiva, com pelo menos 12 caracteres."
        : invite
          ? `Você foi convidado para ${invitation.data?.company ?? "uma empresa"} no Caju.`
          : "Entre para continuar de onde parou.";
  async function submit(data: FormData) {
    if (forgot) {
      await api("/auth/forgot", {
        method: "POST",
        body: { email: field(data, "email") },
      });
      setSent(true);
      return;
    }
    if (reset) {
      await api("/auth/reset", {
        method: "POST",
        body: { token, password: field(data, "password") },
      });
      setSent(true);
      return;
    }
    const endpoint = invite
      ? "/auth/accept-invitation"
      : signup
        ? "/auth/register"
        : "/auth/login";
    const body = invite
      ? { token, name: field(data, "name"), password: field(data, "password") }
      : signup
        ? {
            name: field(data, "name"),
            company: field(data, "company"),
            email: field(data, "email"),
            password: field(data, "password"),
          }
        : { email: field(data, "email"), password: field(data, "password") };
    await api(endpoint, { method: "POST", body });
    queryClient.clear();
    navigate("/", { replace: true });
  }
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Link to="/entrar" aria-label="Caju, início">
          <Logo large />
        </Link>
        <div className="auth-message">
          <h2>
            Atender bem.
            <br />
            Trabalhar leve.
          </h2>
          <p>Um lugar para sua equipe cuidar de cada conversa no WhatsApp.</p>
          <div className="brand-scene">
            <img
              src="/brand/caju.png"
              alt="Mascote do Caju com fone de atendimento"
            />
            <span className="scene-note">
              <MessagesSquare size={20} />
              Cada conversa importa.
            </span>
          </div>
        </div>
        <span className="auth-footer">
          Próximo de quem atende. De quem é atendido.
        </span>
      </aside>
      <main className="auth-main">
        <div className="mobile-brand">
          <Logo />
        </div>
        <div className="auth-switch">
          {signup ? "Já tem uma conta?" : "Primeira vez no Caju?"}{" "}
          <Link to={signup ? "/entrar" : "/criar-conta"}>
            {signup ? "Entrar" : "Criar sua conta"}
            <ArrowRight size={15} />
          </Link>
        </div>
        <section className="auth-form">
          <h1>{title}</h1>
          <p>{subtitle}</p>
          {invite && invitation.isPending ? (
            <Loading />
          ) : invite && invitation.error ? (
            <ErrorMessage error={invitation.error} />
          ) : sent ? (
            <div className="success-panel">
              <Check size={28} />
              <h3>
                {reset ? "Senha redefinida" : "Confira sua caixa de entrada"}
              </h3>
              <p>
                {reset
                  ? "Você já pode entrar com sua nova senha."
                  : "Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha. Confira também a pasta de spam."}
              </p>
              <Link to="/entrar" className="button">
                Voltar para entrar
              </Link>
            </div>
          ) : (
            <>
              {forgot &&
              capabilities.data &&
              !capabilities.data.passwordRecovery ? (
                <div className="notice warning">
                  A recuperação por e-mail ainda está sendo habilitada. Se você
                  está conectado em outro dispositivo, altere sua senha em Minha
                  conta.
                </div>
              ) : (
                <Form
                  key={pathname}
                  onSubmit={submit}
                  label={
                    forgot
                      ? "Enviar link de recuperação"
                      : reset
                        ? "Redefinir senha"
                        : invite
                          ? "Aceitar convite"
                          : signup
                            ? "Criar minha empresa"
                            : "Entrar no Caju"
                  }
                  className="auth-fields"
                >
                  {(signup || invite) && (
                    <Field label="Seu nome">
                      <input
                        name="name"
                        autoComplete="name"
                        required
                        minLength={2}
                        maxLength={100}
                        placeholder="Como podemos chamar você?"
                      />
                    </Field>
                  )}
                  {signup && (
                    <Field label="Nome da empresa">
                      <input
                        name="company"
                        autoComplete="organization"
                        required
                        minLength={2}
                        maxLength={100}
                        placeholder="O nome que sua equipe conhece"
                      />
                    </Field>
                  )}
                  {!reset && (
                    <Field label="E-mail">
                      <input
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                        placeholder="voce@empresa.com.br"
                        defaultValue={invitation.data?.email}
                        readOnly={invite}
                      />
                    </Field>
                  )}
                  {!forgot && (
                    <Field
                      label={reset ? "Nova senha" : "Senha"}
                      hint={
                        signup || reset
                          ? "Pelo menos 12 caracteres. Uma frase também funciona."
                          : invite
                            ? "Se já possui uma conta no Caju, use sua senha atual."
                            : undefined
                      }
                    >
                      <span className="password-field">
                        <input
                          name="password"
                          type={show ? "text" : "password"}
                          autoComplete={
                            signup || reset
                              ? "new-password"
                              : "current-password"
                          }
                          required
                          minLength={signup || reset || invite ? 12 : 1}
                          maxLength={128}
                          placeholder={
                            signup ? "Crie uma senha segura" : "Sua senha"
                          }
                        />
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                          onClick={() => setShow(!show)}
                        >
                          {show ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </span>
                    </Field>
                  )}
                  {!signup && !forgot && !reset && !invite && (
                    <Link className="forgot-link" to="/recuperar">
                      Esqueci minha senha
                    </Link>
                  )}
                  {invite && invitation.data && (
                    <p className="muted">
                      Seu perfil será{" "}
                      {roleNames[invitation.data.role].toLowerCase()}.
                    </p>
                  )}
                </Form>
              )}
            </>
          )}
          {(forgot || reset) && !sent && (
            <Link className="back-link auth-back" to="/entrar">
              Voltar para entrar
            </Link>
          )}
          <div className="auth-security">
            <ShieldCheck size={16} />
            <span>Seu espaço é exclusivo da sua empresa.</span>
          </div>
        </section>
        <footer className="auth-bottom">Caju · Atendimento com cuidado</footer>
      </main>
    </div>
  );
}
