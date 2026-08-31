import { apiRequest } from './http.js';

// Sem autenticação - RegisterPage usa isto pra saber, ANTES de desenhar o
// formulário, se precisa exigir/mostrar o campo de convite (INVITE_ONLY no
// .env do servidor, ver server/src/routes/auth.routes.js).
export const getAuthConfig = () => apiRequest('/auth/config');
