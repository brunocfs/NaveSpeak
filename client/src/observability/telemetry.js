// Telemetria de erro do client -> POST /api/client-errors (autenticado, com
// rate limit e schema fechado no servidor). Manda só metadado: tipo do evento,
// código, status, rota NORMALIZADA, request_id do backend, versão, família de
// navegador/SO. Nunca conteúdo de formulário, token, mensagem, áudio/vídeo ou
// estado da aplicação. Amostragem: o mesmo erro sai no máximo 1x por minuto
// (com contagem das repetições) e no máximo 30 relatos por sessão.
import { version as APP_VERSION } from '../../package.json';
import { API_URL } from '../api/config.js';
import { getAccessToken } from '../api/http.js';

const DEDUPE_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_SESSION = 30;
const recent = new Map();
let reportsSent = 0;

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// "/rooms/5f0c.../channels?x=1" -> "/rooms/:id/channels". Segmento com dígito
// (tag de usuário, código de convite) também vira placeholder.
export function normalizePath(path) {
  return String(path ?? '')
    .split('?')[0]
    .replace(UUID_PATTERN, ':id')
    .split('/')
    .map((segment) => (/\d/.test(segment) ? ':param' : segment.replace(/[^\w:.-]/g, '')))
    .join('/')
    .slice(0, 200);
}

function browserFamily(ua) {
  if (/Electron\//.test(ua)) return 'electron';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

function osFamily(ua) {
  if (/Windows/.test(ua)) return 'windows';
  if (/Android/.test(ua)) return 'android';
  if (/iPhone|iPad/.test(ua)) return 'ios';
  if (/Mac OS X/.test(ua)) return 'macos';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

export function reportClientEvent(event, fields = {}) {
  try {
    const token = getAccessToken();
    // Endpoint exige login - erro antes da autenticação não tem pra onde ir.
    if (!token) return;

    const key = [event, fields.error_code, fields.http_status, fields.state, fields.http_route, String(fields.message ?? '').slice(0, 80)].join('|');
    const now = Date.now();
    const previous = recent.get(key);
    if (previous && now - previous.sentAt < DEDUPE_WINDOW_MS) {
      previous.suppressed += 1;
      return;
    }
    if (reportsSent >= MAX_REPORTS_PER_SESSION) return;
    reportsSent += 1;
    recent.set(key, { sentAt: now, suppressed: 0 });

    const ua = navigator.userAgent;
    const body = {
      event,
      app_version: APP_VERSION,
      browser: browserFamily(ua),
      os: osFamily(ua),
      page: normalizePath(window.location.pathname),
      occurrences: 1 + (previous?.suppressed ?? 0),
      ...fields,
    };
    if (body.message) body.message = String(body.message).slice(0, 300);

    fetch(`${API_URL}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch {
    // Telemetria nunca pode quebrar a UI.
  }
}

// Estado agregado de um transport mediasoup-client (send/recv): reporta só
// falha, queda e recuperação - nunca parâmetros ICE/DTLS/SDP.
export function watchTransportState(transport, direction) {
  let previous = transport.connectionState;
  transport.on('connectionstatechange', (state) => {
    if (state === 'failed') {
      reportClientEvent('webrtc_peer_connection_failed', { error_code: 'WEBRTC_TRANSPORT_FAILED', state, transport_direction: direction });
    } else if (state === 'disconnected' || (previous === 'disconnected' && state === 'connected')) {
      reportClientEvent('webrtc_ice_connection_state_changed', { state, transport_direction: direction });
    }
    previous = state;
  });
}
