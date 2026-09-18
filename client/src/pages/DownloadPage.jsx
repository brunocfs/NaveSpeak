import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Monitor, Terminal } from "lucide-react";
import { isElectron } from "../api/media.js";
import { API_URL } from "../api/config.js";
import logo from "../assets/nvspk.svg";
import logoDark from "../assets/nvspk-dark.svg";

// Detecção só pra destacar a opção "recomendada" - quem clica no botão
// errado ainda baixa o instalador certo (o link já força ?os=, ver
// server/src/index.js /download), isso aqui é só atalho visual.
function detectOS() {
  const ua = navigator.userAgent;
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "linux";
  if (/Windows/i.test(ua)) return "win";
  return null;
}

// Mesmo padrão visual da LoginPage.jsx (aside escuro fixo de branding + card
// claro/escuro do conteúdo) - de propósito reaproveitado igual, não
// extraído pra um layout compartilhado: as duas páginas já viviam
// duplicando esse shell (ver RegisterPage.jsx), seguir o padrão existente
// em vez de inventar uma abstração nova só pra essa terceira página.
export default function DownloadPage() {
  const [darkMode, setDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const [recommended, setRecommended] = useState(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    setRecommended(detectOS());
  }, []);

  const options = [
    {
      os: "win",
      icon: Monitor,
      title: "Windows",
      detail: ".exe",
    },
    {
      os: "linux",
      icon: Terminal,
      title: "Linux",
      detail: "AppImage",
    },
  ];

  return (
    <div className="flex min-h-screen w-full flex-col bg-white text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100 lg:flex-row">
      {/* Painel de apresentação - ver LoginPage.jsx pro mesmo comentário: fica
          sempre em tema escuro de propósito, some em telas pequenas. */}
      <aside className="login-panel relative hidden w-full shrink-0 flex-col justify-between overflow-hidden bg-[#070b12] px-12 py-14 text-slate-100 lg:flex lg:w-[46%] xl:w-[42%] xl:px-16">
        <img src={logoDark} alt="" className="relative h-14 w-14" />

        <div className="relative max-w-md">
          <div className="mb-6 flex items-center gap-2.5 font-signal text-[11px] font-medium uppercase tracking-[0.2em] text-teal-300/90">
            <span className="login-ping-dot" aria-hidden="true" />
            Pronto pra instalar
            <span className="login-wave" aria-hidden="true">
              <span className="login-wave-bar" />
              <span className="login-wave-bar" />
              <span className="login-wave-bar" />
              <span className="login-wave-bar" />
              <span className="login-wave-bar" />
            </span>
          </div>

          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight text-white xl:text-[2.75rem]">
            Leve a nave
            <br />
            com você.
          </h1>

          <p className="mt-5 text-[15px] leading-relaxed text-slate-400">
            NaveSpeak é uma plataforma de comunicação por voz e vídeo projetada
            para comunidades, times e grupos de amigos que querem mais do que o
            básico. Com interface moderna, baixa latência, ele é a sua nova base
            de operações para chamadas, salas de voz e conversas em tempo real.
          </p>
        </div>

        <p className="relative font-signal text-[11px] uppercase tracking-[0.15em] text-slate-600">
          Status: CONVOCANDO NOVOS TRIPULANTES
        </p>
      </aside>

      {/* Painel de conteúdo */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-md">
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
                  Baixe o app pra desktop.
                </p>
              </div>
            </div>
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

          <div className="rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-200 transition-colors dark:bg-slate-900 dark:ring-slate-800">
            {isElectron() ? (
              // Quem já está DENTRO do app não precisa baixar nada - ele
              // mesmo é o app (mesma detecção de DownloadAppLink.jsx).
              <div className="text-center">
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Você já está aqui 🎉
                </h2>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                  Esta janela já É o app desktop do NaveSpeak.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-7">
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                    Baixar o NaveSpeak
                  </h2>
                  <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                    Escolha seu sistema. Sempre a versão mais recente.
                  </p>
                </div>

                <div className="space-y-3">
                  {options.map(({ os, icon: Icon, title, detail }) => (
                    <a
                      key={os}
                      href={`${API_URL}/download?os=${os}`}
                      className="group flex items-center gap-4 rounded-xl border border-slate-300 bg-white px-4 py-3.5 transition hover:border-blue-500 hover:bg-blue-50/50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-400 dark:hover:bg-blue-950/20"
                    >
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 transition group-hover:bg-blue-100 group-hover:text-blue-700 dark:bg-slate-700 dark:text-slate-200 dark:group-hover:bg-blue-500/20 dark:group-hover:text-blue-300">
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {title}
                          </span>
                          {recommended === os && (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                              Recomendado
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                          {detail}
                        </span>
                      </span>
                      <Download className="size-4 shrink-0 text-slate-400 transition group-hover:text-blue-600 dark:group-hover:text-blue-300" />
                    </a>
                  ))}
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
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
