import { useEffect, useRef } from "react";

// Um <audio> por participante remoto com mic (ou por compartilhamento de
// tela com áudio) - tocando sempre, INDEPENDENTE do tile dele aparecer no
// grid ou não. Antes o <audio> vivia dentro de ParticipantTile: com
// "esconder quem está sem câmera/tela" ligado (VoicePanel.jsx), o tile de
// quem só tinha o mic aberto desmontava - e junto dele o <audio>, cortando o
// som dessa pessoa até desligar o filtro. Este componente é montado UMA VEZ
// em VoicePanel, sempre com a lista COMPLETA de participantes (nunca a
// filtrada `visibleTiles`), então o áudio nunca depende do que está visível.
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
// fica em 100% (limite nativo de `el.volume`), sem boost. O boost de verdade
// (até 200%) só existe do lado de ENVIO, ver audio/gainStream.js - aplicado
// ANTES de chegar aqui, então este componente nunca precisa saber disso.
function RemoteAudio({ stream, muted, volume, outputDeviceId }) {
  const audioRef = useRef(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    el.play?.().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = Math.min(100, Math.max(0, volume)) / 100;
  }, [volume]);

  // Dispositivo de saída (Preferências > Dispositivos) - aplica IMEDIATO em
  // cada <audio> já tocando, sem precisar recriar nada (diferente de
  // mic/câmera, setSinkId não depende de getUserMedia). `setSinkId` só
  // existe em Chrome/Edge - feature-detect aqui em vez de derrubar quem usa
  // Firefox/Safari; null = deixa no padrão do sistema (nunca chama setSinkId
  // com null, só omite a troca - navegador já começa no padrão sozinho).
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !outputDeviceId || typeof el.setSinkId !== "function") return;
    el.setSinkId(outputDeviceId).catch(() => {
      // Dispositivo salvo pode ter sido desconectado - ignora, fica tocando
      // no padrão do sistema em vez de derrubar o áudio da chamada por isso.
    });
  }, [outputDeviceId]);

  if (!stream) return null;
  return <audio ref={audioRef} autoPlay playsInline muted={muted} hidden />;
}

// `tiles` = personTiles (kind='person') SEM filtro de visibilidade - já vem
// sem o tile local (isLocal), mas filtra de novo aqui por segurança (nunca
// ecoar o próprio mic). `screenAudioTiles` = um item por compartilhamento de
// tela REMOTO que tem áudio (nunca o próprio - o compartilhador não precisa
// se ouvir, o volume dele é de ENVIO, ver setLocalScreenAudioVolume em
// MediaSessionContext.jsx). `deafened` silencia a reprodução de todo mundo
// de uma vez ("Silenciar todos" em VoicePanel), igual já fazia dentro do
// tile. `getUserVolume`/`getScreenAudioVolume` (PreferencesContext) resolvem
// o volume individual - default 100 quando o usuário nunca mexeu no controle.
export default function RemoteAudioPlayers({
  tiles,
  screenAudioTiles = [],
  deafened,
  getUserVolume,
  getScreenAudioVolume,
  // Mute LOCAL por participante (PreferencesContext) - só afeta o MIC (kind
  // 'person'), nunca o áudio de tela compartilhada (esse já tem seu próprio
  // volume individual, ver getScreenAudioVolume - zerar o volume já cobre o
  // mesmo caso de uso ali). `deafened` (silenciar TODOS) sempre vence, mas
  // os dois se combinam sem conflito (OR simples).
  isLocallyMuted,
  // Preferências > Dispositivos - null = padrão do sistema, ver RemoteAudio
  // acima pro porquê de aplicar por elemento em vez de globalmente.
  outputDeviceId,
}) {
  return (
    <>
      {tiles
        .filter((t) => !t.isLocal && t.micStream)
        .map((t) => (
          <RemoteAudio
            key={t.key}
            stream={t.micStream}
            muted={deafened || Boolean(isLocallyMuted?.(t.userId))}
            volume={getUserVolume ? getUserVolume(t.userId) : 100}
            outputDeviceId={outputDeviceId}
          />
        ))}
      {screenAudioTiles.map((t) => (
        <RemoteAudio
          key={t.key}
          stream={t.stream}
          muted={deafened}
          volume={getScreenAudioVolume ? getScreenAudioVolume(t.userId) : 100}
          outputDeviceId={outputDeviceId}
        />
      ))}
    </>
  );
}
