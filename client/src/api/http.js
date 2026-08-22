// Wrapper de fetch para a API. O access token vive só em memória (nunca em
// localStorage/sessionStorage) - assim um XSS teria que roubar o token do
// heap do processo em execução, não simplesmente ler o storage. O refresh
// token nem chega ao JavaScript: fica em um cookie httpOnly.
import { API_URL } from './config.js';

let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function rawRequest(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  // Todas as rotas de API vivem sob /api no servidor (ver server/src/index.js) -
  // os chamadores passam paths "de negócio" como '/auth/login', '/rooms' etc.
  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers,
    credentials: 'include', // envia/recebe o cookie httpOnly de refresh
  });

  return res;
}

async function tryRefresh() {
  const res = await rawRequest('/auth/refresh', { method: 'POST' });
  if (!res.ok) {
    accessToken = null;
    return false;
  }
  const data = await res.json();
  accessToken = data.accessToken;
  return true;
}

export async function apiRequest(path, options = {}) {
  let res = await rawRequest(path, options);

  if (res.status === 401 && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await rawRequest(path, options);
    }
  }

  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      // resposta sem corpo JSON
    }
    const error = new Error(payload?.error ?? `Erro na requisição (${res.status}).`);
    error.status = res.status;
    error.details = payload?.details;
    throw error;
  }

  if (res.status === 204) return null;
  return res.json();
}
