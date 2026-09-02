import { useEffect, useRef } from "react";

// Um <audio> por participante remoto com mic - tocando sempre, INDEPENDENTE
// do tile dele aparecer no grid ou não. Antes o <audio> vivia dentro de
// ParticipantTile: com "esconder quem está sem câmera/tela" ligado
// (VoicePanel.jsx), o tile de quem só tinha o mic aberto desmontava - e junto
// dele o <audio>, cortando o som dessa pessoa até desligar o filtro. Este
// componente é montado UMA VEZ em VoicePanel, sempre com a lista COMPLETA de
// participantes (nunca a filtrada `visibleTiles`), então o áudio nunca
// depende do que está visível.
//
// IMPORTANTE: o <audio autoPlay> é quem garante a reprodução de verdade -
// já era assim antes do volume individual e continua sendo. Uma versão
// anterior deste arquivo tentou tocar direto via
// `createMediaStreamSource -> GainNode -> AudioContext.destination`, SEM
// nenhum elemento de mídia envolvido, pra permitir boost acima de 100% -
// isso quebrou a reprodução geral (ninguém ouvia mais ninguém): um
// AudioContext criado "a seco" fica sujeito a uma política de autoplay bem
// mais restrita do que a de um <audio>/<video> (que o navegador já trata
// como mídia normal desde a primeira interação do usuário na página). O
// `<audio>` nasce e toca; o ganho pra boost é plugado DEPOIS dele, via
// `createMediaElementSource(el)` - o elemento continua sendo a fonte real
// de reprodução, só o volume acima de 1.0 (100%, teto de `el.volume`) passa
// pelo GainNode.
//
// `createMediaElementSource` só pode ser chamado UMA VEZ por elemento
// `<audio>` na vida dele (2ª chamada lança InvalidStateError) - por isso o
// grafo Web Audio é montado com deps `[]` (uma vez, no mount deste
// componente), enquanto `el.srcObject` segue `micStream` à parte: troca de
// stream não recria o elemento, só reatribui a fonte que ele já está
// tocando.
function RemoteAudio({ micStream, muted, volume }) {
  const audioRef = useRef(null);
  const gainRef = useRef(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !micStream) return;
    el.srcObject = micStream;
    el.play?.().catch(() => {});
  }, [micStream]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;

    let audioCtx;
    let source;
    let gainNode;
    try {
      const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextImpl();
      audioCtx.resume?.().catch(() => {});
      source = audioCtx.createMediaElementSource(el);
      gainNode = audioCtx.createGain();
      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      gainRef.current = gainNode;
    } catch {
      // Web Audio indisponível pro boost - o <audio> sozinho já continua
      // tocando normal (só sem ganho acima de 100%), nunca fica mudo à toa.
      return undefined;
    }

    return () => {
      gainRef.current = null;
      try {
        source.disconnect();
        gainNode.disconnect();
        audioCtx.close();
      } catch {
        // AudioContext já pode ter sido fechado - inofensivo.
      }
    };
  }, []);

  // Reaplicado a cada troca de volume/deafen SEM recriar o grafo (evita um
  // corte audível no meio da fala). `muted` (deafened, "Silenciar todos")
  // sempre vence: ganho 0 independente do volume individual escolhido. Sem
  // o GainNode disponível (falha acima), cai no `el.volume` nativo como
  // fallback - satura em 100%, mas nunca fica silencioso à toa.
  useEffect(() => {
    const clamped = Math.min(200, Math.max(0, volume)) / 100;
    if (gainRef.current) {
      gainRef.current.gain.value = muted ? 0 : clamped;
    } else if (audioRef.current) {
      audioRef.current.volume = Math.min(1, muted ? 0 : clamped);
    }
  }, [volume, muted]);

  if (!micStream) return null;
  return <audio ref={audioRef} autoPlay playsInline hidden />;
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
