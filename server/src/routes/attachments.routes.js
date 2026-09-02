import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { attachmentUploadRateLimiter } from '../middleware/rateLimit.js';
import { attachmentUploadBodySchema } from '../validation/schemas.js';
import { decodeAttachmentDataUrl } from '../utils/attachmentUpload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/uploads/attachments - mesmo diretório base de avatars/ícones (ver
// users.routes.js/rooms.routes.js), servido estático em /uploads
// (server/src/index.js).
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const ATTACHMENTS_DIR = path.join(UPLOADS_DIR, 'attachments');
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB, já decodificado (sem o overhead do base64)

const router = Router();
router.use(requireAuth);

// Upload de UM arquivo por chamada - o client (MessageInput.jsx) chama isso
// uma vez por arquivo selecionado e junta as referências devolvidas antes de
// mandar a mensagem em si via socket (chat:send/dm:send). O arquivo já fica
// em disco antes de qualquer mensagem existir; se o usuário nunca enviar,
// fica órfão (sem limpeza automática por ora - mesmo trade-off do avatar).
router.post('/', attachmentUploadRateLimiter, validateBody(attachmentUploadBodySchema), async (req, res, next) => {
  try {
    const decoded = decodeAttachmentDataUrl(req.body.fileData, req.body.fileName, {
      maxBytes: MAX_ATTACHMENT_BYTES,
    });
    if (decoded.error) return res.status(400).json({ error: decoded.error });
    const { buffer, mime, safeName } = decoded;

    // Nome em disco sempre <uuid>-<nome sanitizado> - o uuid garante unicidade
    // (dois uploads do mesmo arquivo nunca colidem) e o padrão é o mesmo que
    // attachmentRefSchema valida do lado do socket (schemas.js).
    const fileName = `${randomUUID()}-${safeName}`;
    const relativePath = `attachments/${fileName}`;

    await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOADS_DIR, relativePath), buffer);

    return res.status(201).json({
      path: relativePath,
      name: req.body.fileName,
      size: buffer.length,
      mime,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
