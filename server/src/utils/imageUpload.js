// Decodificação/validação de imagem enviada como data URL base64 (avatar de
// usuário, ícone de servidor) - compartilhado para as duas rotas nunca
// divergirem na regra de "o que é um arquivo de imagem válido aqui".
const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Assinatura (magic bytes) de cada formato aceito - nunca confia só no
// prefixo "data:image/...;base64," que o CLIENTE informou: um arquivo
// renomeado poderia declarar qualquer mime ali. Os bytes reais é que decidem
// a extensão gravada em disco.
function detectImageMime(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 3) === 'GIF' && buffer[3] === 0x38) {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

// Decodifica e valida um data URL de imagem. Devolve { buffer, ext } em caso
// de sucesso, ou { error: '<mensagem>' } - nunca lança, para o chamador só
// responder 400 com a mensagem.
export function decodeImageDataUrl(dataUrl, { maxBytes }) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl ?? '');
  if (!match) return { error: 'Formato de imagem não suportado.' };

  const [, claimedMime, base64Data] = match;
  let buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch {
    return { error: 'Imagem inválida.' };
  }
  if (buffer.length === 0 || buffer.length > maxBytes) {
    return { error: `Imagem inválida ou maior que ${Math.floor(maxBytes / (1024 * 1024))}MB.` };
  }

  const actualMime = detectImageMime(buffer);
  if (!actualMime || actualMime !== claimedMime) {
    return { error: 'O arquivo não é uma imagem válida.' };
  }

  return { buffer, ext: MIME_TO_EXT[actualMime] };
}
