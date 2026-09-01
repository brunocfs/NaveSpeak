// Calcula o grid "ótimo" (colunas x linhas) pra um número de tiles de vídeo
// dentro de um container de tamanho conhecido: testa cada quantidade de
// colunas possível, deriva as linhas (ceil(count/cols)) e o tamanho de
// célula resultante mantendo a proporção pedida, e fica com a combinação que
// dá a MAIOR célula sem estourar o container - é o mesmo problema que
// Discord/Zoom/Meet resolvem pra decidir quantas colunas mostrar conforme a
// quantidade de participantes muda.
//
// Puro (sem DOM) de propósito - só pega number in, object out - pra dar pra
// testar sozinho e pra reusar tanto no grid principal quanto no grid da
// região de fixados (VideoLayoutManager.jsx).
export function computeGridLayout(count, containerWidth, containerHeight, { aspect = 16 / 9, gap = 8 } = {}) {
  if (count <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { cols: 0, rows: 0, cellWidth: 0, cellHeight: 0 };
  }

  let best = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);

    // Tamanho de célula se a largura do container mandar (uma linha cheia
    // ocupa toda a largura); depois checa se a altura total cabe.
    const widthByCols = (containerWidth - gap * (cols - 1)) / cols;
    const heightByCols = widthByCols / aspect;
    const totalHeight = heightByCols * rows + gap * (rows - 1);

    let cellWidth;
    let cellHeight;
    if (totalHeight <= containerHeight) {
      cellWidth = widthByCols;
      cellHeight = heightByCols;
    } else {
      // Não coube por altura - recalcula deixando a altura mandar.
      cellHeight = (containerHeight - gap * (rows - 1)) / rows;
      cellWidth = cellHeight * aspect;
    }

    if (cellWidth <= 0 || cellHeight <= 0) continue;
    if (!best || cellWidth * cellHeight > best.cellWidth * best.cellHeight) {
      best = { cols, rows, cellWidth, cellHeight };
    }
  }

  // Container pequeno demais pra qualquer combinação caber positivamente -
  // cai pra uma coluna só, tamanho literal do container, em vez de sumir.
  return best ?? { cols: count, rows: 1, cellWidth: containerWidth / count, cellHeight: containerHeight };
}
