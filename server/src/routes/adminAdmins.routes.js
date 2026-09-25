import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validateBody } from '../middleware/validate.js';
import { userTagSchema, userIdParamSchema } from '../validation/schemas.js';
import { parseTag, formatTag } from '../utils/discriminator.js';
import { findUserByTag, findUserByPublicId, listAdmins, setAdmin } from '../db/users.repo.js';
import { audit } from '../observability/logger.js';

// Quem é admin da APLICAÇÃO (users.is_admin). requireAuth relê is_admin do
// banco a cada request, então promover/remover vale na hora.
const router = Router();
router.use(requireAuth, requireAdmin);

const toPublic = (u) => ({ id: u.publicId, tag: formatTag(u.username, u.discriminator), avatarPath: u.avatarPath });

router.get('/', async (req, res, next) => {
  try {
    const admins = await listAdmins();
    return res.json({ admins: admins.map(toPublic) });
  } catch (err) {
    return next(err);
  }
});

router.post('/', validateBody(userTagSchema), async (req, res, next) => {
  try {
    const { username, discriminator } = parseTag(req.body.tag);
    const target = await findUserByTag(username, discriminator);
    if (!target || target.isSystem) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.isAdmin) return res.status(409).json({ error: 'Esse usuário já é administrador.' });

    const updated = await setAdmin(target.id, true);
    audit('app_admin_granted', { target_user_id: target.publicId });
    return res.json({ admin: toPublic(updated) });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:userId', async (req, res, next) => {
  try {
    const parsed = userIdParamSchema.safeParse(req.params.userId);
    if (!parsed.success) return res.status(400).json({ error: 'ID de usuário inválido.' });
    // Nunca remove a si mesmo - garante que sempre sobra ao menos um admin.
    if (parsed.data === req.user.id) {
      return res.status(400).json({ error: 'Você não pode remover seu próprio acesso de administrador.' });
    }
    const target = await findUserByPublicId(parsed.data);
    if (!target?.isAdmin) return res.status(404).json({ error: 'Administrador não encontrado.' });

    await setAdmin(target.id, false);
    audit('app_admin_revoked', { target_user_id: target.publicId });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
