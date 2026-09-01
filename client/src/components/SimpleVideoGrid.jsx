import { useMemo } from "react";
import ParticipantTile from "./ParticipantTile.jsx";
import { useElementSize } from "../hooks/useElementSize.js";
import { computeGridLayout } from "../utils/videoGridLayout.js";

const GAP = 8; // px - mesmo valor do gap-2/gap-3 do Tailwind usado no CSS.

// Uma área com N tiles em grid AUTOMÁTICO: mede o próprio container
// (useElementSize) e usa computeGridLayout pra achar quantas colunas/linhas
// deixam cada tile o MAIOR possível mantendo a proporção 16:9, preenchendo
// o espaço disponível de verdade (não um grid-cols fixo por breakpoint) -
// é o "2 lado a lado, 3 vira 2+1, 4 vira 2x2" que dá pra ver mudando a
// quantidade de participantes. Sem resize manual de propósito (isso é só
// no modo "Livre", VideoLayoutManager.jsx) - aqui é só medir + calcular,
// nenhum estado de drag pra dar errado.
function AutoGridArea({ tiles, pinned, onTogglePin, deafened, minHeight }) {
  const [containerRef, { width, height }] = useElementSize();
  const effectiveHeight = Math.max(height, minHeight ?? 0);
  const layout = useMemo(
    () => computeGridLayout(tiles.length, width, effectiveHeight, { gap: GAP }),
    [tiles.length, width, effectiveHeight]
  );

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full flex-wrap content-center items-center justify-center gap-2"
      style={minHeight ? { minHeight } : undefined}
    >
      {tiles.map(({ key, ...t }) => (
        <ParticipantTile
          key={key}
          {...t}
          pinned={pinned}
          deafened={deafened}
          onTogglePin={() => onTogglePin(key)}
          className="!aspect-auto shrink-0"
          style={{
            width: layout.cellWidth || undefined,
            height: layout.cellHeight || undefined,
          }}
        />
      ))}
    </div>
  );
}

// Modo "Grade" do painel de voz: grid AUTOMÁTICO (AutoGridArea acima) sem
// resize manual - é o modo ALTERNATIVO ao VideoLayoutManager.jsx ("Livre" -
// mesmo cálculo de grid, mas com resize por tile e múltiplos fixados numa
// região própria). Mesmos props dos dois (tiles, pinnedKeys, onTogglePin,
// deafened) pra dar pra trocar de modo em VoicePanel.jsx sem mexer em mais
// nada - só a REPRESENTAÇÃO visual muda, o Set de fixados é o mesmo.
export default function SimpleVideoGrid({ tiles, pinnedKeys, onTogglePin, deafened }) {
  const pinnedTiles = tiles.filter((t) => pinnedKeys.has(t.key));
  const restTiles = pinnedTiles.length > 0 ? tiles.filter((t) => !pinnedKeys.has(t.key)) : [];

  if (pinnedTiles.length === 0) {
    return (
      <AutoGridArea tiles={tiles} pinned={false} onTogglePin={onTogglePin} deafened={deafened} />
    );
  }

  return (
    <div className="flex h-full min-h-[22rem] flex-col gap-3 md:flex-row">
      <div className="min-h-[16rem] flex-[3]">
        <AutoGridArea
          tiles={pinnedTiles}
          pinned
          onTogglePin={onTogglePin}
          deafened={deafened}
          minHeight={256}
        />
      </div>
      {restTiles.length > 0 && (
        <div className="flex gap-2 overflow-x-auto md:w-44 md:flex-col md:overflow-x-hidden md:overflow-y-auto">
          {restTiles.map(({ key, ...t }) => (
            <ParticipantTile
              key={key}
              {...t}
              deafened={deafened}
              onTogglePin={() => onTogglePin(key)}
              className="w-40 shrink-0 md:w-full"
            />
          ))}
        </div>
      )}
    </div>
  );
}
