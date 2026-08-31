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
import { revokeAllRefreshTokensForUser } from '../db/refreshTokens.repo.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { issueSession } from './auth.routes.js';
import { setPreference } from '../sockets/onlineStore.js';
import { broadcastUserStatus } from '../sockets/presenceBroadcast.js';
import { decodeImageDataUrl } from '../utils/imageUpload.js';

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
    createdAt: user.created_at,
    updatedAt: user.updated_at,
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
    const { username, email, bio } = req.body;

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
    if (email !== undefined) {
      const existing = await findUserByEmail(email);
      if (existing && existing.id !== req.user.internalId) {
        return res.status(409).json({ error: 'Email já está em uso.' });
      }
    }

    const updated = await updateProfile(req.user.internalId, { username, email, bio });
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
    if (!valid) return res.status(401).json({ error: 'Senha atual incorreta.' });

    const passwordHash = await hashPassword(req.body.newPassword);
    await updatePasswordHash(user.id, passwordHash);

    // Trocar a senha revoga TODAS as sessões existentes (refresh tokens de
    // qualquer dispositivo/aba) - um vazamento de sessão antigo deixa de
    // valer a partir daqui. Emite uma sessão nova só para quem acabou de
    // trocar, pra não deslogar a própria aba no ato (mesmo fluxo de
    // login/registro, ver issueSession em auth.routes.js).
    await revokeAllRefreshTokensForUser(user.id);
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

export default router;
