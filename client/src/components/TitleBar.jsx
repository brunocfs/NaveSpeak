import { useEffect, useState } from "react";
import { isElectron } from "../api/media.js";

// Barra de título custom - só existe dentro do app Electron (frame:false em
// electron/main.js tira a barra nativa do SO de propósito, ver comentário
// lá). Fora do Electron (navegador comum) este componente não renderiza
// nada: o navegador já tem sua própria barra de título/abas.
//
// `-webkit-app-region: drag` é o que deixa arrastar/mover a janela clicando
// em qualquer ponto "vazio" da barra (Chromium/Electron só, propriedade não
// padrão) - cada botão precisa do oposto (`no-drag`), senão o clique vira
// arraste em vez de ação.
export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isElectron()) return;
    window.naveSpeak.window.isMaximized().then(setIsMaximized);
    return window.naveSpeak.window.onMaximizedChanged(setIsMaximized);
  }, []);

  if (!isElectron()) return null;

  return (
    <div
      style={{ WebkitAppRegion: "drag", height: 36 }}
      className="relative flex shrink-0 select-none items-center justify-center bg-slate-100 text-slate-700 dark:bg-slate-950 dark:text-slate-200"
    >
      <span className="text-xs font-semibold tracking-wide">Nave</span>

      <div
        style={{ WebkitAppRegion: "no-drag" }}
        className="absolute right-0 top-0 flex h-9"
      >
        <button
          type="button"
          aria-label="Minimizar"
          title="Minimizar"
          onClick={() => window.naveSpeak.window.minimize()}
          className="inline-flex w-11 items-center justify-center transition hover:bg-slate-200 dark:hover:bg-slate-800"
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="currentColor">
            <rect x="0" y="4.5" width="10" height="1" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={isMaximized ? "Restaurar" : "Maximizar"}
          title={isMaximized ? "Restaurar" : "Maximizar"}
          onClick={() => window.naveSpeak.window.maximizeToggle()}
          className="inline-flex w-11 items-center justify-center transition hover:bg-slate-200 dark:hover:bg-slate-800"
        >
          {isMaximized ? (
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke="currentColor">
              <rect x="0.5" y="2.5" width="7" height="7" />
              <path d="M2.5 2.5V0.5H9.5V7.5H7.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke="currentColor">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </button>
        <button
          type="button"
          aria-label="Fechar"
          title="Fechar (minimiza para a bandeja)"
          onClick={() => window.naveSpeak.window.close()}
          className="inline-flex w-11 items-center justify-center transition hover:bg-red-500 hover:text-white"
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
