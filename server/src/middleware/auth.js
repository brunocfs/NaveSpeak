import { verifyAccessToken } from '../utils/tokens.js';
import { findUserByPublicId } from '../db/users.repo.js';
import { setContext } from '../observability/logger.js';

// Motivo da recusa só pro log (res.locals.log, ver observability/http.js) -
// o cliente continua recebendo a mesma mensagem genérica de sempre.
function deny(res, reasonCode, message) {
  const suspicious = reasonCode === 'token_invalid' || reasonCode === 'user_not_found';
  res.locals.log = {
    event: 'authentication_required',
    reason_code: reasonCode,
    auth_method: 'jwt',
    ...(suspicious ? { level: 'warn', security_relevant: true, throttleKey: reasonCode } : {}),
  };
  return res.status(401).json({ error: message });
}

// Exige um Bearer token de acesso válido. Preenche req.user = { id, internalId, username }.
// `id` é o public_id (UUID) exposto ao cliente; `internalId` é a PK BIGINT usada
// apenas em FKs/joins no banco. Todas as rotas que devolvem dados de usuário/sala/
// mensagem devem passar por aqui primeiro - nunca confiar em um ID vindo da URL sozinho.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return deny(res, 'missing_token', 'Não autenticado.');
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await findUserByPublicId(payload.sub);
    if (!user) return deny(res, 'user_not_found', 'Sessão inválida ou expirada.');

    req.user = {
      id: user.publicId,
      internalId: user.id,
      username: user.username,
      discriminator: user.discriminator,
      status: user.status,
      avatarPath: user.avatarPath,
      isAdmin: user.isAdmin,
    };
    setContext({ user_id: user.publicId });
    return next();
  } catch (err) {
    const reason =
      err?.name === 'TokenExpiredError' ? 'token_expired' : err?.name === 'JsonWebTokenError' ? 'token_invalid' : 'auth_lookup_failed';
    return deny(res, reason, 'Sessão inválida ou expirada.');
  }
}
