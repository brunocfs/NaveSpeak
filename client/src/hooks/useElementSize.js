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
    const observer = new ResizeObserver((entries) => {
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
