// Decodificação/validação de efeito sonoro enviado como data URL base64 -
// mesmo esquema de imageUpload.js (avatar/ícone): nunca confia só no mime que
// o CLIENTE declarou no prefixo "data:audio/...;base64,", os bytes reais
// (magic bytes) é que decidem a extensão gravada em disco. A duração real do
// arquivo (contra app_settings.soundboard_max_duration_ms) é checada à parte
// pela rota, via music-metadata (aqui só valida formato/tamanho).
const MIME_TO_EXT = {
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
};

function detectAudioMime(buffer) {
  // MP3: tag ID3v2 no início, ou direto um frame sync MPEG (11 bits em 1:
  // 0xFF seguido de 3 bits superiores também em 1).
  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return 'audio/wav';
  }
  // EBML - contêiner do WebM (e do Matroska; só aceitamos como WebM aqui).
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'audio/webm';
  }
  return null;
}

// Decodifica e valida um data URL de áudio. Devolve { buffer, mime, ext } em
// caso de sucesso, ou { error: '<mensagem>' } - nunca lança.
export function decodeSoundboardAudioDataUrl(dataUrl, { maxBytes }) {
  const match = /^data:(audio\/(?:mpeg|ogg|wav|webm));base64,(.+)$/.exec(dataUrl ?? '');
  if (!match) return { error: 'Formato de áudio não suportado (use mp3, ogg, wav ou webm).' };

  const [, claimedMime, base64Data] = match;
  let buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch {
    return { error: 'Arquivo de áudio inválido.' };
  }
  if (buffer.length === 0 || buffer.length > maxBytes) {
    return { error: `Arquivo inválido ou maior que ${Math.floor(maxBytes / 1024)}KB.` };
  }

  const actualMime = detectAudioMime(buffer);
  if (!actualMime || actualMime !== claimedMime) {
    return { error: 'O arquivo não é um áudio válido.' };
  }

  return { buffer, mime: actualMime, ext: MIME_TO_EXT[actualMime] };
}
