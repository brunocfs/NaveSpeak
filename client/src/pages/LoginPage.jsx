import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

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

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

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
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              NaveSpeak
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Entrar
            </p>
          </div>

          <div className="space-y-5">
            <div>
              <label
                htmlFor="identifier"
                className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
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
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
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
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-400/20"
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
          </p>
        </form>
      </div>
    </div>
  );
}
