import { backgroundSrc } from '../api/backgrounds.js';
import { getLocalBackground } from './localBackgrounds.js';

// Fundo virtual da webcam (blur / imagem), 100% local: MediaPipe Tasks
// (ImageSegmenter, Apache-2.0) roda em WASM/WebGL no próprio navegador ou
// Electron - nenhum frame sai da máquina. WASM + modelo são servidos de
// client/public/vendor/mediapipe (mesmo esquema do deepfilternet3), então
// funciona offline e sem CDN externo (CSP `script-src 'self'`). A lib em si é
// import dinâmico: só baixa quando alguém realmente liga um fundo.
const MEDIAPIPE_BASE = '/vendor/mediapipe';
const MASK_SOFT_EDGE = [0.3, 0.7]; // confiança <0.3 = fundo, >0.7 = pessoa, entre = borda suave
const FRAME_INTERVAL_MS = 1000 / 30;

// Um segmenter só pra app inteiro (preview + câmera ao vivo). Timestamps vêm
// de performance.now(), monotônico entre os dois usos.
let segmenterPromise = null;
function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { ImageSegmenter, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_BASE);
      const create = (delegate) =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${MEDIAPIPE_BASE}/selfie_segmenter.tflite`, delegate },
          runningMode: 'VIDEO',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      try {
        return await create('GPU');
      } catch {
        return create('CPU'); // sem WebGL2 disponível
      }
    })();
    segmenterPromise.catch(() => {
      segmenterPromise = null; // deixa tentar de novo na próxima vez
    });
  }
  return segmenterPromise;
}

// ref: { source: 'remote', filePath } (padrão do sistema / servidor) ou
// { source: 'local', id } (IndexedDB, ver localBackgrounds.js).
async function loadBackgroundImage(ref) {
  if (ref.source === 'local') {
    const record = await getLocalBackground(ref.id);
    if (!record) throw new Error('Fundo não encontrado neste dispositivo.');
    return createImageBitmap(record.blob);
  }
  const img = new Image();
  img.crossOrigin = 'anonymous'; // sem isso o canvas "suja" e captureStream falha
  img.src = backgroundSrc(ref.filePath);
  await img.decode();
  return img;
}

// { mode: 'none'|'blur'|'image', image: ref|null } (formato salvo em
// Preferências) -> { mode, image: <imagem carregada> } pronto pro processador.
// Lança se a imagem sumiu (fundo padrão apagado pelo admin, etc.).
export async function resolveBackground({ mode, image }) {
  if (mode !== 'image') return { mode };
  return { mode, image: await loadBackgroundImage(image) };
}

function drawCover(ctx, image, w, h) {
  const iw = image.width;
  const ih = image.height;
  const scale = Math.max(w / iw, h / ih);
  ctx.drawImage(image, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
}

// input: MediaStream cru da webcam. background: resultado de resolveBackground
// (mode 'blur' | 'image'). Devolve { stream, stop } - `stream` é o vídeo já
// processado (canvas.captureStream); `stop()` só encerra o processamento, NÃO
// as tracks de `input` (quem abriu a webcam é dono dela).
export async function createBackgroundProcessor(input, background) {
  const segmenter = await getSegmenter();
  const labels = segmenter.getLabels();
  // Modelo com 2+ máscaras (fundo/pessoa): pega a que NÃO é o fundo. Com uma
  // só, ela já é a probabilidade de pessoa.
  const personIndex = labels.length > 1 ? labels.findIndex((l) => !/background/i.test(l)) : 0;

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = input;
  await video.play();

  const w = video.videoWidth;
  const h = video.videoHeight;
  const make = (cw, ch) => Object.assign(document.createElement('canvas'), { width: cw, height: ch });
  const out = make(w, h);
  const outCtx = out.getContext('2d');
  const person = make(w, h);
  const personCtx = person.getContext('2d');
  const maskCanvas = make(1, 1);
  const maskCtx = maskCanvas.getContext('2d');
  let maskImage = null;

  function updateMask(mask) {
    if (maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
      maskCanvas.width = mask.width;
      maskCanvas.height = mask.height;
      maskImage = maskCtx.createImageData(mask.width, mask.height);
    }
    const confidence = mask.getAsFloat32Array();
    const [lo, hi] = MASK_SOFT_EDGE;
    for (let i = 0; i < confidence.length; i++) {
      const a = (confidence[i] - lo) / (hi - lo);
      maskImage.data[i * 4 + 3] = (a < 0 ? 0 : a > 1 ? 1 : a) * 255;
    }
    maskCtx.putImageData(maskImage, 0, 0);
  }

  let stopped = false;
  let lastVideoTime = -1;
  let timer = null;

  function tick() {
    if (stopped) return;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      segmenter.segmentForVideo(video, performance.now(), (result) => {
        updateMask(result.confidenceMasks[personIndex]);
      });

      if (background.mode === 'image') {
        drawCover(outCtx, background.image, w, h);
      } else {
        outCtx.filter = 'blur(14px)';
        outCtx.drawImage(video, -20, -20, w + 40, h + 40); // sobra pra borda não clarear
        outCtx.filter = 'none';
      }
      personCtx.globalCompositeOperation = 'copy';
      personCtx.drawImage(video, 0, 0, w, h);
      personCtx.globalCompositeOperation = 'destination-in';
      personCtx.drawImage(maskCanvas, 0, 0, w, h); // upscale bilinear = borda suave
      outCtx.drawImage(person, 0, 0);
    }
    // setTimeout (não rAF): com a janela em segundo plano rAF congela e a
    // câmera travaria pros outros participantes.
    timer = setTimeout(tick, FRAME_INTERVAL_MS);
  }
  tick();

  return {
    stream: out.captureStream(30),
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      video.srcObject = null;
      background.image?.close?.(); // ImageBitmap (fundo local)
    },
  };
}
