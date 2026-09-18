import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validateBody } from '../middleware/validate.js';
import { backgroundUploadSchema, backgroundIdParamSchema } from '../validation/schemas.js';
import { decodeImageDataUrl } from '../utils/imageUpload.js';
import { getAppSettings } from '../db/appSettings.repo.js';
import {
  listSystemBackgrounds,
  listUserBackgrounds,
  countUserBackgrounds,
  findBackground,
  createBackground,
  deleteBackground,
} from '../db/backgrounds.repo.js';
import { audit } from '../observability/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const MAX_BACKGROUND_BYTES = 2 * 1024 * 1024; // já decodificado, sem o overhead do base64

// Fundos de câmera (virtual background). Padrões do sistema: leitura por
// qualquer logado, escrita só admin da aplicação. Pessoais ("mine"): só
// funcionam com app_settings.user_backgrounds_server_enabled ligado (recurso
// reservado pra plano pago - até lá o upload do usuário fica local no
// dispositivo, ver client/src/utils/localBackgrounds.js).
const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const settings = await getAppSettings();
    const [defaults, mine] = await Promise.all([
      listSystemBackgrounds(),
      settings.userBackgroundsServerEnabled ? listUserBackgrounds(req.user.internalId) : [],
    ]);
    return res.json({
      defaults,
      mine,
      userServerUploadEnabled: settings.userBackgroundsServerEnabled,
      maxUserBackgrounds: settings.userBackgroundsMaxCount,
    });
  } catch (err) {
    return next(err);
  }
});

async function saveBackground(req, res, next, { userId, dir }) {
  try {
    const decoded = decodeImageDataUrl(req.body.image, { maxBytes: MAX_BACKGROUND_BYTES });
    if (decoded.error) return res.status(400).json({ error: decoded.error });

    const id = randomUUID();
    const relativePath = `backgrounds/${dir}/${id}.${decoded.ext}`;
    await fs.mkdir(path.join(UPLOADS_DIR, 'backgrounds', dir), { recursive: true });
    await fs.writeFile(path.join(UPLOADS_DIR, relativePath), decoded.buffer);

    const background = await createBackground({ id, userId, name: req.body.name, filePath: relativePath });
    audit('background_created', { resource_type: 'background', resource_id: id, scope: userId ? 'user' : 'system' });
    return res.status(201).json({ background });
  } catch (err) {
    return next(err);
  }
}

async function removeBackground(req, res, next, userId) {
  try {
    const parsedId = backgroundIdParamSchema.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ error: 'ID de fundo inválido.' });

    const background = await findBackground(parsedId.data, userId);
    if (!background) return res.status(404).json({ error: 'Fundo não encontrado.' });

    await fs.unlink(path.join(UPLOADS_DIR, background.filePath)).catch(() => {});
    await deleteBackground(background.id);
    audit('background_deleted', { resource_type: 'background', resource_id: background.id, scope: userId ? 'user' : 'system' });
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}

router.post('/system', requireAdmin, validateBody(backgroundUploadSchema), (req, res, next) =>
  saveBackground(req, res, next, { userId: null, dir: 'system' })
);
router.delete('/system/:id', requireAdmin, (req, res, next) => removeBackground(req, res, next, null));

// Trava do recurso pago + cota, antes de gravar qualquer coisa em disco.
async function requireServerUploadEnabled(req, res, next) {
  try {
    const settings = await getAppSettings();
    if (!settings.userBackgroundsServerEnabled) {
      return res.status(403).json({ error: 'Upload de fundos no servidor não está disponível.' });
    }
    if ((await countUserBackgrounds(req.user.internalId)) >= settings.userBackgroundsMaxCount) {
      return res.status(400).json({ error: `Limite de ${settings.userBackgroundsMaxCount} fundos atingido.` });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

router.post('/mine', validateBody(backgroundUploadSchema), requireServerUploadEnabled, (req, res, next) =>
  saveBackground(req, res, next, { userId: req.user.internalId, dir: String(req.user.internalId) })
);
router.delete('/mine/:id', (req, res, next) => removeBackground(req, res, next, req.user.internalId));

export default router;
