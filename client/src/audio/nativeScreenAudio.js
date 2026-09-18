import pcmPlayerWorkletPath from './pcmPlayerWorklet.js?url';

// Áudio do compartilhamento de tela capturado NATIVAMENTE pelo Electron
// (Windows, ver electron/screenAudio.js): só da janela escolhida, ou da tela
// inteira sem o áudio do próprio NaveSpeak. O PCM chega por IPC e é tocado
// num worklet -> MediaStreamDestination, virando uma MediaStreamTrack comum
// (mesmo padrão de audio/rnnoise.js: AudioContext próprio, lado de ENVIO).
//
// Devolve a track, ou `null` se a captura nativa não está disponível (fora
// do Windows, build antigo sem a API) - quem chama decide o fallback.
// `track.stop()` também encerra a captura no main e fecha o AudioContext.
export async function startNativeScreenAudio(sourceId) {
  const api = window.naveSpeak?.screenAudio;
  if (!api) return null;
  const id = await api.start(sourceId);
  if (id == null) return null;

  let off = () => {};
  let audioContext;
  try {
    audioContext = new AudioContext({ sampleRate: 48000 });
    await audioContext.audioWorklet.addModule(pcmPlayerWorkletPath);
    await audioContext.resume();
    const node = new AudioWorkletNode(audioContext, 'pcm-player', { outputChannelCount: [2] });
    const destination = audioContext.createMediaStreamDestination();
    node.connect(destination);

    off = api.onChunk((chunkId, chunk) => {
      if (chunkId !== id) return;
      // Cópia própria: o Uint8Array recebido pode ser uma view num buffer maior.
      const copy = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
      node.port.postMessage(copy, [copy]);
    });

    const [track] = destination.stream.getAudioTracks();
    const stopTrack = track.stop.bind(track);
    track.stop = () => {
      stopTrack();
      off();
      api.stop(id);
      audioContext.close().catch(() => {});
    };
    return track;
  } catch (err) {
    off();
    api.stop(id);
    audioContext?.close().catch(() => {});
    throw err;
  }
}
