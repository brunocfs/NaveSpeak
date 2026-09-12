import { useCallback, useEffect, useRef, useState } from 'react';

// Igual a useWindowPopout.js (mesmo motivo: window.open('about:blank') +
// portal direto, nunca navegação de verdade - MediaStream não atravessa um
// documento isolado) mas KEYED - permite várias janelas abertas ao mesmo
// tempo, uma por TILE (câmera ou tela compartilhada de um participante), em
// vez de uma única janela pro painel inteiro (ver useWindowPopout.js, que
// continua existindo à parte pra isso).
export function useTilePopouts() {
  const [windows, setWindows] = useState(() => new Map());
  // Espelha `windows` sem disparar render - só pra ler o valor mais recente
  // no cleanup de unmount abaixo, sem precisar chamar setState numa hora em
  // que já não importa mais (componente já saiu de cena).
  const windowsRef = useRef(windows);
  windowsRef.current = windows;

  const open = useCallback((key, { title = '', width = 480, height = 360 } = {}) => {
    setWindows((prev) => {
      const existing = prev.get(key);
      if (existing && !existing.closed) {
        existing.focus();
        return prev;
      }
      const win = window.open('', `navespeak-tile-${key}`, `popup=yes,width=${width},height=${height}`);
      if (!win) return prev; // bloqueado por um bloqueador de pop-up

      document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
        win.document.head.appendChild(node.cloneNode(true));
      });
      if (title) win.document.title = title;
      win.document.documentElement.className = document.documentElement.className;
      win.document.documentElement.style.colorScheme = document.documentElement.style.colorScheme;
      win.document.documentElement.style.height = '100%';
      Object.assign(win.document.body.style, {
        height: '100%',
        margin: '0',
        padding: '0',
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: 'black',
      });

      const next = new Map(prev);
      next.set(key, win);
      return next;
    });
  }, []);

  const close = useCallback((key) => {
    setWindows((prev) => {
      const win = prev.get(key);
      if (!win) return prev;
      win.close();
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  // Detecta fechamento (X nativo da janela, etc.) por polling - um intervalo
  // só cobre todas as janelas abertas, não um por janela. Mesmo fallback de
  // useWindowPopout.js, que já é garantia suficiente sozinho (ver comentário
  // lá) - sem precisar de 'pagehide' por janela aqui.
  useEffect(() => {
    if (windows.size === 0) return undefined;
    const interval = setInterval(() => {
      setWindows((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [key, win] of prev) {
          if (win.closed) {
            next.delete(key);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [windows]);

  // Tema em dia enquanto as janelas estiverem abertas - mesmo motivo de
  // useWindowPopout.js (PreferencesContext só troca a classe .dark na
  // <html> do documento principal).
  useEffect(() => {
    if (windows.size === 0) return undefined;
    const mainHtml = document.documentElement;
    function syncTheme() {
      for (const win of windows.values()) {
        win.document.documentElement.className = mainHtml.className;
        win.document.documentElement.style.colorScheme = mainHtml.style.colorScheme;
      }
    }
    const observer = new MutationObserver(syncTheme);
    observer.observe(mainHtml, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, [windows]);

  // Se quem usa o hook desmontar (VoicePanel some, ex.: saiu da voz de vez),
  // fecha toda janela ainda aberta - nunca deixa uma órfã sem conteúdo vivo.
  // Roda só no unmount de propósito (array vazio) - `windows` é lido de
  // dentro do cleanup via closure da última render, não precisa disparar de
  // novo a cada mudança.
  useEffect(
    () => () => {
      for (const win of windowsRef.current.values()) win.close();
    },
    [],
  );

  return { windows, open, close };
}
