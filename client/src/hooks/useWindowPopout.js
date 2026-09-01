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
    // Tema (classe .dark na <html> + color-scheme) - sem isso a <html> da
    // popout nasce sem NENHUMA classe de tema, então as variáveis --bg/etc.
    // (ver styles/index.css) caem sempre no valor CLARO (custom-variant
    // `dark` só ativa dentro de `.dark, .dark *`) não importa o tema ativo
    // no app - fundo sempre claro/branco, tema errado. O useEffect abaixo
    // mantém isso sincronizado se o usuário trocar de tema com a popout
    // já aberta.
    win.document.documentElement.className = document.documentElement.className;
    win.document.documentElement.style.colorScheme = document.documentElement.style.colorScheme;
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

  // Mantém o tema da popout em dia com o da janela principal enquanto ela
  // estiver aberta - PreferencesContext troca a classe .dark só na <html>
  // do documento principal (não sabe que existe uma popout), então sem
  // isso trocar de tema com a popout já aberta deixaria ela presa no tema
  // de quando foi aberta.
  useEffect(() => {
    if (!popout) return undefined;
    const mainHtml = document.documentElement;
    function syncTheme() {
      popout.document.documentElement.className = mainHtml.className;
      popout.document.documentElement.style.colorScheme = mainHtml.style.colorScheme;
    }
    const observer = new MutationObserver(syncTheme);
    observer.observe(mainHtml, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, [popout]);

  return { popout, open, close };
}
