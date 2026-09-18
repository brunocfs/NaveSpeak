import { createBackgroundProcessor, resolveBackground } from '../utils/backgroundProcessor.js';
import { startNativeScreenAudio } from '../audio/nativeScreenAudio.js';

// Abstrai a captura de tela entre o navegador comum e o app Electron.
//
// No Electron, `getDisplayMedia` não funciona por padrão dentro de um
// BrowserWindow - por isso o processo main expõe (via preload, com
// contextBridge) uma lista de fontes de tela/janela através de
// `desktopCapturer`, e aqui montamos a stream com os constraints específicos
// do Chromium (`chromeMediaSourceId`). O preload NUNCA expõe o módulo
// `desktopCapturer` inteiro ao renderer, só essa função de listagem
// filtrada - ver electron/preload.js (Fase 5).
export function isElectron() {
  return typeof window !== 'undefined' && Boolean(window.naveSpeak?.getScreenSources);
}

// Câmera, microfone e captura de tela só ficam disponíveis em "contextos
// seguros" (https:// ou localhost) - fora do Electron, o navegador nem
// expõe navigator.mediaDevices em outros casos (ex.: http://<ip> puro),
// o que rendia um TypeError críptico ("Cannot read properties of undefined
// (reading 'getUserMedia')") em vez de uma mensagem que explica o motivo.
function assertMediaDevicesAvailable() {
  if (isElectron()) return; // Electron sempre roda em contexto "seguro" (protocolo file/app)
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Seu navegador bloqueou o acesso a câmera/microfone/tela porque esta página não está em ' +
        'HTTPS nem em localhost. Isso é uma exigência de segurança do navegador, não um bug do app.'
    );
  }
}

// Presets de qualidade pro compartilhamento de tela - usados pelo
// <ScreenSourcePicker> (seleção do usuário) e por requestScreenStream/
// MediaSessionContext (aplicar os constraints/bitrate escolhidos). Um só
// lugar de verdade pra resolução/fps/bitrate sugerido, pra picker e captura
// nunca ficarem dessincronizados.
export const SCREEN_RESOLUTIONS = [
  { value: '720p', label: '720p', width: 1280, height: 720 },
  { value: '1080p', label: '1080p', width: 1920, height: 1080 },
  { value: '1440p', label: '1440p', width: 2560, height: 1440 },
];
export const SCREEN_FRAMERATES = [15, 30, 60];
export const DEFAULT_SCREEN_QUALITY = { resolution: '1080p', frameRate: 30 };

const SCREEN_BITRATE_SUGGESTIONS_KBPS = {
  '720p:15': 1000, '720p:30': 1500, '720p:60': 2500,
  '1080p:15': 1500, '1080p:30': 2500, '1080p:60': 4000,
  '1440p:15': 2500, '1440p:30': 4000, '1440p:60': 6000,
};

// Bitrate sugerido (kbps) pra combinação resolução+fps - ponto de partida
// razoável quando o usuário não mexe nas configurações avançadas.
export function suggestScreenBitrateKbps(resolution, frameRate) {
  return SCREEN_BITRATE_SUGGESTIONS_KBPS[`${resolution}:${frameRate}`] ?? 3000;
}

export async function listScreenSources() {
  if (!isElectron()) return null;
  return window.naveSpeak.getScreenSources();
}

// Lista os microfones/webcams disponíveis (Preferências > Dispositivos e
// fallback em joinVoice/shareCamera abaixo). Sem permissão concedida ainda,
// o navegador devolve os dispositivos mas com `label` vazio (só o deviceId
// existe) - quem chama decide se pede permissão antes pra mostrar nomes.
export async function listMediaDevices() {
  assertMediaDevicesAvailable();
  const list = await navigator.mediaDevices.enumerateDevices();
  return {
    mics: list.filter((d) => d.kind === 'audioinput'),
    cameras: list.filter((d) => d.kind === 'videoinput'),
    // Dispositivos de SAÍDA (alto-falante/fone) - só populam de verdade em
    // navegadores com setSinkId (Chrome/Edge); em quem não tem, a lista
    // normalmente já vem vazia sozinha (o browser não lista o que não pode
    // trocar), mas o filtro por `kind` não muda - ver RemoteAudioPlayers.jsx
    // pra onde isso realmente é aplicado.
    speakers: list.filter((d) => d.kind === 'audiooutput'),
  };
}

// Suporte a trocar o dispositivo de SAÍDA de áudio (HTMLMediaElement.setSinkId)
// - Chrome/Edge têm, Firefox/Safari não (em setembro de 2026). Checado uma
// vez só e reaproveitado - `'setSinkId' in HTMLMediaElement.prototype` é
// barato mas não precisa ser refeito toda hora.
export const supportsAudioOutputSelection =
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

// Pede microfone+câmera só para o navegador liberar os `label` reais dos
// dispositivos em enumerateDevices (fica vazio até alguma permissão de
// mídia ser concedida) - chamado a partir de um clique explícito no botão
// "Permitir acesso" da tela de Preferências, nunca sozinho. Encerra as
// tracks imediatamente: aqui só queremos o rótulo, não uma captura viva.
// Pede os dois tipos separado porque uma máquina sem webcam (ou sem
// permissão de câmera) não pode derrubar a liberação do microfone, e
// vice-versa.
export async function unlockDeviceLabels() {
  assertMediaDevicesAvailable();
  const results = { mic: false, camera: false };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    results.mic = true;
  } catch {
    // Sem permissão/sem microfone - segue com a câmera mesmo assim.
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
    results.camera = true;
  } catch {
    // Idem, sem câmera.
  }
  return results;
}

// Tenta os constraints pedidos (com deviceId exato, quando informado) e,
// se o dispositivo salvo não existir mais (desconectado, driver removido -
// `OverconstrainedError`/`NotFoundError`), refaz a captura com o padrão do
// sistema em vez de derrubar a chamada. `fellBack` avisa quem chamou que a
// preferência salva não pôde ser usada desta vez.
async function getStreamWithFallback(constraints, fallbackConstraints) {
  try {
    return { stream: await navigator.mediaDevices.getUserMedia(constraints), fellBack: false };
  } catch (err) {
    if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') {
      const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      return { stream, fellBack: true };
    }
    throw err;
  }
}

// Usado por joinVoice (MediaSessionContext) ao entrar na voz - reaproveita
// o microfone salvo em Preferências, com fallback para o padrão do sistema.
//
// `noiseSuppressionMode` (Preferências > Áudio, ver PreferencesContext) só
// decide o constraint NATIVO `noiseSuppression` do WebRTC:
// - 'native': liga o supressor nativo do navegador (comportamento de sempre).
// - 'off'/'rnnoise'/'gtcrn'/'deepfilternet': desliga - nesses modos o
//   processamento de verdade acontece depois, via WASM (ver audio/rnnoise.js,
//   audio/gtcrn.js e audio/deepfilternet.js), e rodar os dois juntos só
//   arriscaria artefato (um supressor "limpando" o que o outro já mexeu).
// echoCancellation/autoGainControl ficam sempre ligados - não são o alvo
// deste controle e desligá-los não tem bom motivo de UX aqui.
function micAudioConstraints(deviceId, noiseSuppressionMode) {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: noiseSuppressionMode === "native",
  };
}

export async function requestMicStream(deviceId, { noiseSuppressionMode = "native" } = {}) {
  assertMediaDevicesAvailable();
  return getStreamWithFallback(
    { audio: micAudioConstraints(deviceId, noiseSuppressionMode) },
    { audio: micAudioConstraints(null, noiseSuppressionMode) }
  );
}

// `withAudio`: pede áudio junto com o vídeo da captura de tela.
// - Electron/Windows: captura NATIVA (ver electron/screenAudio.js e
//   audio/nativeScreenAudio.js) via Process Loopback do WASAPI - janela: só o
//   áudio do processo dela; tela inteira: sistema sem o áudio do próprio
//   NaveSpeak (sem eco, e quem compartilha continua ouvindo a call). Se a
//   captura nativa não existir (Win10 antigo): tela inteira cai no
//   getDisplayMedia com `loopbackWithMute` (setDisplayMediaRequestHandler em
//   electron/main.js, sistema todo, muta a reprodução local); janela segue só
//   com vídeo + `audioError`, pra não vazar o áudio do sistema todo.
// - Electron fora do Windows: só o caminho `loopbackWithMute` acima (sistema
//   inteiro, sem áudio por janela).
// - Navegador comum: getDisplayMedia({ audio: true }) só faz o Chrome/Edge
//   MOSTRAREM a opção "Compartilhar áudio" no seletor nativo - quem decide
//   de verdade se a track de áudio vem é o usuário ali, não este código
//   (por isso devolve `hasAudio` calculado da stream resultante, não do que
//   foi pedido). Ao compartilhar uma ABA, o Chrome já exclui o áudio da
//   própria aba do NaveSpeak sozinho; ao compartilhar uma janela/tela
//   inteira, o áudio devolvido é do sistema todo (mesmo limite do Electron
//   acima), mas sem a captura AGC/loopbackWithMute daqui.
//
// Devolve `{ stream, hasAudio, audioError? }` - `hasAudio` reflete o que
// REALMENTE veio; `audioError` é um aviso pro usuário (áudio pedido, não veio).
// `resolution`/`frameRate`: escolhidos pelo usuário no <ScreenSourcePicker>
// (ver SCREEN_RESOLUTIONS/SCREEN_FRAMERATES/DEFAULT_SCREEN_QUALITY acima).
export async function requestScreenStream(
  sourceId,
  { withAudio = false, resolution = DEFAULT_SCREEN_QUALITY.resolution, frameRate = DEFAULT_SCREEN_QUALITY.frameRate } = {}
) {
  assertMediaDevicesAvailable();
  const preset = SCREEN_RESOLUTIONS.find((r) => r.value === resolution) ?? SCREEN_RESOLUTIONS[1];
  const videoConstraints = {
    frameRate: { ideal: frameRate, max: frameRate },
    width: { ideal: preset.width, max: preset.width },
    height: { ideal: preset.height, max: preset.height },
    cursor: 'always',
  };

  if (isElectron()) {
    if (!sourceId) throw new Error('Selecione uma janela ou tela para compartilhar.');
    await window.naveSpeak.setPendingScreenSource(sourceId);
    if (withAudio) {
      // Windows: captura nativa (janela -> só o áudio dela; tela -> sistema
      // sem o NaveSpeak), ver startNativeScreenAudio. O vídeo vem à parte,
      // sem áudio nenhum do getDisplayMedia.
      const nativeTrack = await startNativeScreenAudio(sourceId).catch((err) => {
        console.error(err);
        return null;
      });
      if (nativeTrack) {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: false });
          stream.addTrack(nativeTrack);
          return { stream, hasAudio: true };
        } catch (err) {
          nativeTrack.stop();
          throw err;
        }
      }
      // Janela no Windows sem captura nativa: cair no loopback do sistema
      // vazaria o áudio de tudo, não só da janela - segue só com vídeo.
      if (sourceId.startsWith('window:') && navigator.userAgent.includes('Windows')) {
        await window.naveSpeak.setPendingScreenSource(sourceId);
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: false });
        return {
          stream,
          hasAudio: false,
          audioError: 'Não foi possível capturar o áudio dessa janela - compartilhando só o vídeo.',
        };
      }
      // Tela inteira (ou fora do Windows): loopback do sistema como antes.
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: true });
        return { stream, hasAudio: stream.getAudioTracks().length > 0 };
      } catch {
        // Plataforma sem loopback de áudio (fora do Windows, tipicamente) -
        // segue só com vídeo em vez de falhar o compartilhamento inteiro.
        // Precisa marcar a fonte de novo - a tentativa acima já consumiu o
        // pending id guardado no main.
        await window.naveSpeak.setPendingScreenSource(sourceId);
      }
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: false });
    return { stream, hasAudio: false };
  }

  // Navegador comum: isso só deve ser chamado a partir de um gesto explícito
  // do usuário (onClick do botão "Compartilhar tela") - nunca automaticamente
  // ao carregar a página, senão o navegador bloqueia o pedido de permissão.
  // "ideal" (não "exact") nos constraints de vídeo acima - navegador faz
  // melhor esforço sem falhar em telas menores/4K.
  //
  // autoGainControl/noiseSuppression/echoCancellation desligados no áudio:
  // são pensados pra voz de microfone, não pra áudio de sistema/aba - com
  // eles ligados (padrão do Chrome pra QUALQUER captura de áudio) o AGC
  // renormaliza o volume do áudio compartilhado.
  //
  // suppressLocalAudioPlayback: muta a reprodução local do que está sendo
  // capturado (equivalente ao loopbackWithMute do Electron) - sem isso a voz
  // dos outros da call, tocando nas caixas de quem compartilha, volta pra
  // eles como eco. restrictOwnAudio: exclui o áudio do próprio NaveSpeak.
  // windowAudio 'window': ao escolher uma JANELA, pede só o áudio dela em
  // vez do sistema todo (Chrome 141+; navegadores sem suporte ignoram).
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: videoConstraints,
    audio: withAudio
      ? {
          autoGainControl: false,
          noiseSuppression: false,
          echoCancellation: false,
          suppressLocalAudioPlayback: true,
          restrictOwnAudio: true,
        }
      : false,
    windowAudio: 'window',
  });
  return { stream, hasAudio: stream.getAudioTracks().length > 0 };
}

// Reaproveita a webcam salva em Preferências (deviceId), com fallback para
// o padrão do sistema se ela não existir mais - mesma lógica de
// requestMicStream acima.
//
// `background` ({ mode, image }, formato de Preferências > cameraBackground):
// com 'blur'/'image' devolve a stream JÁ processada (utils/backgroundProcessor.js).
// Parar a track dela (`track.stop()`, feito por stopCamera/switchCamera) também
// encerra o processador e a webcam de verdade, por isso o stop é sobrescrito
// abaixo - sem isso a luz da câmera ficaria acesa. Se o fundo não puder ser
// aplicado (imagem sumiu, sem WebGL/WASM), devolve a câmera crua e
// `backgroundError` explica o porquê.
export async function requestCameraStream(deviceId, background) {
  assertMediaDevicesAvailable();
  const result = await getStreamWithFallback(
    { video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false },
    { video: true, audio: false }
  );
  if (!background || background.mode === 'none') return result;

  const raw = result.stream;
  try {
    const processor = await createBackgroundProcessor(raw, await resolveBackground(background));
    const [processed] = processor.stream.getVideoTracks();
    const stopProcessed = processed.stop.bind(processed);
    processed.stop = () => {
      stopProcessed();
      processor.stop();
      raw.getTracks().forEach((t) => t.stop());
    };
    // Webcam desconectada: propaga o 'ended' pra track que o resto do app escuta.
    raw.getVideoTracks()[0].addEventListener('ended', () => {
      processed.stop();
      processed.dispatchEvent(new Event('ended'));
    });
    return { ...result, stream: processor.stream };
  } catch (err) {
    console.error(err);
    return { ...result, backgroundError: 'Não foi possível aplicar o fundo da câmera - usando a câmera normal.' };
  }
}

export { assertMediaDevicesAvailable };
