import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  profileUpdateSchema,
  passwordChangeSchema,
  avatarUploadSchema,
  statusUpdateSchema,
  userIdParamSchema,
} from '../validation/schemas.js';
import {
  findUserByPublicId,
  findUserByEmail,
  isTagTakenByAnotherUser,
  updateProfile,
  updateAvatarPath,
  updatePasswordHash,
  updateUserStatus,
} from '../db/users.repo.js';
import { formatTag } from '../utils/discriminator.js';
import { countCommonRooms } from '../db/rooms.repo.js';
import { findExistingFriendship } from '../db/friends.repo.js';
import { revokeAllRefreshTokensForUser } from '../db/refreshTokens.repo.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { issueSession } from './auth.routes.js';
import { setPreference } from '../sockets/onlineStore.js';
import { broadcastUserStatus } from '../sockets/presenceBroadcast.js';
import { decodeImageDataUrl } from '../utils/imageUpload.js';
import { audit } from '../observability/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/uploads/avatars - fora de src/, ao lado de package.json (ver
// pasta "uploads" servida estaticamente em index.js). Gitignored: são
// arquivos enviados por usuário, não conteúdo do repositório.
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const AVATAR_DIR = path.join(UPLOADS_DIR, 'avatars');
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB, já decodificado (sem o overhead do base64)

function toPublicProfile(user) {
  return {
    id: user.publicId,
    username: user.username,
    // Identificador público único (username sozinho pode se repetir entre
    // contas, ver discriminator em db/users.repo.js) - é o que o usuário
    // compartilha para receber pedido de amizade (friends.routes.js).
    tag: formatTag(user.username, user.discriminator),
    isAdmin: Boolean(user.isAdmin),
    email: user.email,
    bio: user.bio ?? '',
    // Caminho relativo - o client monta a URL completa prefixando com
    // API_URL (mesmo padrão do api/http.js). Nunca a URL absoluta aqui: o
    // servidor não sabe (nem deveria decidir) por qual origem o client está
    // acessando (dev vs. produção, ver client/src/api/config.js).
    avatarUrl: user.avatarPath ? `/uploads/${user.avatarPath}` : null,
    // Caminho relativo cru (sem o prefixo /uploads) - é o formato que o
    // componente Avatar.jsx usa em toda a aplicação (mensagens, amigos,
    // membros, roster de voz); avatarUrl acima continua só pro preview
    // grande desta própria tela (ver ProfilePage.jsx).
    avatarPath: user.avatarPath,
    status: user.status,
    // TURBO: nameStyle aqui é o salvo (cru) pro editor do próprio usuário -
    // pra terceiros só sai via publicNameStyleSql / publicCard abaixo.
    isTurbo: user.isTurbo,
    turboUntil: user.turboUntil,
    canStyleName: user.canStyleName,
    nameStyle: user.nameStyle ?? {},
    showCommonServers: user.showCommonServers,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

// Cartão público (preview de perfil): sem email/status/datas; nameStyle só
// com o benefício TURBO ativo (ou conta do sistema).
function publicCard(user) {
  return {
    id: user.publicId,
    username: user.username,
    tag: formatTag(user.username, user.discriminator),
    avatarPath: user.avatarPath,
    bio: user.bio ?? '',
    isTurbo: user.isTurbo,
    nameStyle: user.isSystem || user.canStyleName ? user.nameStyle : {},
  };
}

const router = Router();
router.use(requireAuth);

router.get('/me', async (req, res, next) => {
  try {
    const user = await findUserByPublicId(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json({ user: toPublicProfile(user) });
  } catch (err) {
    return next(err);
  }
});

// Campos "comuns" de perfil - PATCH parcial: só os campos presentes no corpo
// são alterados (ver profileUpdateSchema e updateProfile).
router.patch('/me', validateBody(profileUpdateSchema), async (req, res, next) => {
  try {
    const { username, email, bio, nameStyle, showCommonServers } = req.body;

    // Estilo do nome é benefício TURBO - checado aqui (não só escondendo o
    // editor no client).
    if (nameStyle !== undefined) {
      const me = await findUserByPublicId(req.user.id);
      if (!me?.canStyleName) {
        return res.status(403).json({ error: 'Personalizar o nome é um benefício TURBO.' });
      }
    }

    // Username sozinho PODE se repetir entre contas (ver discriminator em
    // db/users.repo.js) - trocar de username não muda o discriminator já
    // atribuído, só checamos que a combinação (novo username, discriminator
    // ATUAL do usuário) não colide com outra conta. Extremamente raro (o
    // discriminator é aleatório), mas o índice único do banco
    // (uq_users_username_discriminator) reforça isso de qualquer forma -
    // esta checagem só existe para devolver um erro amigável em vez de
    // deixar estourar como erro 500.
    if (username !== undefined) {
      const taken = await isTagTakenByAnotherUser(username, req.user.discriminator, req.user.internalId);
      if (taken) {
        return res.status(409).json({ error: 'Esse username com sua tag atual já está em uso - tente outro username.' });
      }
    }
    let emailChanged = false;
    if (email !== undefined) {
      const existing = await findUserByEmail(email);
      if (existing && existing.id !== req.user.internalId) {
        return res.status(409).json({ error: 'Email já está em uso.' });
      }
      emailChanged = !existing;
    }

    const updated = await updateProfile(req.user.internalId, { username, email, bio, nameStyle, showCommonServers });
    if (emailChanged) audit('email_changed', { user_id: req.user.id });
    return res.json({ user: toPublicProfile(updated) });
  } catch (err) {
    return next(err);
  }
});

// Troca de status de presença (seletor no cabeçalho - ver
// StatusSelector.jsx). Persiste no banco (sobrevive a reconexão/reinício) e
// espelha na hora no Redis (onlineStore.setPreference) pra não esperar o
// próximo reconnect do socket propagar - broadcastUserStatus já emite o
// status PÚBLICO (invisível vira offline pra quem não é o dono) pros
// servidores e amigos do usuário.
router.patch('/me/status', validateBody(statusUpdateSchema), async (req, res, next) => {
  try {
    const updated = await updateUserStatus(req.user.internalId, req.body.status);
    if (!updated) return res.status(404).json({ error: 'Usuário não encontrado.' });

    await setPreference(req.user.id, req.body.status);
    await broadcastUserStatus(req.app.get('io'), req.user);

    return res.json({ status: updated.status });
  } catch (err) {
    return next(err);
  }
});

router.put('/me/password', validateBody(passwordChangeSchema), async (req, res, next) => {
  try {
    const user = await findUserByPublicId(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const valid = await verifyPassword(req.body.currentPassword, user.password_hash);
    if (!valid) {
      audit('password_change_failed', { outcome: 'failure', user_id: req.user.id, reason_code: 'invalid_current_password' });
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }

    const passwordHash = await hashPassword(req.body.newPassword);
    await updatePasswordHash(user.id, passwordHash);

    // Trocar a senha revoga TODAS as sessões existentes (refresh tokens de
    // qualquer dispositivo/aba) - um vazamento de sessão antigo deixa de
    // valer a partir daqui. Emite uma sessão nova só para quem acabou de
    // trocar, pra não deslogar a própria aba no ato (mesmo fluxo de
    // login/registro, ver issueSession em auth.routes.js).
    await revokeAllRefreshTokensForUser(user.id);
    audit('password_changed', { user_id: user.publicId, sessions_revoked: true });
    const accessToken = await issueSession(res, user);

    return res.json({ accessToken, user: { id: user.publicId, username: user.username } });
  } catch (err) {
    return next(err);
  }
});

router.post('/me/avatar', validateBody(avatarUploadSchema), async (req, res, next) => {
  try {
    const decoded = decodeImageDataUrl(req.body.image, { maxBytes: MAX_AVATAR_BYTES });
    if (decoded.error) return res.status(400).json({ error: decoded.error });
    const { buffer, ext } = decoded;

    const user = await findUserByPublicId(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    // Nome de arquivo determinístico (public_id do dono) - reenviar o mesmo
    // formato sobrescreve o arquivo antigo sozinho, sem acumular lixo.
    const relativePath = `avatars/${user.publicId}.${ext}`;

    await fs.mkdir(AVATAR_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOADS_DIR, relativePath), buffer);

    // Se o avatar anterior tinha OUTRA extensão, o arquivo antigo não seria
    // sobrescrito pelo write acima e ficaria órfão no disco - apaga
    // (best-effort: se já não existir, ignora).
    if (user.avatarPath && user.avatarPath !== relativePath) {
      await fs.unlink(path.join(UPLOADS_DIR, user.avatarPath)).catch(() => {});
    }

    const updated = await updateAvatarPath(user.id, relativePath);
    return res.json({ user: toPublicProfile(updated) });
  } catch (err) {
    return next(err);
  }
});

router.delete('/me/avatar', async (req, res, next) => {
  try {
    const user = await findUserByPublicId(req.user.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    if (user.avatarPath) {
      await fs.unlink(path.join(UPLOADS_DIR, user.avatarPath)).catch(() => {});
    }
    const updated = await updateAvatarPath(user.id, null);
    return res.json({ user: toPublicProfile(updated) });
  } catch (err) {
    return next(err);
  }
});

// Preview de perfil (roster de voz etc.). Só pra quem tem relação com o alvo
// (mesmo servidor ou amizade) - fora disso 404, igual a "não existe", pra não
// virar enumeração de contas por UUID.
router.get('/:userId/profile', async (req, res, next) => {
  try {
    const parsed = userIdParamSchema.safeParse(req.params.userId);
    if (!parsed.success) return res.status(400).json({ error: 'ID de usuário inválido.' });

    const target = await findUserByPublicId(parsed.data);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const me = req.user.internalId;
    const isSelf = target.id === me;
    // As duas consultas servem ao mesmo tempo pra autorizar e pra montar o
    // cartão - rodam em paralelo em vez de 2 checagens + 2 buscas em série.
    const [commonCount, friendship] = isSelf
      ? [0, null]
      : await Promise.all([countCommonRooms(me, target.id), findExistingFriendship(me, target.id)]);

    const allowed =
      target.isSystem || isSelf || commonCount > 0 || friendship?.status === 'accepted';
    if (!allowed) return res.status(404).json({ error: 'Usuário não encontrado.' });

    // Privacidade mútua: só mostra se os DOIS deixaram ligado (quem desliga
    // também não vê a dos outros). null = oculto, diferente de 0.
    const commonServers =
      !isSelf && target.showCommonServers && req.user.showCommonServers ? commonCount : null;

    return res.json({
      user: {
        ...publicCard(target),
        createdAt: target.created_at,
        commonServers,
        // incoming = pedido pendente foi feito PELO alvo (eu posso aceitar).
        friendship: friendship
          ? {
              status: friendship.status,
              requestId: friendship.id,
              incoming: friendship.requester_id === target.id,
            }
          : { status: 'none' },
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
