import { useCallback, useEffect, useRef, useState } from 'react';

// Deixa UM tile do modo Livre ser arrastado pra qualquer posição dentro do
// container (position: absolute, x/y em px) - mesmo padrão de
// useResizableTile.js: guarda só um "override" que nasce null (usa a
// posição DEFAULT calculada pelo grid automático, ver VideoLayoutManager.jsx)
// e vira definitivo assim que o usuário arrasta uma vez. Duplo-clique
// (resetPos, chamado por quem usa o hook) volta pro automático de novo.
//
// `bounds` (em px, relativos ao container) reclampam sozinhos quando o
// container OU o próprio tile mudam de tamanho (resize da janela, resize
// manual do tile via useResizableTile, abrir/fechar sidebar etc.) - sem
// isso um tile arrastado pro canto podia ficar preso fora da área visível
// depois de a janela encolher (mesma classe de bug já corrigida no PiP
// flutuante de VoicePanel.jsx).
export function useDraggableTile({ bounds, defaultPos }) {
  const [override, setOverride] = useState(null);
  const dragRef = useRef(null);

  const clamp = useCallback(
    (x, y) => ({
      x: Math.min(Math.max(x, 0), Math.max(bounds.maxX, 0)),
      y: Math.min(Math.max(y, 0), Math.max(bounds.maxY, 0)),
    }),
    [bounds.maxX, bounds.maxY],
  );

  useEffect(() => {
    setOverride((prev) => {
      if (!prev) return prev;
      const next = clamp(prev.x, prev.y);
      return next.x === prev.x && next.y === prev.y ? prev : next;
    });
  }, [clamp]);

  const startDrag = useCallback(
    (event) => {
      // Só botão esquerdo / toque primário.
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();

      // Mesmo motivo de useResizableTile.js: a `window` do módulo é sempre a
      // da janela principal, mas o tile pode estar no popout (outra janela) -
      // sempre pega a window DONA do elemento que recebeu o pointerdown.
      const view = event.currentTarget.ownerDocument.defaultView ?? window;
      const base = override ?? defaultPos;
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        baseX: base.x,
        baseY: base.y,
      };

      function onMove(e) {
        const d = dragRef.current;
        if (!d) return;
        setOverride(clamp(d.baseX + (e.clientX - d.startX), d.baseY + (e.clientY - d.startY)));
      }
      function onUp() {
        dragRef.current = null;
        view.removeEventListener('pointermove', onMove);
        view.removeEventListener('pointerup', onUp);
      }
      view.addEventListener('pointermove', onMove);
      view.addEventListener('pointerup', onUp);
    },
    [clamp, override, defaultPos],
  );

  const resetPos = useCallback(() => setOverride(null), []);

  return { pos: override ?? defaultPos, startDrag, resetPos };
}
