import { io } from 'socket.io-client';
import { getAccessToken } from './http.js';
import { API_URL } from './config.js';
import { reportClientEvent } from '../observability/telemetry.js';

let socket = null;

// Conexão única e reaproveitada pelo app inteiro. `auth` como função é
// reavaliada a cada tentativa de (re)conexão, então se o access token for
// renovado nesse meio tempo o socket reconecta com o token novo em vez de um
// já expirado.
export function getSocket() {
  if (!socket) {
    // "" || undefined -> undefined: socket.io-client interpreta uri
    // undefined como "mesma origem da página", que é o que queremos em
    // produção (API_URL vazio). Passar "" direto não teria esse efeito.
    socket = io(API_URL || undefined, {
      autoConnect: false,
      auth: (cb) => cb({ token: getAccessToken() }),
    });
    // Falha de conexão (servidor fora, token recusado) - amostrada em telemetry.js.
    socket.on('connect_error', (err) => {
      reportClientEvent('client_websocket_error', {
        error_code: err?.message === 'unauthorized' ? 'WS_UNAUTHORIZED' : 'WS_CONNECT_ERROR',
      });
    });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
}
