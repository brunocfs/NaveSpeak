import { apiRequest } from './http.js';

// Sem autenticação - RegisterPage usa isto pra saber, ANTES de desenhar o
// formulário, se precisa exigir/mostrar o campo de convite (INVITE_ONLY no
// .env do servidor, ver server/src/routes/auth.routes.js).
export const getAuthConfig = () => apiRequest('/auth/config');

// "Esqueci minha senha" (ForgotPassPage.jsx) - envia um código de 6 dígitos
// por email. Resposta sempre genérica (o servidor não revela se o
// identificador existe), então não há "sucesso"/"erro" a distinguir aqui.
export const requestPasswordReset = (identifier) =>
  apiRequest('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ identifier }) });

export const resetPassword = (identifier, code, newPassword) =>
  apiRequest('/auth/reset-password', { method: 'POST', body: JSON.stringify({ identifier, code, newPassword }) });
