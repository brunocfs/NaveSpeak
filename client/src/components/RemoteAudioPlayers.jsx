import { useEffect, useRef } from "react";

// Um grafo Web Audio por participante remoto com mic - tocando sempre,
// INDEPENDENTE do tile dele aparecer no grid ou não. Antes o <audio> vivia
// dentro de ParticipantTile: com "esconder quem está sem câmera/tela" ligado
// (VoicePanel.jsx), o tile de quem só tinha o mic aberto desmontava - e junto
// dele o <audio>, cortando o som dessa pessoa até desligar o filtro. Este
// componente é montado UMA VEZ em VoicePanel, sempre com a lista COMPLETA de
// participantes (nunca a filtrada `visibleTiles`), então o áudio nunca
// depende do que está visível.
//
// `volume` (0-200, ver PreferencesContext#getUserVolume) é o volume de
// reprodução INDIVIDUAL desse participante - acima de 100% precisa de
// GANHO de verdade (createMediaStreamSource -> GainNode -> destination),
// `<audio>.volume` sozinho satura em 1.0 (100%) e não amplifica. Mesmo
// padrão de AudioContext por participante que useSpeaking.js já usa pro
// anel de "falando" (aqui é um grafo à parte, só pra reprodução).
function RemoteAudio({ micStream, muted, volume }) {
  const gainRef = useRef(null);

  useEffect(() => {
    const track = micStream?.getAudioTracks?.()[0];
    if (!track) return undefined;

    let audioCtx;
    let source;
    let gainNode;
    try {
      const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextImpl();
      audioCtx.resume?.().catch(() => {});
      source = audioCtx.createMediaStreamSource(new MediaStream([track]));
      gainNode = audioCtx.createGain();
      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      gainRef.current = gainNode;
    } catch {
      // Web Audio indisponível - sem reprodução pra este participante em vez
      // de quebrar o resto da chamada.
      return undefined;
    }

    return () => {
      gainRef.current = null;
      try {
        source.disconnect();
        gainNode.disconnect();
        audioCtx.close();
      } catch {
        // AudioContext já pode ter sido fechado/track parada - inofensivo.
      }
    };
  }, [micStream]);

  // Reaplicado a cada troca de volume/deafen SEM recriar o grafo (evita um
  // corte audível no meio da fala). `muted` (deafened, "Silenciar todos")
  // sempre vence: ganho 0 independente do volume individual escolhido.
  useEffect(() => {
    if (!gainRef.current) return;
    gainRef.current.gain.value = muted ? 0 : Math.min(200, Math.max(0, volume)) / 100;
  }, [volume, muted]);

  return null;
}

// `tiles` = personTiles (kind='person') SEM filtro de visibilidade - já vem
// sem o tile local (isLocal), mas filtra de novo aqui por segurança (nunca
// ecoar o próprio mic). `deafened` silencia a reprodução de todo mundo de
// uma vez ("Silenciar todos" em VoicePanel), igual já fazia dentro do tile.
// `getUserVolume` (PreferencesContext) resolve o volume individual de cada
// `t.userId` - default 100 quando o usuário nunca mexeu no controle.
export default function RemoteAudioPlayers({ tiles, deafened, getUserVolume }) {
  return (
    <>
      {tiles
        .filter((t) => !t.isLocal && t.micStream)
        .map((t) => (
          <RemoteAudio
            key={t.key}
            micStream={t.micStream}
            muted={deafened}
            volume={getUserVolume ? getUserVolume(t.userId) : 100}
          />
        ))}
    </>
  );
}
