import { useEffect, useRef } from "react";

// Um <audio> por participante remoto com mic - tocando sempre, INDEPENDENTE
// do tile dele aparecer no grid ou não. Antes o <audio> vivia dentro de
// ParticipantTile: com "esconder quem está sem câmera/tela" ligado
// (VoicePanel.jsx), o tile de quem só tinha o mic aberto desmontava - e junto
// dele o <audio>, cortando o som dessa pessoa até desligar o filtro. Este
// componente é montado UMA VEZ em VoicePanel, sempre com a lista COMPLETA de
// participantes (nunca a filtrada `visibleTiles`), então o áudio nunca
// depende do que está visível.
function RemoteAudio({ micStream, muted }) {
  const audioRef = useRef(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !micStream) return;
    el.srcObject = micStream;
    el.play?.().catch(() => {});
  }, [micStream]);

  if (!micStream) return null;
  return <audio ref={audioRef} autoPlay playsInline muted={muted} hidden />;
}

// `tiles` = personTiles (kind='person') SEM filtro de visibilidade - já vem
// sem o tile local (isLocal), mas filtra de novo aqui por segurança (nunca
// ecoar o próprio mic). `deafened` silencia a reprodução de todo mundo de
// uma vez ("Silenciar todos" em VoicePanel), igual já fazia dentro do tile.
export default function RemoteAudioPlayers({ tiles, deafened }) {
  return (
    <>
      {tiles
        .filter((t) => !t.isLocal && t.micStream)
        .map((t) => (
          <RemoteAudio key={t.key} micStream={t.micStream} muted={deafened} />
        ))}
    </>
  );
}
