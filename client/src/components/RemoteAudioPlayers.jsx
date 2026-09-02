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
// Volume individual via `el.volume` puro - DE PROPÓSITO sem Web Audio API.
// Duas tentativas de dar boost acima de 100% via GainNode quebraram a
// reprodução de verdade pra todo mundo: (1) `source -> gain ->
// AudioContext.destination`, sem nenhum <audio> envolvido, silêncio total;
// (2) `<audio>` com stream crua + `createMediaElementSource(el)` plugado
// depois - funcionou, mas só pode ser criado UMA VEZ por elemento (StrictMode
// já mata isso no mount, ver histórico do arquivo); (3) `<audio>` tocando
// uma stream JÁ processada por `source -> gain -> MediaStreamDestination`,
// pra fugir da restrição de (2) - voltou o silêncio total de (1). Nas três,
// qualquer AudioContext criado do zero (mesmo com `.resume()` chamado depois
// do gesto de entrar na chamada) não conseguiu produzir som de verdade
// neste app. `<audio>` puro é o único caminho comprovado - teto de volume
// fica em 100% (limite nativo de `el.volume`), sem boost.
function RemoteAudio({ micStream, muted, volume }) {
  const audioRef = useRef(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !micStream) return;
    el.srcObject = micStream;
    el.play?.().catch(() => {});
  }, [micStream]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = Math.min(100, Math.max(0, volume)) / 100;
  }, [volume]);

  if (!micStream) return null;
  return <audio ref={audioRef} autoPlay playsInline muted={muted} hidden />;
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
