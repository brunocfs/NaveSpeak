import { useMemo } from 'react';
import { useElementSize } from '../hooks/useElementSize.js';
import { useResizableTile } from '../hooks/useResizableTile.js';
import { useDraggableTile } from '../hooks/useDraggableTile.js';
import { computeGridLayout } from '../utils/videoGridLayout.js';
import ParticipantTile from './ParticipantTile.jsx';

const GAP = 8; // px - mesmo valor do gap-2 do Tailwind (0.5rem), usado tanto no CSS quanto nas contas de layout.
const MIN_TILE = { width: 140, height: 90 };

// Um tile dentro de um AutoGrid: nasce na posição/tamanho que o grid
// automático calculou (computeGridLayout), mas ambos são só um "default" -
// arrastar o CORPO do tile reposiciona (useDraggableTile), arrastar a alça
// do canto inferior direito redimensiona mantendo a proporção
// (useResizableTile, nunca deixa width/height mudarem independentes pra
// mídia não distorcer). position:absolute (não mais flex-wrap) é o que
// garante o modo Livre de verdade: cada tile solto em qualquer canto,
// podendo até sobrepor outro - e nunca estourar o container, já que
// width/height/posição são todos clampados ao tamanho medido dele.
// Duplo-clique no corpo reseta a posição; duplo-clique na alça reseta o
// tamanho - dois resets independentes.
function FreeTile({
  tile,
  index,
  cols,
  cellWidth,
  cellHeight,
  pinned,
  onTogglePin,
  deafened,
  poppedOut,
  onTogglePopout,
  containerWidth,
  containerHeight,
}) {
  const defaultWidth = cellWidth || MIN_TILE.width;
  const defaultHeight = cellHeight || MIN_TILE.height;
  const aspect = defaultWidth / defaultHeight || 16 / 9;
  const { size, startCornerDrag, resetSize } = useResizableTile({
    aspect,
    min: MIN_TILE,
    max: { width: containerWidth, height: containerHeight },
  });
  const width = size?.width ?? defaultWidth;
  const height = size?.height ?? defaultHeight;

  const defaultPos = useMemo(
    () => ({
      x: (index % cols) * (defaultWidth + GAP),
      y: Math.floor(index / cols) * (defaultHeight + GAP),
    }),
    [index, cols, defaultWidth, defaultHeight],
  );
  const bounds = useMemo(
    () => ({
      maxX: containerWidth - width,
      maxY: containerHeight - height,
    }),
    [containerWidth, containerHeight, width, height],
  );
  const { pos, startDrag, resetPos } = useDraggableTile({ bounds, defaultPos });

  // tile.key existe (é usado como React key lá em cima, no AutoGrid) mas não
  // pode ir dentro do `{...tileProps}` - key espalhado via props vira só um
  // prop comum chamado "key" (React ignora, warning no console), então tira
  // ele do objeto antes de espalhar.
  const { key: _tileKey, ...tileProps } = tile;

  // Clique num botão do próprio ParticipantTile (pin/ocultar/mutar
  // localmente) não pode iniciar um drag do tile inteiro por baixo dele -
  // mesmo cuidado do PiP flutuante em VoicePanel.jsx.
  function handleBodyPointerDown(e) {
    if (e.target.closest('button')) return;
    startDrag(e);
  }
  function handleBodyDoubleClick(e) {
    if (e.target.closest('button')) return;
    resetPos();
  }

  return (
    <div
      className="group/resize absolute cursor-grab touch-none active:cursor-grabbing"
      style={{ width, height, left: pos.x, top: pos.y }}
      onPointerDown={handleBodyPointerDown}
      onDoubleClick={handleBodyDoubleClick}
    >
      <ParticipantTile
        {...tileProps}
        pinned={pinned}
        deafened={deafened}
        onTogglePin={() => onTogglePin(tile.key)}
        poppedOut={poppedOut}
        onTogglePopout={() => onTogglePopout(tile.key)}
        className="!aspect-auto h-full w-full"
      />
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          startCornerDrag(e);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          resetSize();
        }}
        title="Arraste para redimensionar, mantém a proporção (duplo-clique reseta)"
        className="absolute bottom-0 right-0 flex size-4 cursor-nwse-resize items-end justify-end p-0.5 opacity-0 transition group-hover/resize:opacity-100"
      >
        <div className="size-2 rounded-sm bg-blue-400/80" />
      </div>
    </div>
  );
}

// Um grid automático: mede o próprio container (useElementSize) e usa
// computeGridLayout pra decidir a posição/tamanho DEFAULT de cada tile
// (quantas colunas/linhas maximizam o tamanho mantendo proporção 16:9),
// recalculando sempre que o container muda de tamanho ou a quantidade de
// tiles muda. `relative` + `overflow-hidden`: os FreeTile filhos são
// position:absolute clampados ao tamanho medido deste container - nunca
// precisa de scroll, é isso que garante "usa todo o espaço sem ultrapassar
// a tela" mesmo depois de arrastar/redimensionar manualmente.
function AutoGrid({ tiles, pinnedKeys, onTogglePin, deafened, poppedOutKeys, onTogglePopout, minHeight }) {
  const [containerRef, { width, height }] = useElementSize();
  const effectiveHeight = Math.max(height, minHeight ?? 0);
  const layout = useMemo(
    () => computeGridLayout(tiles.length, width, effectiveHeight, { gap: GAP }),
    [tiles.length, width, effectiveHeight]
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={minHeight ? { minHeight } : undefined}
    >
      {tiles.map((t, index) => (
        <FreeTile
          key={t.key}
          tile={t}
          index={index}
          cols={layout.cols || 1}
          cellWidth={layout.cellWidth}
          cellHeight={layout.cellHeight}
          pinned={pinnedKeys.has(t.key)}
          onTogglePin={onTogglePin}
          deafened={deafened}
          poppedOut={poppedOutKeys.has(t.key)}
          onTogglePopout={onTogglePopout}
          containerWidth={width || MIN_TILE.width}
          containerHeight={effectiveHeight || MIN_TILE.height}
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
export default function VideoLayoutManager({
  tiles,
  pinnedKeys,
  onTogglePin,
  deafened,
  poppedOutKeys,
  onTogglePopout,
}) {
  const pinnedTiles = tiles.filter((t) => pinnedKeys.has(t.key));
  const restTiles = pinnedTiles.length > 0 ? tiles.filter((t) => !pinnedKeys.has(t.key)) : [];

  if (pinnedTiles.length === 0) {
    return (
      <AutoGrid
        tiles={tiles}
        pinnedKeys={pinnedKeys}
        onTogglePin={onTogglePin}
        deafened={deafened}
        poppedOutKeys={poppedOutKeys}
        onTogglePopout={onTogglePopout}
      />
    );
  }

  return (
    <div className="flex h-full min-h-[22rem] flex-col gap-3 md:flex-row">
      <div className="min-h-[16rem] flex-[3]">
        <AutoGrid
          tiles={pinnedTiles}
          pinnedKeys={pinnedKeys}
          onTogglePin={onTogglePin}
          deafened={deafened}
          poppedOutKeys={poppedOutKeys}
          onTogglePopout={onTogglePopout}
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
              poppedOut={poppedOutKeys.has(_tileKey)}
              onTogglePopout={() => onTogglePopout(_tileKey)}
              className="w-40 shrink-0 md:w-full"
            />
          ))}
        </div>
      )}
    </div>
  );
}
