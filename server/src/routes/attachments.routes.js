import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { attachmentUploadBodySchema } from '../validation/schemas.js';
import { decodeAttachmentDataUrl } from '../utils/attachmentUpload.js';
import { getTurboState } from '../db/users.repo.js';
import { TURBO_LIMITS } from '../utils/turbo.js';
import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { logger } from '../observability/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/uploads/attachments - mesmo diretório base de avatars/ícones (ver
// users.routes.js/rooms.routes.js), servido estático em /uploads
// (server/src/index.js).
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const ATTACHMENTS_DIR = path.join(UPLOADS_DIR, 'attachments');
// Cota diária por usuário - o rate limit sozinho ainda deixava ~86GB/dia.
const DAILY_QUOTA_BYTES = 500 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

// Soma os bytes do dia no Redis (INCRBY + PEXPIRE, mesmo esquema dos rate
// limits de socket). Fail-open se o Redis falhar.
async function exceedsDailyQuota(userId, bytes) {
  const key = `quota:attachments:${userId}`;
  try {
    const total = await redis.incrby(key, bytes);
    if (total === bytes) await redis.pexpire(key, DAY_MS);
    if (total <= DAILY_QUOTA_BYTES) return false;
    await redis.decrby(key, bytes);
    return true;
  } catch {
    return false;
  }
}

const router = Router();
router.use(requireAuth);

// Upload de UM arquivo por chamada - o client (MessageInput.jsx) chama isso
// uma vez por arquivo selecionado e junta as referências devolvidas antes de
// mandar a mensagem em si via socket (chat:send/dm:send). O arquivo já fica
// em disco antes de qualquer mensagem existir; se o usuário nunca enviar,
// fica órfão - startOrphanAttachmentCleanup (abaixo) apaga depois de 24h.
// attachmentUploadRateLimiter roda no index.js, ANTES do parser de body.
router.post('/', validateBody(attachmentUploadBodySchema), async (req, res, next) => {
  try {
    // Teto por usuário (bigUploads), já decodificado, recalculado a cada upload.
    const state = await getTurboState(req.user.internalId);
    const maxBytes = state?.limits.attachmentMaxBytes ?? TURBO_LIMITS.attachmentMaxBytes;
    const decoded = decodeAttachmentDataUrl(req.body.fileData, req.body.fileName, { maxBytes });
    if (decoded.error) {
      const tooBig = decoded.error.includes('maior que');
      return res.status(tooBig ? 413 : 400).json({ error: decoded.error, ...(tooBig && { code: 'attachment_too_large', maxBytes }) });
    }
    const { buffer, mime, safeName } = decoded;
    if (await exceedsDailyQuota(req.user.internalId, buffer.length)) {
      return res.status(429).json({ error: 'Você atingiu o limite diário de envio de arquivos.' });
    }

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

// Apaga anexos com mais de 24h que nenhuma mensagem (canal, DM ou comunicado
// admin) referencia: uploads nunca enviados e arquivos de mensagens
// apagadas. Várias instâncias rodando juntas não conflitam (unlink de
// arquivo já apagado é ignorado).
// ponytail: varre o diretório inteiro e as tabelas sem índice em `path`;
// indexar path/paginar se o volume de anexos crescer muito.
async function cleanupOrphanAttachments() {
  let names;
  try {
    names = await fs.readdir(ATTACHMENTS_DIR);
  } catch {
    return; // diretório ainda não existe
  }
  const cutoff = Date.now() - DAY_MS;
  const candidates = [];
  for (const name of names) {
    const stat = await fs.stat(path.join(ATTACHMENTS_DIR, name)).catch(() => null);
    if (stat?.isFile() && stat.mtimeMs < cutoff) candidates.push(`attachments/${name}`);
  }
  if (candidates.length === 0) return;

  const { rows } = await pool.query(
    `SELECT path FROM message_attachments WHERE path = ANY($1)
     UNION SELECT path FROM private_message_attachments WHERE path = ANY($1)
     UNION SELECT elem->>'path' FROM system_broadcasts, jsonb_array_elements(attachments) elem
       WHERE elem->>'path' = ANY($1)`,
    [candidates]
  );
  const referenced = new Set(rows.map((r) => r.path));
  let removed = 0;
  for (const relativePath of candidates) {
    if (referenced.has(relativePath)) continue;
    await fs.unlink(path.join(UPLOADS_DIR, relativePath)).then(() => removed++, () => {});
  }
  if (removed) logger.info({ event: 'orphan_attachments_removed', count: removed }, 'Orphan attachments removed');
}

export function startOrphanAttachmentCleanup() {
  const run = () =>
    cleanupOrphanAttachments().catch((err) =>
      logger.warn({ event: 'orphan_attachments_cleanup_failed', err }, 'Orphan attachment cleanup failed')
    );
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}

export default router;
