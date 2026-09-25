// Volume do próprio microfone (Preferências: micVolume, 0-100) - último
// estágio da cadeia do mic (depois do supressor e do gate, pra não mexer no
// limiar do gate). É CAPTURA, não reprodução: o problema de Web Audio
// documentado em RemoteAudioPlayers.jsx é só com stream remota tocando;
// supressor/gate já usam este mesmo caminho pra montar a track enviada.
// Só atenua (teto 100%) - boost distorceria e aumentaria ruído de fundo.
export async function createMicGainStream(rawStream, volume) {
  const track = rawStream.getAudioTracks()[0];
  if (!track) throw new Error("Stream de microfone sem faixa de áudio.");

  const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextImpl) throw new Error("Web Audio API indisponível neste navegador.");

  const audioCtx = new AudioContextImpl({ sampleRate: 48000 });
  await audioCtx.resume?.().catch(() => {});

  const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
  const gain = audioCtx.createGain();
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(gain);
  gain.connect(dest);

  function setVolume(pct) {
    const v = Math.min(100, Math.max(0, Number(pct) || 0)) / 100;
    // setTargetAtTime em vez de atribuir .value: arrastar o slider não gera
    // estalo (mudança brusca de amplitude).
    gain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
  }
  gain.gain.value = Math.min(100, Math.max(0, Number(volume) || 0)) / 100;

  function destroy() {
    try {
      source.disconnect();
      gain.disconnect();
      dest.disconnect();
      audioCtx.close();
    } catch {
      // Contexto/nós já podem ter sido derrubados - inofensivo.
    }
  }

  return { stream: dest.stream, setVolume, destroy };
}
