import { verifyAccessToken } from '../utils/tokens.js';

// Exige um Bearer token de acesso válido. Preenche req.user = { id, username }.
// Todas as rotas que devolvem dados de usuário/sala/mensagem devem passar por
// aqui primeiro - nunca confiar em um ID vindo da URL sozinho.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, username: payload.username };
    return next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}
