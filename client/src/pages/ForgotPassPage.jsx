import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { requestPasswordReset, resetPassword } from "../api/auth.js";

export default function ForgotPassPage() {
  const navigate = useNavigate();

  // 'request' = pedir o código por email; 'reset' = digitar código + nova senha.
  const [step, setStep] = useState("request");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  async function handleRequestSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await requestPasswordReset(identifier.trim());
      setInfo(data.message);
      setStep("reset");
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(identifier.trim(), code.trim(), newPassword);
      navigate("/login");
    } catch (err) {
      setError(err.details?.[0]?.message ?? err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20";
  const labelClass = "mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300";

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
          onSubmit={step === "request" ? handleRequestSubmit : handleResetSubmit}
          className="rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-200 transition-colors dark:bg-slate-900 dark:ring-slate-800"
        >
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">NaveSpeak</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Esqueci minha senha</p>
          </div>

          <div className="space-y-5">
            {step === "request" ? (
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
                <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                  Vamos enviar um código de 6 dígitos para o email cadastrado.
                </p>
              </div>
            ) : (
              <>
                {info && (
                  <p className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
                    {info}
                  </p>
                )}
                <div>
                  <label htmlFor="code" className={labelClass}>
                    Código recebido por email
                  </label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    minLength={6}
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                    placeholder="000000"
                    className={`${inputClass} text-center tracking-[0.5em]`}
                  />
                </div>

                <div>
                  <label htmlFor="newPassword" className={labelClass}>
                    Nova senha
                  </label>
                  <input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    placeholder="Mínimo 10 caracteres"
                    className={inputClass}
                  />
                  <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                    Mínimo 10 caracteres, com ao menos uma letra e um número.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setStep("request");
                    setError(null);
                    setInfo(null);
                  }}
                  className="text-sm font-medium text-blue-600 transition hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Errei o email/usuário, voltar
                </button>
              </>
            )}

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
              {submitting
                ? "Enviando..."
                : step === "request"
                  ? "Enviar código"
                  : "Redefinir senha"}
            </button>
          </div>

          <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
            <Link
              to="/login"
              className="font-semibold text-blue-600 transition hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
            >
              Voltar para o login
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
