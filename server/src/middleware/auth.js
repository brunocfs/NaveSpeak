import { verifyAccessToken } from '../utils/tokens.js';
import { findUserByPublicId } from '../db/users.repo.js';

// Exige um Bearer token de acesso válido. Preenche req.user = { id, internalId, username }.
// `id` é o public_id (UUID) exposto ao cliente; `internalId` é a PK BIGINT usada
// apenas em FKs/joins no banco. Todas as rotas que devolvem dados de usuário/sala/
// mensagem devem passar por aqui primeiro - nunca confiar em um ID vindo da URL sozinho.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await findUserByPublicId(payload.sub);
    if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

    req.user = {
      id: user.publicId,
      internalId: user.id,
      username: user.username,
      discriminator: user.discriminator,
      status: user.status,
      avatarPath: user.avatarPath,
      isAdmin: user.isAdmin,
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}
