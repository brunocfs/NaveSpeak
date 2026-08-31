import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validateBody } from '../middleware/validate.js';
import { authRateLimiter } from '../middleware/rateLimit.js';
import { inviteCreateSchema, registrationInviteCodeSchema } from '../validation/schemas.js';
import {
  createInvite,
  listInvites,
  findInviteByCode,
  isInviteUsable,
  revokeInvite,
} from '../db/invites.repo.js';
import { sendInviteEmail } from '../utils/mailer.js';
import { formatTag } from '../utils/discriminator.js';

const router = Router();

function inviteBaseUrl() {
  return (env.APP_BASE_URL || env.CORS_ORIGIN).replace(/\/+$/, '');
}

function inviteLink(code) {
  return `${inviteBaseUrl()}/invite/${code}`;
}

// Rota PÚBLICA (sem requireAuth) - registrada antes do router.use(requireAuth)
// abaixo, então não passa por ele. É o que a tela de cadastro usa para
// validar um /register?invite=CODE (ou a página /invite/:code) antes de o
// usuário preencher o formulário inteiro. Só devolve o mínimo (validade +
// tipo) - nunca o email de destino, quem criou ou os usos restantes, para
// não vazar essa informação a quem só tem o link.
router.get('/check/:code', authRateLimiter, async (req, res, next) => {
  try {
    const parsed = registrationInviteCodeSchema.safeParse(req.params.code);
    if (!parsed.success) return res.json({ valid: false });

    const invite = await findInviteByCode(parsed.data);
    return res.json({ valid: isInviteUsable(invite), type: invite?.type ?? null });
  } catch (err) {
    return next(err);
  }
});

router.use(requireAuth, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const invites = await listInvites();
    return res.json({
      invites: invites.map((i) => ({
        ...i,
        createdByTag: formatTag(i.createdByUsername, i.createdByDiscriminator),
        link: inviteLink(i.code),
        usable: isInviteUsable(i),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/', validateBody(inviteCreateSchema), async (req, res, next) => {
  try {
    const { type, email, maxUses, expiresInDays } = req.body;
    const invite = await createInvite({
      type,
      email,
      maxUses,
      expiresInDays,
      createdBy: req.user.internalId,
    });
    const link = inviteLink(invite.code);

    let emailResult = null;
    if (type === 'email') {
      emailResult = await sendInviteEmail({
        to: email,
        inviteLink: link,
        invitedBy: formatTag(req.user.username, req.user.discriminator),
      });
    }

    return res.status(201).json({ invite: { ...invite, link, usable: true }, email: emailResult });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const parsed = z.string().uuid('ID de convite inválido.').safeParse(req.params.id);
    if (!parsed.success) return res.status(400).json({ error: 'ID de convite inválido.' });

    const revoked = await revokeInvite(parsed.data);
    if (!revoked) return res.status(404).json({ error: 'Convite não encontrado ou já revogado.' });

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

export default router;
