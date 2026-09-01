import { useCallback, useRef, useState } from 'react';

// Deixa UM tile de mídia (câmera, avatar, tela compartilhada) ser
// redimensionado individualmente - só pelo canto inferior direito, de
// propósito: nenhuma alça nas outras bordas/cantos, pra não ter como
// espichar largura e altura em proporções diferentes (isso é o que causava
// mídia distorcida). O layout automático (computeGridLayout, via
// VideoLayoutManager) continua dando o tamanho DEFAULT de cada tile a cada
// render; aqui só guardamos um "override" que, uma vez definido pelo drag,
// passa a mandar no tamanho daquele tile específico até um duplo-clique na
// alça (resetSize) voltar pro automático de novo.
//
// aspect é FIXO durante o resize inteiro (a proporção do tile no momento em
// que o drag começa) - o drag só decide a LARGURA (eixo horizontal do
// mouse); a altura é sempre width/aspect, nunca um valor independente. Isso
// é o que garante "preserva proporção da mídia" sem precisar calcular
// diagonal/distância: um canto que só engorda largura e deriva altura não
// tem como sair da proporção.
//
// min/max (px) evitam o tile sumir de tão pequeno ou vazar pra fora do
// container - max normalmente é recalculado a cada render com o tamanho
// atual do container (VideoLayoutManager passa containerWidth/Height
// medidos via useElementSize), então o clamp acompanha resize da janela.
export function useResizableTile({ aspect = 16 / 9, min = { width: 140, height: 90 }, max } = {}) {
  const [override, setOverride] = useState(null);
  const dragRef = useRef(null);

  // Clampa por LARGURA e deriva a altura da mesma proporção - nunca clampa
  // width e height em separado (é isso que quebraria a proporção perto dos
  // limites min/max).
  const clamp = useCallback(
    (rawWidth) => {
      const maxW = max?.width ?? Infinity;
      const maxH = max?.height ?? Infinity;
      const minWidthFromMinHeight = min.height * aspect;
      const maxWidthFromMaxHeight = maxH * aspect;
      const lo = Math.max(min.width, minWidthFromMinHeight);
      const hi = Math.min(maxW, maxWidthFromMaxHeight);
      const width = hi >= lo ? Math.min(hi, Math.max(lo, rawWidth)) : lo;
      return { width, height: width / aspect };
    },
    [aspect, min.width, min.height, max?.width, max?.height]
  );

  const startCornerDrag = useCallback(
    (event) => {
      // Só botão esquerdo / toque primário, e nunca deixa o drag também
      // acionar o pin (ou selecionar texto) do tile por baixo da alça.
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      // A `window` global do MÓDULO é sempre a da janela principal (é onde
      // este script foi carregado) - mas o tile pode estar num popout
      // (VoicePanel "Abrir em uma nova janela"), um `window` DIFERENTE.
      // Ouvir pointermove/up na `window` errada nunca recebe os eventos que
      // disparam no documento do popout: o resize trava no meio do drag (o
      // 'pointerup' nunca chega pra soltar) e a listener fica pendurada pra
      // sempre. Por isso sempre pega a window DONA do elemento que recebeu
      // o pointerdown, nunca a global do módulo.
      const view = event.currentTarget.ownerDocument.defaultView ?? window;

      const rect = event.currentTarget.parentElement.getBoundingClientRect();
      dragRef.current = { startX: event.clientX, startWidth: rect.width };

      function onMove(e) {
        const d = dragRef.current;
        if (!d) return;
        setOverride(clamp(d.startWidth + (e.clientX - d.startX)));
      }
      function onUp() {
        dragRef.current = null;
        view.removeEventListener('pointermove', onMove);
        view.removeEventListener('pointerup', onUp);
      }
      view.addEventListener('pointermove', onMove);
      view.addEventListener('pointerup', onUp);
    },
    [clamp]
  );

  const resetSize = useCallback(() => setOverride(null), []);

  return { size: override, startCornerDrag, resetSize };
}
