import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validateBody } from '../middleware/validate.js';
import { appSettingsUpdateSchema } from '../validation/schemas.js';
import { getAppSettings, updateAppSettings } from '../db/appSettings.repo.js';
import { audit } from '../observability/logger.js';

// Configuração GLOBAL da plataforma (hoje só os limites do soundboard) -
// distinto de PATCH /rooms/:roomId/settings (por servidor). Só admin da
// APLICAÇÃO (users.is_admin), mesmo padrão de adminBroadcasts.routes.js.
const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const settings = await getAppSettings();
    return res.json({ settings });
  } catch (err) {
    return next(err);
  }
});

router.patch('/', validateBody(appSettingsUpdateSchema), async (req, res, next) => {
  try {
    const settings = await updateAppSettings(req.body);
    audit('app_settings_updated', { changed_fields: Object.keys(req.body) });
    // Benefício é por usuário: o payload leva só o catálogo, o client refaz GET /users/me.
    if (req.body.turboBenefits) {
      req.app.get('io')?.emit('turbo:catalogChanged', { catalog: settings.turboBenefits, at: new Date().toISOString() });
    }
    return res.json({ settings });
  } catch (err) {
    return next(err);
  }
});

export default router;
