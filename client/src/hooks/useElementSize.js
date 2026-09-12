import { useEffect, useRef, useState } from 'react';

// Mede o tamanho de um elemento em tempo real via ResizeObserver - usado pelo
// VideoLayoutManager pra recalcular o grid de vídeos sempre que o container
// muda de tamanho (redimensiona a janela, abre/fecha popout, fixa/desafixa
// alguém, o navegador entra em tela cheia etc.), sem precisar escutar
// window.resize (que não pega mudanças de layout internas, só da viewport).
export function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // Construtor da MESMA janela dona do elemento, não o `ResizeObserver`
    // global da janela principal - VoicePanel também é portado (createPortal)
    // pra dentro do popout (outra janela/documento inteiro, ver
    // VoicePanel.jsx). Um ResizeObserver criado na janela principal nunca
    // dispara callback pra um elemento que vive noutra janela, então
    // width/height ficavam travados em 0 lá dentro - grid/modo livre
    // calculavam layout com container "zero" (tiles minúsculos ou
    // empilhados em coluna, estourando a tela).
    const ResizeObserverImpl =
      el.ownerDocument?.defaultView?.ResizeObserver ?? ResizeObserver;
    const observer = new ResizeObserverImpl((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
