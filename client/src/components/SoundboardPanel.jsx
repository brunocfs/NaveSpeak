import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Volume2 } from "lucide-react";
import { listSounds } from "../api/soundboard.js";
import { useMediaSession } from "../context/MediaSessionContext.jsx";

// Popover de soundboard - aberto pelo botão novo em VoicePanel.jsx, só
// visível dentro de um canal de voz de SERVIDOR (voiceRoomId, ver
// comentário lá - chamada privada nunca tem soundboard). A lista em si é
// visível a qualquer membro (GET .../soundboard não exige USE_SOUNDBOARD,
// ver rooms.routes.js); é o CLIQUE que o servidor pode recusar (sem
// permissão, ensurdecido, rate limit) - por isso todo botão fica clicável e
// o erro, quando vem, aparece inline em vez de esconder sons à toa.
export default function SoundboardPanel({ roomId, onClose, anchorEl }) {
  const { triggerSoundboardSound } = useMediaSession();
  const [sounds, setSounds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [playError, setPlayError] = useState(null);
  const [playingId, setPlayingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listSounds(roomId)
      .then((data) => {
        if (!cancelled) setSounds(data.sounds);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  async function handlePlay(sound) {
    setPlayError(null);
    setPlayingId(sound.id);
    try {
      await triggerSoundboardSound(sound.id);
    } catch (err) {
      setPlayError(err.message);
    } finally {
      setPlayingId(null);
    }
  }

  // Com anchorEl (VoiceControlBar), o card abre logo acima do botão, centrado
  // nele e limitado às bordas da tela. Sem anchorEl (VoicePanel), mantém o
  // layout centralizado de sempre.
  let anchorStyle;
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const width = Math.min(448, window.innerWidth - 16);
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, 8),
      window.innerWidth - width - 8,
    );
    anchorStyle = {
      position: "fixed",
      left,
      width,
      bottom: window.innerHeight - rect.top + 8,
    };
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-50 ${anchorEl ? "" : "flex items-end justify-center sm:items-center"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Efeitos sonoros"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={anchorStyle}
        className={`max-h-[70vh] overflow-y-auto bg-white p-4 shadow-xl dark:bg-slate-900 ${
          anchorEl
            ? "rounded-2xl border border-slate-200 dark:border-slate-700"
            : "w-full max-w-md rounded-t-2xl sm:rounded-2xl"
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Efeitos sonoros
          </h3>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>

        {loading && <p className="text-sm text-slate-400">Carregando...</p>}
        {loadError && (
          <p className="text-sm text-red-500 dark:text-red-400">{loadError}</p>
        )}
        {playError && (
          <p className="mb-2 text-sm text-red-500 dark:text-red-400">
            {playError}
          </p>
        )}

        {!loading && !loadError && sounds.length === 0 && (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            Nenhum efeito sonoro cadastrado. Peça a um administrador do servidor
            pra adicionar em Configurações &gt; Efeitos sonoros.
          </p>
        )}

        {sounds.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sounds.map((sound) => (
              <button
                key={sound.id}
                type="button"
                onClick={() => handlePlay(sound)}
                disabled={playingId === sound.id}
                className="cursor-pointer flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Volume2 className="size-4 shrink-0" />
                <span className="truncate">{sound.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
