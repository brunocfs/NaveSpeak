import { useEffect, useRef } from 'react';
import { MicOff, Pin, PinOff } from 'lucide-react';
import { useSpeaking } from '../hooks/useSpeaking.js';
import Avatar from './Avatar.jsx';

// Um "quadradinho" da chamada, no estilo Discord: representa UMA pessoa (com
// câmera ligada ou avatar com iniciais) OU uma tela compartilhada - nunca os
// dois juntos no mesmo tile (uma tela compartilhada é sempre um tile à parte,
// rotulado com o nome de quem está compartilhando). kind='person' também toca
// o áudio do microfone dessa pessoa (se houver stream) e desenha o anel verde
// de "está falando".
export default function ParticipantTile({
  username,
  avatarPath = null,
  videoStream = null,
  micStream = null,
  micMuted = false,
  isLocal = false,
  deafened = false,
  kind = 'person',
  pinned = false,
  onTogglePin,
  className = '',
}) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const speaking = useSpeaking(kind === 'person' ? micStream : null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoStream) return;
    el.srcObject = videoStream;
    el.play?.().catch(() => {});
  }, [videoStream]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !micStream) return;
    el.srcObject = micStream;
    el.play?.().catch(() => {});
  }, [micStream]);

  // Reprodução local sempre muda (não ecoar o próprio mic/câmera); a de
  // qualquer participante remoto some com "silenciar todos" (deafen) ativo.
  const playbackMuted = isLocal || deafened;
  const hasVideo = Boolean(videoStream);

  return (
    <div
      className={`group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-slate-800 ring-2 transition ${
        speaking ? 'ring-emerald-500' : 'ring-transparent'
      } ${className}`}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={playbackMuted}
          className={`h-full w-full ${kind === 'screen' ? 'object-contain bg-black' : 'object-cover'}`}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-700">
          {/* Foto de perfil como estado visual padrão de quem está sem
              câmera/tela compartilhada - some assim que qualquer mídia de
              vídeo entra (hasVideo acima), sem precisar de outro estado. */}
          <Avatar
            avatarPath={avatarPath}
            username={username}
            size="xl"
            className="!bg-slate-600 !text-slate-100"
          />
        </div>
      )}

      {kind === 'person' && micStream && (
        <audio ref={audioRef} autoPlay playsInline muted={playbackMuted} />
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
        <span className="truncate text-xs font-medium text-white">{username}</span>
        {kind === 'person' && micMuted && (
          <MicOff className="size-3.5 shrink-0 text-red-400" />
        )}
      </div>

      {onTogglePin && (
        <button
          onClick={onTogglePin}
          title={pinned ? 'Desafixar' : 'Fixar (deixar maior)'}
          className={`absolute right-1.5 top-1.5 rounded-lg bg-black/50 p-1.5 text-white transition hover:bg-black/70 ${
            pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
