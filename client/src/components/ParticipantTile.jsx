import { useEffect, useRef } from 'react';

// Toca um MediaStream remoto (áudio, e vídeo a partir da Fase 4) e mostra o
// nome do participante. Um único componente cobre voz e tela/câmera.
export default function ParticipantTile({ username, stream, kind = 'audio', muted = false, isLocal = false }) {
  const mediaRef = useRef(null);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    el.play?.().catch(() => {
      // Autoplay pode ser bloqueado pelo navegador em alguns casos; o próprio
      // gesto de "Entrar na voz" já contou como interação do usuário, mas
      // engolimos o erro aqui para não quebrar a UI se acontecer mesmo assim.
    });
  }, [stream]);

  return (
    <div className={`participant-tile${muted ? ' muted' : ''}`}>
      {kind === 'video' ? (
        <video ref={mediaRef} autoPlay playsInline muted={isLocal} className="participant-video" />
      ) : (
        <audio ref={mediaRef} autoPlay playsInline muted={isLocal} />
      )}
      <span className="participant-name">
        {username} {muted && '🔇'}
      </span>
    </div>
  );
}
