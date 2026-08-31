import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { getAuthConfig } from "../api/auth.js";
import { checkInvite } from "../api/invites.js";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Pré-preenchido por /invite/:code (ver InviteRedirectPage.jsx) ou por um
  // link colado direto como /register?invite=CODE - continua editável, caso
  // o usuário tenha um convite diferente à mão.
  const [inviteCode, setInviteCode] = useState(searchParams.get("invite") ?? "");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains("dark"));

  // null = carregando; depois disso, true/false. Enquanto carrega, o campo
  // de convite fica escondido para não "piscar" aparecendo e sumindo caso
  // INVITE_ONLY=false (ver GET /auth/config em auth.routes.js).
  const [inviteOnly, setInviteOnly] = useState(null);
  // Validação do CÓDIGO em si (não bloqueia o formulário sozinha - o
  // servidor sempre revalida no /register - só dá feedback antecipado):
  // null = não checado ainda/campo vazio, 'checking', 'valid', 'invalid'.
  const [inviteStatus, setInviteStatus] = useState(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    let cancelled = false;
    getAuthConfig()
      .then((data) => {
        if (!cancelled) setInviteOnly(Boolean(data.inviteOnly));
      })
      .catch(() => {
        if (!cancelled) setInviteOnly(false); // fail-open na UI - o servidor é quem decide de verdade
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Confere o código digitado/vindo da URL contra GET /invites/check/:code
  // (rota pública) - só feedback visual antecipado, debounced pra não
  // disparar uma requisição a cada tecla.
  useEffect(() => {
    const code = inviteCode.trim();
    if (!code) {
      setInviteStatus(null);
      return undefined;
    }
    setInviteStatus("checking");
    const timer = setTimeout(() => {
      checkInvite(code)
        .then((data) => setInviteStatus(data.valid ? "valid" : "invalid"))
        .catch(() => setInviteStatus("invalid"));
    }, 400);
    return () => clearTimeout(timer);
  }, [inviteCode]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(username, email, password, inviteOnly ? inviteCode.trim() : "");
      navigate("/rooms");
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20";
  const labelClass = "mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300";

  const canSubmit = inviteOnly !== null && (!inviteOnly || inviteStatus === "valid");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-md">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setDarkMode((prev) => !prev)}
            className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:ring-offset-slate-950"
          >
            {darkMode ? "☀️ Tema claro" : "🌙 Tema escuro"}
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-200 transition-colors dark:bg-slate-900 dark:ring-slate-800"
        >
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">NaveSpeak</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Criar conta</p>
          </div>

          <div className="space-y-5">
            {/* Convite - só aparece quando o cadastro exige um (INVITE_ONLY=true
                no servidor). Enquanto inviteOnly ainda não carregou (null),
                fica escondido para não piscar. */}
            {inviteOnly && (
              <div>
                <label htmlFor="inviteCode" className={labelClass}>
                  Código de convite
                </label>
                <input
                  id="inviteCode"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                  placeholder="Cole o código ou o link de convite"
                  className={inputClass}
                />
                {inviteStatus === "checking" && (
                  <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">Verificando convite...</p>
                )}
                {inviteStatus === "valid" && (
                  <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">Convite válido.</p>
                )}
                {inviteStatus === "invalid" && (
                  <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                    Convite inválido, expirado ou sem usos restantes.
                  </p>
                )}
                {!inviteStatus && (
                  <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                    Cadastro neste servidor exige um convite.
                  </p>
                )}
              </div>
            )}

            <div>
              <label htmlFor="username" className={labelClass}>
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                minLength={3}
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="Como você quer ser chamado"
                className={inputClass}
              />
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                Pode se repetir entre contas - um identificador único (usuario#12345) é gerado pra você.
              </p>
            </div>

            <div>
              <label htmlFor="email" className={labelClass}>
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="voce@exemplo.com"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="password" className={labelClass}>
                Senha
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Mínimo 10 caracteres"
                className={inputClass}
              />
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                Mínimo 10 caracteres, com ao menos uma letra e um número.
              </p>
            </div>

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !canSubmit}
              className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
            >
              {submitting ? "Criando..." : "Criar conta"}
            </button>
          </div>

          <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
            Já tem conta?{" "}
            <Link
              to="/login"
              className="font-semibold text-blue-600 transition hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
            >
              Entrar
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
