import { useMemo } from 'react';
import { useElementSize } from '../hooks/useElementSize.js';
import { useResizableTile } from '../hooks/useResizableTile.js';
import { computeGridLayout } from '../utils/videoGridLayout.js';
import ParticipantTile from './ParticipantTile.jsx';

const GAP = 8; // px - mesmo valor do gap-2 do Tailwind (0.5rem), usado tanto no CSS quanto nas contas de layout.
const MIN_TILE = { width: 140, height: 90 };

// Um tile dentro de um AutoGrid: renderiza o ParticipantTile no tamanho
// default calculado pelo grid, mais UMA alça só - canto inferior direito -
// que aparece no hover pra permitir resize manual. Nenhuma alça nas outras
// bordas/cantos de propósito: resize só pelo canto e só mudando a largura
// (useResizableTile deriva a altura por aspect, nunca deixa width/height
// mudarem independentes) é o que garante a mídia nunca distorcer durante o
// drag. Duplo-clique na alça reseta pro tamanho automático do grid.
function ResizableSlot({ tile, pinned, onTogglePin, deafened, defaultWidth, defaultHeight, maxWidth, maxHeight }) {
  const aspect = defaultWidth / defaultHeight || 16 / 9;
  const { size, startCornerDrag, resetSize } = useResizableTile({
    aspect,
    min: MIN_TILE,
    max: { width: maxWidth, height: maxHeight },
  });
  const width = size?.width ?? defaultWidth;
  const height = size?.height ?? defaultHeight;
  // tile.key existe (é usado como React key lá em cima, no AutoGrid) mas não
  // pode ir dentro do `{...tileProps}` - key espalhado via props vira só um
  // prop comum chamado "key" (React ignora, warning no console), então tira
  // ele do objeto antes de espalhar.
  const { key: _tileKey, ...tileProps } = tile;

  return (
    <div className="group/resize relative shrink-0" style={{ width, height }}>
      <ParticipantTile
        {...tileProps}
        pinned={pinned}
        deafened={deafened}
        onTogglePin={() => onTogglePin(tile.key)}
        className="!aspect-auto h-full w-full"
      />
      <div
        onPointerDown={startCornerDrag}
        onDoubleClick={resetSize}
        title="Arraste para redimensionar, mantém a proporção (duplo-clique reseta)"
        className="absolute bottom-0 right-0 flex size-4 cursor-nwse-resize items-end justify-end p-0.5 opacity-0 transition group-hover/resize:opacity-100"
      >
        <div className="size-2 rounded-sm bg-blue-400/80" />
      </div>
    </div>
  );
}

// Um grid automático: mede o próprio container (useElementSize) e usa
// computeGridLayout pra decidir quantas colunas/linhas maximizam o tamanho
// de cada tile mantendo proporção 16:9, recalculando sempre que o container
// muda de tamanho ou a quantidade de tiles muda. flex-wrap (em vez de CSS
// grid) de propósito: cada ResizableSlot tem largura/altura em px próprias,
// então um resize manual só empurra os vizinhos na mesma linha/coluna, sem
// esticar tiles de outras linhas junto (o que aconteceria com grid-template
// compartilhado entre todos os tiles).
function AutoGrid({ tiles, pinnedKeys, onTogglePin, deafened, minHeight }) {
  const [containerRef, { width, height }] = useElementSize();
  const effectiveHeight = Math.max(height, minHeight ?? 0);
  const layout = useMemo(
    () => computeGridLayout(tiles.length, width, effectiveHeight, { gap: GAP }),
    [tiles.length, width, effectiveHeight]
  );

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full flex-wrap content-start items-start gap-2 overflow-auto"
      style={minHeight ? { minHeight } : undefined}
    >
      {tiles.map((t) => (
        <ResizableSlot
          key={t.key}
          tile={t}
          pinned={pinnedKeys.has(t.key)}
          onTogglePin={onTogglePin}
          deafened={deafened}
          defaultWidth={layout.cellWidth || MIN_TILE.width}
          defaultHeight={layout.cellHeight || MIN_TILE.height}
          maxWidth={width || MIN_TILE.width}
          maxHeight={effectiveHeight || MIN_TILE.height}
        />
      ))}
    </div>
  );
}

// Video layout manager do painel de voz: decide como distribuir os tiles da
// chamada (câmeras, avatares de quem tá sem câmera, telas compartilhadas) no
// espaço disponível, e deixa cada um ser redimensionado individualmente.
//
// - SEM ninguém fixado: um único AutoGrid com todos os tiles, cada um do
//   tamanho que maximiza o uso do espaço mantendo 16:9.
// - COM um ou mais fixados: os fixados ganham a região prioritária (maior
//   fatia do espaço, topo/esquerda) em seu PRÓPRIO AutoGrid - então fixar 2
//   pessoas bota as duas grandes lado a lado, não uma só; o resto vira uma
//   faixa secundária rolável ao lado (desktop) ou abaixo (mobile), como uma
//   fita de miniaturas - mantém o comportamento de "spotlight" que já existia
//   pra 1 fixado, generalizado pra N.
//
// tiles: array de { key, kind: 'person'|'screen', ...props do ParticipantTile }.
// pinnedKeys: Set<string> de chaves fixadas (ver VoicePanel.jsx).
export default function VideoLayoutManager({ tiles, pinnedKeys, onTogglePin, deafened }) {
  const pinnedTiles = tiles.filter((t) => pinnedKeys.has(t.key));
  const restTiles = pinnedTiles.length > 0 ? tiles.filter((t) => !pinnedKeys.has(t.key)) : [];

  if (pinnedTiles.length === 0) {
    return <AutoGrid tiles={tiles} pinnedKeys={pinnedKeys} onTogglePin={onTogglePin} deafened={deafened} />;
  }

  return (
    <div className="flex h-full min-h-[22rem] flex-col gap-3 md:flex-row">
      <div className="min-h-[16rem] flex-[3]">
        <AutoGrid
          tiles={pinnedTiles}
          pinnedKeys={pinnedKeys}
          onTogglePin={onTogglePin}
          deafened={deafened}
          minHeight={256}
        />
      </div>
      {restTiles.length > 0 && (
        <div className="flex gap-2 overflow-x-auto md:w-56 md:flex-col md:overflow-x-hidden md:overflow-y-auto">
          {restTiles.map(({ key: _tileKey, ...t }) => (
            <ParticipantTile
              key={_tileKey}
              {...t}
              deafened={deafened}
              onTogglePin={() => onTogglePin(_tileKey)}
              className="w-40 shrink-0 md:w-full"
            />
          ))}
        </div>
      )}
    </div>
  );
}
