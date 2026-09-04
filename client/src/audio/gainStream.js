// Grafo Web Audio simples pra controlar o GANHO de uma track de áudio ANTES
// dela ser enviada (produzida) - usado pelo compartilhamento de tela com
// áudio (MediaSessionContext.jsx), pra quem está compartilhando poder subir/
// descer o volume do áudio do sistema/app sem depender do mixer do SO.
//
// Mesmo padrão de audio/rnnoise.js e audio/noiseGate.js: AudioContext
// próprio, processa a track de ENTRADA e expõe a track processada via
// MediaStreamAudioDestinationNode. Funciona pro lado de ENVIO (a track
// resultante vai pra dentro de sendTransport.produce, WebRTC "de verdade") -
// diferente da tentativa de boost na REPRODUÇÃO documentada em
// RemoteAudioPlayers.jsx, presa a <audio>.volume puro porque ali o destino
// final é sempre um elemento <audio>, não outro producer.
//
// Teto de 200% (ao contrário dos 100% de RemoteAudioPlayers) porque aqui é
// ganho de ENVIO, não de reprodução: áudio de tela costuma sair baixo
// (sistema/app com volume próprio abaixo do mic), então um pouco de boost
// acima do "normal" tem uso real - sem exagerar a ponto de só distorcer.
export async function createGainStream(inputStream, { volume = 100 } = {}) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextCtor();
  const source = audioContext.createMediaStreamSource(inputStream);
  const gainNode = audioContext.createGain();
  gainNode.gain.value = Math.min(200, Math.max(0, volume)) / 100;
  const destination = audioContext.createMediaStreamDestination();
  source.connect(gainNode).connect(destination);

  return {
    stream: destination.stream,
    setVolume(nextVolume) {
      gainNode.gain.value = Math.min(200, Math.max(0, nextVolume)) / 100;
    },
    destroy() {
      source.disconnect();
      gainNode.disconnect();
      audioContext.close().catch(() => {});
    },
  };
}
