import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validateBody } from '../middleware/validate.js';
import {
  userIdParamSchema,
  adminBanSchema,
  turboGrantSchema,
  turboRevokeSchema,
  turboBenefitsSchema,
} from '../validation/schemas.js';
import { formatTag } from '../utils/discriminator.js';
import {
  findUserByPublicId,
  listUsersPage,
  setBan,
  banMessage,
  grantTurbo,
  revokeTurbo,
  setTurboBenefits,
} from '../db/users.repo.js';
import { revokeAllRefreshTokensForUser } from '../db/refreshTokens.repo.js';
import { listOnlineUserIds } from '../sockets/onlineStore.js';
import { listUsersInVoice } from '../sockets/voicePresence.js';
import { audit } from '../observability/logger.js';

// Usuários da plataforma + moderação (ban/bloqueio/desconexão). Por
// privacidade só expõe SE o usuário está em voz e o TIPO (servidor/chamada),
// nunca qual canal nem com quem.
const router = Router();
router.use(requireAuth, requireAdmin);

const PAGE_SIZE = 50;

// Encerra todas as sessões: sem refresh token o client não renova, e o
// evento faz o client deslogar na hora antes dos sockets caírem.
// ponytail: kick sem ban não invalida o access token já emitido (vale até
// expirar); o client descarta ao receber account:forceLogout.
async function forceLogout(io, target, message) {
  await revokeAllRefreshTokensForUser(target.id);
  io.to(`user:${target.publicId}`).emit('account:forceLogout', { message });
  io.in(`user:${target.publicId}`).disconnectSockets(true);
}

// Alvo válido de moderação: existe, não é o próprio admin, nem conta do
// sistema, nem outro admin (remover o admin antes).
// Devolve o usuário ou null (já respondendo o erro).
async function loadTarget(req, res) {
  const fail = (status, error) => {
    res.status(status).json({ error });
    return null;
  };
  const parsed = userIdParamSchema.safeParse(req.params.userId);
  if (!parsed.success) return fail(400, 'ID de usuário inválido.');
  if (parsed.data === req.user.id) return fail(400, 'Você não pode moderar a própria conta.');
  const target = await findUserByPublicId(parsed.data);
  if (!target || target.isSystem) return fail(404, 'Usuário não encontrado.');
  if (target.isAdmin) return fail(400, 'Remova o acesso de administrador antes.');
  return target;
}

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const q = String(req.query.q ?? '').trim().slice(0, 32);
    const onlineIds = await listOnlineUserIds();
    const inVoice = await listUsersInVoice();

    const { users, total } = await listUsersPage({
      q,
      publicIds: req.query.online === '1' ? onlineIds : null,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });

    const online = new Set(onlineIds);
    return res.json({
      total,
      pageSize: PAGE_SIZE,
      users: users.map((u) => ({
        id: u.publicId,
        tag: formatTag(u.username, u.discriminator),
        avatarPath: u.avatarPath,
        createdAt: u.created_at,
        isAdmin: u.isAdmin,
        online: online.has(u.publicId),
        voice: inVoice.get(u.publicId) ?? null,
        isBanned: u.isBanned,
        bannedUntil: u.bannedUntil,
        banReason: u.banReason,
        isTurbo: u.isTurbo,
        turboUntil: u.turboUntil,
        turboBenefits: u.turboBenefits,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:userId/ban', validateBody(adminBanSchema), async (req, res, next) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return undefined;

    const { reason, durationHours } = req.body;
    const until = durationHours ? new Date(Date.now() + durationHours * 3600_000) : 'infinity';
    const updated = await setBan(target.id, { until, reason: reason || null });
    await forceLogout(req.app.get('io'), target, banMessage(updated));

    audit(durationHours ? 'user_suspended' : 'user_banned', { target_user_id: target.publicId, duration_hours: durationHours });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:userId/ban', async (req, res, next) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return undefined;

    await setBan(target.id, { until: null });
    audit('user_unbanned', { target_user_id: target.publicId });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/:userId/disconnect', async (req, res, next) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return undefined;

    await forceLogout(req.app.get('io'), target, 'Sua sessão foi encerrada por um administrador.');
    audit('user_force_disconnected', { target_user_id: target.publicId });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// TURBO não é moderação: vale pra qualquer conta (inclusive admin e o
// próprio admin), só nunca pra conta do sistema (filtrado no repo).
router.post('/turbo', validateBody(turboGrantSchema), async (req, res, next) => {
  try {
    const { userIds, days } = req.body;
    const updated = await grantTurbo(userIds, days);
    audit('turbo_granted', { target_user_ids: updated, days });
    return res.json({ ok: true, updated: updated.length });
  } catch (err) {
    return next(err);
  }
});

router.post('/turbo/revoke', validateBody(turboRevokeSchema), async (req, res, next) => {
  try {
    const updated = await revokeTurbo(req.body.userIds);
    audit('turbo_revoked', { target_user_ids: updated });
    return res.json({ ok: true, updated: updated.length });
  } catch (err) {
    return next(err);
  }
});

router.put('/:userId/turbo-benefits', validateBody(turboBenefitsSchema), async (req, res, next) => {
  try {
    const parsed = userIdParamSchema.safeParse(req.params.userId);
    if (!parsed.success) return res.status(400).json({ error: 'ID de usuário inválido.' });
    const updated = await setTurboBenefits(parsed.data, req.body);
    if (!updated) return res.status(404).json({ error: 'Usuário não encontrado.' });
    audit('turbo_benefits_updated', { target_user_id: parsed.data, benefits: req.body });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
