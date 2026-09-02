// Revalidação de `attachments` recebido em chat:send/dm:send (chat.handler.js
// e dm.handler.js) - o payload já passou por attachmentsArraySchema (formato
// de cada item), mas o CONTEÚDO (path apontar pra um arquivo que realmente
// existe, size/mime baterem com o que foi gravado no upload) não pode
// depender só do que o client diz. Reconfere no disco antes de gravar a
// mensagem - assim ninguém referencia um arquivo alheio ou inventa um
// tamanho/mime fake só editando o payload do socket.
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");

// Devolve { attachments } com o `size` real (do fs.stat) em vez do que o
// client mandou, ou { error } se algum path não existir/for inválido.
export async function resolveAttachments(rawAttachments) {
  const resolved = [];
  for (const att of rawAttachments) {
    const absolutePath = path.join(UPLOADS_DIR, att.path);
    // path.join já normaliza ".."; confirma que o resultado continua dentro
    // de UPLOADS_DIR (defesa extra, já que o path também bateu na regex de
    // attachmentRefSchema antes de chegar aqui).
    if (!absolutePath.startsWith(UPLOADS_DIR)) {
      return { error: "Anexo inválido." };
    }
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return { error: "Um dos anexos não foi encontrado. Envie o arquivo novamente." };
    }
    if (!stat.isFile()) {
      return { error: "Anexo inválido." };
    }
    resolved.push({ path: att.path, name: att.name, mime: att.mime, size: stat.size });
  }
  return { attachments: resolved };
}
