// Decodificação/validação de anexo de chat enviado como data URL base64 -
// mesmo formato de imageUpload.js (avatar/ícone), mas aceita QUALQUER tipo de
// arquivo (não só imagem), então não dá pra validar por magic bytes um
// formato fixo. A defesa aqui é outra: nunca grava com um nome/extensão que
// o navegador execute inline se alguém abrir o link direto do /uploads
// estático (ver server/src/index.js) - SVG e HTML podem carregar <script>.
const DANGEROUS_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'shtml', 'svg']);

// Note: aceita qualquer "tipo/subtipo" ASCII simples no prefixo, só o
// suficiente pra separar o mime declarado do payload base64 - o mime em si é
// só cosmético (nome exibido/Content-Type do navegador), nunca decide
// permissão nenhuma no server.
const DATA_URL_RE = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

// Mantém só caracteres seguros pra nome de arquivo em disco - qualquer outra
// coisa (separador de path, unicode estranho, etc.) vira "_". O nome final
// gravado é sempre <uuid>-<sanitizado>, então isso aqui é só cosmético
// (aparece pro usuário), nunca decide onde o arquivo é escrito.
function sanitizeFileName(name) {
  const trimmed = (name ?? '').trim().slice(0, 200);
  const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, '_');
  return safe || 'arquivo';
}

function extensionOf(fileName) {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName ?? '');
  return match ? match[1].toLowerCase() : '';
}

// Decodifica e valida um data URL de anexo. Devolve { buffer, mime, safeName }
// em caso de sucesso, ou { error: '<mensagem>' } - nunca lança.
export function decodeAttachmentDataUrl(dataUrl, fileName, { maxBytes }) {
  const match = DATA_URL_RE.exec(dataUrl ?? '');
  if (!match) return { error: 'Arquivo inválido.' };

  if (DANGEROUS_EXTENSIONS.has(extensionOf(fileName))) {
    return { error: 'Este tipo de arquivo não é permitido como anexo.' };
  }

  const [, mime, base64Data] = match;
  let buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch {
    return { error: 'Arquivo inválido.' };
  }
  if (buffer.length === 0 || buffer.length > maxBytes) {
    return { error: `Arquivo inválido ou maior que ${Math.floor(maxBytes / (1024 * 1024))}MB.` };
  }

  return { buffer, mime, safeName: sanitizeFileName(fileName) };
}
