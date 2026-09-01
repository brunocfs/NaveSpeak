import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { getAuthConfig } from "../api/auth.js";
import logo from "../assets/nvspk.svg";
import logoDark from "../assets/nvspk-dark.svg";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    return document.documentElement.classList.contains("dark");
  });

  // null enquanto carrega - some o selo de "teste fechado" na hora certa se
  // INVITE_ONLY estiver desligado no servidor (mesmo padrão de
  // RegisterPage.jsx, reusando GET /auth/config).
  const [inviteOnly, setInviteOnly] = useState(null);

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

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(identifier, password);
      navigate("/rooms");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20";
  const labelClass = "mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300";

  return (
    <div className="flex min-h-screen w-full flex-col bg-white text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100 lg:flex-row">
      {/* Painel de apresentação - fica sempre em tema escuro de propósito
          (uma "janela" fixa da nave), independente do tema claro/escuro que
          o usuário escolher pro formulário ao lado. Some em telas pequenas
          (lg:flex) - o cabeçalho compacto abaixo assume a apresentação ali. */}
      <aside className="login-panel relative hidden w-full shrink-0 flex-col justify-between overflow-hidden bg-[#070b12] px-12 py-14 text-slate-100 lg:flex lg:w-[46%] xl:w-[42%] xl:px-16">
        <img src={logoDark} alt="" className="relative h-14 w-14" />

        <div className="relative max-w-md">
          <div className="mb-6 flex items-center gap-2.5 font-signal text-[11px] font-medium uppercase tracking-[0.2em] text-teal-300/90">
            <span className="login-ping-dot" aria-hidden="true" />
            Sinal ativo
            <span className="login-wave" aria-hidden="true">
              <span className="login-wave-bar" />
              <span className="login-wave-bar" />
              <span className="login-wave-bar" />
              <span className="login-wave-bar" />
              <span className="login-wave-bar" />
            </span>
          </div>

          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight text-white xl:text-[2.75rem]">
            Sua tripulação,
            <br />
            no mesmo canal.
          </h1>

          <p className="mt-5 text-[15px] leading-relaxed text-slate-400">
            NaveSpeak junta voz, vídeo, texto e presença num só lugar. Crie
            salas, organize canais e chame a galera pra call sem sair do
            navegador.
          </p>

          {inviteOnly && (
            <div className="mt-8 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-5 py-4">
              <p className="flex items-center gap-2 font-signal text-[11px] font-semibold uppercase tracking-[0.15em] text-amber-300">
                <span aria-hidden="true">🔒</span> Teste fechado
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
                O acesso ainda é só por convite de quem já embarcou. Sem
                convite em mãos? Peça o seu a um tripulante.
              </p>
            </div>
          )}
        </div>

        <p className="relative font-signal text-[11px] uppercase tracking-[0.15em] text-slate-600">
          Status: {inviteOnly ? "recebendo só convidados" : "cadastro aberto"}
        </p>
      </aside>

      {/* Painel de formulário */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-md">
          {/* Cabeçalho compacto - só aparece em telas pequenas (lg:hidden),
              onde o painel de apresentação acima está escondido. */}
          <div className="mb-6 lg:hidden">
            <div className="flex items-center gap-3">
              <img
                src={darkMode ? logoDark : logo}
                alt=""
                className="h-11 w-11 shrink-0"
              />
              <div>
                <p className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                  NaveSpeak
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Voz, texto e presença pra sua tripulação.
                </p>
              </div>
            </div>
            {inviteOnly && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 font-signal text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-600 dark:text-amber-300">
                🔒 Teste fechado - só por convite
              </p>
            )}
          </div>

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
            <div className="mb-7">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                Entrar
              </h2>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                Acesse sua conta pra continuar.
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <label htmlFor="identifier" className={labelClass}>
                  Usuário#tag ou email
                </label>
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  placeholder="usuario#12345 ou email"
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
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Digite sua senha"
                  className={inputClass}
                />
              </div>

              {error && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-blue-500 dark:hover:bg-blue-400 dark:focus:ring-blue-400 dark:focus:ring-offset-slate-900"
              >
                {submitting ? "Entrando..." : "Entrar"}
              </button>
            </div>

            <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
              Não tem conta?{" "}
              <Link
                to="/register"
                className="font-semibold text-blue-600 transition hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
              >
                Criar conta
              </Link>
              {inviteOnly && (
                <span className="text-slate-400 dark:text-slate-500">
                  {" "}
                  (convite necessário)
                </span>
              )}
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
