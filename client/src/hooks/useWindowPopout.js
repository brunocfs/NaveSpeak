import { useCallback, useEffect, useRef, useState } from 'react';

// Destaca um painel para uma janela de verdade, independente (própria janela
// do sistema operacional, redimensionável, com sua própria entrada na
// taskbar, sem ficar sempre por cima de tudo) - não uma Picture-in-Picture.
//
// Usa window.open() com uma página em branco ('about:blank') que a gente
// mesmo povoa via portal React, em vez de navegar pra uma URL: assim a nova
// janela é uma janela auxiliar same-origin, no MESMO processo/realm JS da
// janela principal (não uma aba isolada rodando o app do zero de novo), e os
// elementos <video>/<audio> com MediaStream ao vivo continuam tocando sem
// precisar reconectar nada.
//
// No Electron, window.open() é interceptado por setWindowOpenHandler
// (electron/main.js) - ele permite explicitamente esse caso (url ===
// 'about:blank') e cria uma janela nativa de verdade; qualquer outra URL
// (ex.: link clicado no chat) continua sendo mandada pro navegador do SO.
export function useWindowPopout() {
  const [popout, setPopout] = useState(null);
  const pollRef = useRef(null);

  const open = useCallback(({ width = 480, height = 680, title = '' } = {}) => {
    const win = window.open('', 'navespeak-voice-popout', `popup=yes,width=${width},height=${height}`);
    if (!win) return null; // bloqueado por um bloqueador de pop-up

    // Sem isso a janela nasce sem nenhum estilo (HTML cru) - copiamos toda
    // folha de estilo atual (Tailwind + CSS do app), o que já traz junto as
    // regras de `body { background/color }` do index.css.
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      win.document.head.appendChild(node.cloneNode(true));
    });
    if (title) win.document.title = title;
    win.document.documentElement.style.height = '100%';
    Object.assign(win.document.body.style, {
      height: '100%',
      margin: '0',
      padding: '12px',
      boxSizing: 'border-box',
      overflow: 'auto',
    });

    setPopout(win);
    return win;
  }, []);

  const close = useCallback(() => {
    popout?.close();
  }, [popout]);

  // Detecta o fechamento da janela tanto pelo evento 'pagehide' quanto por
  // polling de `.closed` - fechar pelo X nativo da janela nem sempre dispara
  // o evento de forma confiável em todo ambiente, então o polling é o
  // fallback que garante que a UI sempre volta a mostrar o painel embutido.
  useEffect(() => {
    if (!popout) return undefined;
    function handleClose() {
      setPopout(null);
    }
    popout.addEventListener('pagehide', handleClose);
    pollRef.current = setInterval(() => {
      if (popout.closed) handleClose();
    }, 500);
    return () => {
      popout.removeEventListener('pagehide', handleClose);
      clearInterval(pollRef.current);
    };
  }, [popout]);

  // Se o componente dono desmontar com a janela ainda aberta (ex.: saiu da
  // voz), fecha junto - nunca deixa uma janela "órfã" sem conteúdo vivo.
  useEffect(() => () => popout?.close(), [popout]);

  return { popout, open, close };
}
