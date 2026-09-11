# Observabilidade — NaveSpeak

Guia de logs, métricas, traces, health checks, alertas e troubleshooting do
backend (`server/`) e da telemetria de erro do client (`client/`).

> Regra de ouro: **log e métrica carregam metadado, nunca conteúdo.** Nada de
> senha, token, cookie, SDP/ICE/DTLS, mensagem, áudio/vídeo ou corpo de
> requisição. A redaction é central (`server/src/observability/logger.js`),
> mas ela é uma rede de proteção — não passe dado sensível para o logger.

---

## 1. Arquitetura

```
             ┌───────────────────── processo Node (PM2 / systemd) ─────────────────────┐
HTTP ──► requestContext (request_id, trace_id, contexto ALS) ──► rotas ──► errorHandler │
             │        └─ access log único no fim + métricas HTTP                          │
Socket.IO ─► io.use (auth) ─► instrumentConnection (connection_id, captura de erro)        │
             │        └─ handlers ─► mediasoup (eventos de sessão/ICE/DTLS)                │
             │  pg Pool (instrumentPool)   ioredis (instrumentRedis)                       │
             │        └─ logger (Pino) ──► stdout (JSON)    prom-client ──► GET /metrics   │
             │        └─ OpenTelemetry (opcional, preload --import) ──► OTLP               │
             └──────────────────────────────────────────────────────────────────────────┘
stdout ─► PM2 log / journald ─► (opcional) Promtail/Vector/Fluent Bit ─► Loki/Elastic/…
```

| Arquivo | Responsabilidade |
|---|---|
| `observability/logger.js` | Pino, formato, redaction, contexto (AsyncLocalStorage), `audit()`, `shouldLog()` |
| `observability/http.js` | request_id/traceparent, rota normalizada, access log, `/metrics` |
| `observability/errors.js` | `AppError`, `classifyError()` (códigos estáveis), `logError()` (loga uma vez) |
| `observability/metrics.js` | Todas as métricas Prometheus |
| `observability/sockets.js` | Contexto por conexão, ciclo de vida, erro de handler, auth do handshake |
| `observability/health.js` | Readiness com timeout e log só de transição |
| `observability/shutdown.js` | Encerramento gracioso, `uncaughtException`, `unhandledRejection` |
| `observability/otel.js` | Preload opcional do OpenTelemetry |
| `config/db.js` | `instrumentPool`: latência, erro classificado, slow query, pool esgotado |
| `config/redis.js` | `instrumentRedis`: conexão, reconexão, latência/erro por comando |
| `routes/clientErrors.routes.js` | Coleta de erros do client (auth + rate limit + schema fechado) |

Decisões:

- **Logs vão para stdout** (assíncrono, sonic-boom). A infraestrutura coleta; o
  app nunca escreve arquivo de log. Se o coletor cair (EPIPE), o processo
  continua (coberto por teste).
- **Um log por requisição HTTP**, emitido no fim, com o evento específico do
  resultado. Middlewares que conhecem o motivo (auth, permissão, validação,
  rate limit, errorHandler) só preenchem `res.locals.log`.
- **Um erro é logado uma vez**, na camada com contexto. A instrumentação do
  PostgreSQL marca o erro como logado; o `errorHandler`/handler de socket não
  repete. A linha de acesso da requisição continua existindo (com o mesmo
  `request_id`) para dizer *qual requisição* falhou.

---

## 2. Formato e campos padronizados

Todo log de backend é uma linha JSON com, no mínimo:
`timestamp` (ISO 8601 UTC), `level`, `service`, `environment`, `version`,
`event`, `message`.

| Campo | Tipo | Quando |
|---|---|---|
| `event` | snake_case estável | sempre (sem ele: `unspecified_event` — corrija) |
| `message` | texto curto em inglês | sempre, sem dado variável sensível |
| `request_id` | `req-<uuid>` ou `X-Request-Id` válido recebido | requisição HTTP |
| `trace_id` / `span_id` / `parent_span_id` | hex W3C | HTTP (do `traceparent`, do OTel, ou gerado) |
| `connection_id` | id do socket | eventos WebSocket |
| `session_id` | `vs-<uuid>` | sessão de voz |
| `user_id` | UUID público | só depois de autenticado |
| `room_id` / `channel_id` | UUID | quando conhecido e autorizado |
| `operation` | `select_users`, `get`… | PostgreSQL/Redis |
| `resource_type` / `resource_id` | `room`, `role`, `server_invite`… | auditoria |
| `outcome` | `success` \| `failure` \| `denied` \| `invalid_request` | resultados |
| `duration_ms` | número | operações medidas |
| `error_code` | `DB_TIMEOUT`, `TOKEN_INVALID`… | falhas |
| `retryable` | boolean | falhas classificadas |
| `reason_code` | `invalid_password`, `missing_permission`… | negações/falhas |
| `security_relevant` | `true` | eventos de segurança/auditoria |
| `source_ip` / `user_agent` | IP normalizado / UA truncado (200) | HTTP e handshake |
| `suppressed_count` | número | eventos com limite de volume (quantos foram omitidos antes deste) |
| `error` | `{type, message, code?, stack?}` | `stack` só em erro inesperado |

Níveis: `debug` (diagnóstico, desligado em produção), `info` (evento normal
relevante), `warn` (anormal tratado, negação de segurança, degradação),
`error` (operação falhou, processo segue), `fatal` (processo vai sair).
4xx **não** é `error`: validação/404 = `info`; token inválido, 403, 429 = `warn`.

---

## 3. Catálogo de eventos

### HTTP (um por requisição)

| event | nível | significado |
|---|---|---|
| `http_request` | info (debug p/ estático) / warn se lento | requisição concluída |
| `validation_failed` | info | 400/413 — `validation_fields` (nomes) ou `reason_code` |
| `authentication_required` | info / warn (`token_invalid`, `user_not_found`) | 401 — `reason_code`: `missing_token`, `token_expired`, `token_invalid`, `user_not_found`, `auth_lookup_failed`, `missing_refresh_token` |
| `authorization_denied` | warn | 403, ou 404 que esconde falta de acesso — `reason_code`: `missing_permission` (+`permission`), `admin_required`, `not_room_member`, `no_channel_access`, `cannot_remove_owner`, `metrics_access_denied` |
| `not_found` | info | 404 (`http_route: "unmatched"` para rota inexistente) |
| `rate_limit_exceeded` | warn (com limite de volume) | 429 — `limiter`: `auth`, `attachment_upload`, `client_errors` |
| `internal_error` | error | 5xx com exceção — `error.stack` presente se não logado antes |
| `dependency_timeout` | error | 5xx cujo `error_code` termina em `TIMEOUT` |
| `http_request_failed` | error | 5xx sem exceção (ex.: `/api/version` 503) |

Health checks (`/health/*`, `/api/health`) e scrape OK de `/metrics` **não geram log**.

### Autenticação e auditoria (`security_relevant: true`)

| event | notas |
|---|---|
| `login_succeeded` | `user_id`, `auth_method: password` |
| `login_failed` | `reason_code`: `unknown_account`, `invalid_password`, `invalid_identifier`, `account_locked` (limite: 100/min por motivo) |
| `account_locked` | 5ª falha seguida (`too_many_failed_logins`) |
| `logout` | `reason_code`: `session_revoked` / `no_active_session` |
| `session_refreshed` | rotação de refresh token |
| `token_refresh_failed` | refresh token inválido/revogado/**reutilizado** — sinal de roubo |
| `user_registered`, `registration_denied` | `invite_required`, `invalid_invite`, `email_in_use` |
| `invite_accepted` | convite de cadastro usado |
| `password_changed` (`sessions_revoked: true`), `password_change_failed` | |
| `email_changed` | |
| `room_created`, `room_updated`, `server_settings_updated` | `changed_fields` = nomes |
| `room_member_kicked`, `room_member_banned`, `room_member_unbanned` | `target_user_id` |
| `channel_created`, `channel_updated`, `channel_deleted` | |
| `role_created`, `role_updated`, `role_deleted`, `role_assigned`, `role_unassigned` | |
| `server_invite_created`, `server_invite_revoked`, `server_invite_deleted`, `server_invite_accepted`, `server_invite_rejected` | código do convite **nunca** logado |
| `registration_invite_created`, `registration_invite_revoked` | `admin_action: true` |
| `voice_moderation_applied` | `action`: `mute`, `disable_media`, `disconnect`, `move` |
| `authorization_denied` (socket) | moderação sem permissão |
| `websocket_authentication_failed` | handshake recusado |
| `room_join_denied` | negação suspeita (não membro / sem acesso / não participante) |

Não existem no produto hoje (sem evento): MFA, reset de senha por e-mail,
revogação manual de sessão individual.

### WebSocket / voz / WebRTC

| event | nível | campos |
|---|---|---|
| `websocket_connection_opened` | info | `connection_id`, `user_id`, `transport` |
| `websocket_connection_closed` | info | `close_reason`, `duration_ms` |
| `websocket_authentication_succeeded` | debug | |
| `websocket_authentication_failed` | info (expirado) / warn | `reason_code`, `source_ip` |
| `websocket_message_rejected` | warn (limitado) | `reason_code: unknown_event` |
| `websocket_rate_limit_exceeded` | warn (limitado) | `limiter`: `chat_message`, `direct_message` |
| `websocket_handler_failed` | error | `websocket_event`, `error_code`, stack |
| `room_join_requested` | debug | `channel_id` |
| `room_join_succeeded` / `voice_session_started` | info | `session_id`, `channel_id`, `room_id`, `voice_room_type` |
| `room_join_denied` | info / warn (auditoria) | `reason_code` |
| `room_leave` / `voice_session_ended` | info | `reason_code` (`user_left`, `disconnected`, `moderator_disconnect`), `duration_ms`, `producers_closed` |
| `webrtc_transport_created` | debug | `transport_direction` |
| `webrtc_producer_created` / `webrtc_consumer_created` | debug | `media_kind`, `media_source` |
| `webrtc_ice_connection_state_changed` | debug / info (recuperou) | `previous_state`, `new_state` |
| `media_session_degraded` | warn | `reason_code: ice_disconnected` |
| `webrtc_peer_connection_failed` | warn | `reason_code: dtls_failed` |
| `webrtc_negotiation_failed` | error/warn | `stage`: `join`, `create_transport`, `connect_transport`, `produce`, `consume` |

**Sobre `webrtc_offer_created`/`webrtc_answer_created`:** o NaveSpeak usa
mediasoup (SFU). Não há troca de SDP offer/answer no servidor — o
`mediasoup-client` gera SDP localmente a partir de parâmetros. Os equivalentes
são `webrtc_producer_created` (enviar mídia) e `webrtc_consumer_created`
(receber). Reconexão é reportada pelo client como `webrtc_reconnect_attempted`.

Nada é logado por heartbeat, pacote RTP, `media:setScreenViewer`,
`chat:typing` ou mute/unmute — só métricas agregadas.

### PostgreSQL / Redis / processo

| event | nível |
|---|---|
| `database_operation_failed` | warn (retryable) / error — `operation`, `error_code`, `duration_ms` |
| `database_query_slow` | warn — acima de `LOG_SLOW_DB_QUERY_MS` |
| `database_pool_exhausted` | warn (limitado) — `pool_waiting` |
| `database_connection_error` | error — cliente ocioso do pool caiu |
| `redis_connected` / `redis_connection_lost` / `redis_connection_restored` | info / warn / info (só transição) |
| `redis_reconnecting` | warn (limitado) |
| `redis_connection_error` | error (limitado) |
| `redis_command_failed` / `redis_command_slow` | warn (limitado) — `operation` = nome do comando |
| `redis_ephemeral_presence_reset` / `_failed` | info / warn (boot) |
| `readiness_changed` | info/warn — `previous_status`, `new_status`, `checks` |
| `service_started`, `service_startup_failed` (fatal), `configuration_invalid` (fatal) | |
| `service_shutdown_started`, `service_shutdown_step_failed`, `service_shutdown_completed`, `service_shutdown_timeout` | |
| `uncaught_exception`, `unhandled_rejection`, `mediasoup_worker_died` | fatal |
| `invite_email_sent` / `invite_email_skipped` / `invite_email_failed` | |
| `metrics_endpoint_disabled`, `body_logging_enabled` | warn (boot) |

### Client (via `POST /api/client-errors`, `source: "client"`)

`client_render_error`, `client_unhandled_error`, `client_http_error`
(`http_status`, `http_route` normalizada, `related_request_id`),
`client_websocket_error`, `webrtc_ice_connection_state_changed`,
`webrtc_peer_connection_failed`, `webrtc_reconnect_attempted`.
Amostragem no client: mesmo erro no máximo 1×/min (com `occurrences`), no
máximo 30 relatos por sessão; servidor limita 60/10 min por usuário.

---

## 4. Dados proibidos

Nunca em log, métrica, trace ou telemetria do client:

- senha (atual/nova), hash de senha, código MFA;
- access token/JWT, refresh token (nem o hash), cookie, header `Authorization`,
  API key, `METRICS_TOKEN`, segredos do `.env`, chave privada, credenciais TURN/SMTP;
- SDP, ICE candidates, `iceParameters`, `dtlsParameters`, `rtpParameters`,
  fingerprints; áudio, vídeo, frames;
- conteúdo de mensagem (chat/DM), anexos, avatar/ícone em base64;
- corpo completo de requisição/resposta/mensagem WebSocket; SQL com valores;
  chave/valor Redis;
- código/link de convite, e-mail (é mascarado automaticamente), dados de cartão;
- URL com query string.

Redaction automática (camada central):

- **Por chave** (qualquer profundidade, por sufixo normalizado): `password`,
  `secret`, `token`, `apikey`, `privatekey`, `authorization`, `cookie`,
  `credential(s)`, `sdp`, `candidate(s)`, `iceparameters`, `dtlsparameters`,
  `rtpparameters`, `rtpcapabilities`, `cardnumber`, `cvv`, `mfacode`, `otp`,
  `content`, `filedata`, `image`, `icon`, `body`, `headers` + `LOG_REDACT_PATHS`.
- **Por padrão dentro de texto**: JWT, `Bearer/Basic …`, data URL base64, SDP
  (`v=0…`), `candidate:…`, hex ≥ 64 chars, e-mail, `password=…`/`token=…`.
- Caracteres de controle removidos, strings truncadas (2 KB; stack 8 KB),
  profundidade máxima 6, arrays até 50 itens.

---

## 5. Como pesquisar por `request_id` / `trace_id`

O `request_id` volta no header **`X-Request-Id`** de toda resposta e no corpo
de todo 5xx (`{"error": "...", "requestId": "req-..."}`). O client guarda em
`error.requestId` e o envia em `client_http_error` como `related_request_id`.

```bash
# PM2 (stdout vai para ~/.pm2/logs/navespeak-out.log)
jq -c 'select(.request_id == "req-9c1d…")' ~/.pm2/logs/navespeak-out.log
jq -c 'select(.trace_id == "4bf92f3577b34da6a3ce929d0e0e4736")' ~/.pm2/logs/navespeak-out.log
# relato do client que aponta para a requisição que falhou
jq -c 'select(.related_request_id == "req-9c1d…" or .request_id == "req-9c1d…")' ~/.pm2/logs/navespeak-out.log

# systemd
journalctl -u navespeak -o cat --since "1 hour ago" | jq -c 'select(.request_id == "req-9c1d…")'

# Tudo de uma conexão WebSocket / sessão de voz
jq -c 'select(.connection_id == "Xk2…")' ~/.pm2/logs/navespeak-out.log
jq -c 'select(.session_id == "vs-…")' ~/.pm2/logs/navespeak-out.log
```

Loki (LogQL), se houver:

```logql
{service="navespeak-api"} | json | request_id="req-9c1d…"
{service="navespeak-api"} | json | trace_id="4bf92f3577b34da6a3ce929d0e0e4736"
```

Para correlacionar com o Nginx, adicione `proxy_set_header X-Request-Id
$request_id;` no `location /` — o backend aceita o ID (formato validado) e
ele passa a aparecer no access log do Nginx e da aplicação.

---

## 6. Debug temporário

1. `LOG_LEVEL=debug` (e, só se realmente necessário, `LOG_REQUEST_BODY=true`
   e/ou `LOG_RESPONSE_BODY=true`). Corpos só aparecem com nível `debug`, já
   redigidos, e o boot emite `body_logging_enabled` (warn).
2. `pm2 restart navespeak --update-env` (ou `systemctl restart navespeak`).
3. Reproduza, colete pelo `request_id`.
4. **Volte** `LOG_LEVEL=info` e os `LOG_*_BODY=false`; reinicie. Apague/expire
   os logs de debug coletados (retenção ≤ 24 h).

Localmente: `npm run dev:server | npx pino-pretty` (ou `LOG_PRETTY=true` com
`pino-pretty` instalado — proibido em produção).

---

## 7. OpenTelemetry

Desligado por padrão; nenhum SDK é dependência do projeto.

```bash
# 1) instalar o SDK só onde for habilitar (na raiz do monorepo;
#    `npm install --workspace server` falha com o npm 10 deste repo)
npm install @opentelemetry/auto-instrumentations-node

# 2) server/.env
OTEL_ENABLED=true
OTEL_SERVICE_NAME=navespeak-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318   # obrigatório em produção
# opcionais padrão do SDK: OTEL_TRACES_SAMPLER=parentbased_traceidratio, OTEL_TRACES_SAMPLER_ARG=0.1

# 3) iniciar com o preload (já é o script `npm start`)
node --import ./src/observability/otel.js src/index.js
```

PM2 (`ecosystem.config.cjs`): `node_args: "--import ./src/observability/otel.js"`
e `kill_timeout: 12000` (maior que `SHUTDOWN_TIMEOUT_MS`).

O que acontece: HTTP server/client, Express, `pg` e `ioredis` passam a gerar
spans; o `traceparent` de entrada é propagado; `trace_id`/`span_id` dos logs
passam a ser os do span ativo; o exporter recebe `forceFlush`/`shutdown` no
encerramento gracioso. Métricas continuam no `/metrics` e logs no stdout
(`OTEL_METRICS_EXPORTER=none`, `OTEL_LOGS_EXPORTER=none`). Se o pacote não
estiver instalado, o boot emite `otel_initialization_failed` e segue sem trace.

Sem OTel, o middleware HTTP ainda preserva `traceparent` recebido (ou gera um
`trace_id`) — a busca por `trace_id` funciona igual.

---

## 8. Métricas e dashboards

`GET /metrics` (Prometheus). Em produção exige `METRICS_TOKEN`
(`Authorization: Bearer …`); sem token o endpoint responde 404. Bloqueie
também no Nginx (`location = /metrics { deny all; }`) e faça o scrape pela
rede interna/localhost.

| Grupo | Métricas |
|---|---|
| HTTP | `http_requests_total{method,route,status_code}`, `http_request_duration_seconds`, `http_requests_in_flight` |
| WebSocket | `websocket_connections_active`, `websocket_connections_opened_total`, `websocket_connections_closed_total{reason}`, `websocket_auth_failures_total{reason}`, `websocket_messages_rejected_total{reason}`, `websocket_handler_errors_total{event,error_code}` |
| Voz/WebRTC | `voice_sessions_active`, `voice_rooms_active`, `voice_session_duration_seconds{reason}`, `voice_join_denied_total{reason}`, `webrtc_transport_state_changes_total{type,state}`, `webrtc_failures_total{stage}` |
| PostgreSQL | `db_query_duration_seconds{operation}`, `db_errors_total{error_code}`, `db_pool_exhausted_total`, `db_pool_connections{state=total\|idle\|waiting\|max}` |
| Redis | `redis_command_duration_seconds{command}`, `redis_errors_total{client,error_code}`, `redis_reconnects_total{client}`, `redis_connection_up{client}`, `cache_requests_total{cache,result}` |
| Segurança | `security_events_total{event,outcome}`, `rate_limit_exceeded_total{limiter}` |
| Client | `client_events_total{event}` |
| Saúde | `health_check_status{check}` |
| Processo | `process_cpu_seconds_total`, `process_resident_memory_bytes`, `nodejs_heap_size_used_bytes`, `nodejs_eventloop_lag_p99_seconds`, `nodejs_gc_duration_seconds`, `process_start_time_seconds` |

Labels proibidos (teste automatizado): `user_id`, `room_id`, `channel_id`,
`connection_id`, `session_id`, `request_id`, `trace_id`, `url`, `path`,
`message`, `ip`, e qualquer valor com UUID. Rotas usam o padrão
(`/api/rooms/:roomId/channels/:channelId`); rota inexistente vira `unmatched`.

Painéis sugeridos (Grafana) e como ler:

1. **Tráfego e erros** — req/s por rota, % 5xx, p95/p99. 5xx concentrado numa
   rota = bug/dependência daquela rota; espalhado = dependência comum (DB/Redis).
2. **Voz** — `voice_sessions_active`, `voice_rooms_active`, taxa de
   `webrtc_failures_total` por `stage`, ICE `disconnected`. `connect_transport`/
   `dtls` subindo = rede/porta UDP/`MEDIASOUP_ANNOUNCED_IP`; `create_transport` =
   portas RTC esgotadas ou worker.
3. **WebSocket** — conexões ativas, fechamentos por `reason` (`ping_timeout`/
   `transport_close` altos = rede/proxy), falhas de auth por motivo.
4. **Dependências** — p95 de `db_query_duration_seconds` por `operation`,
   `db_pool_connections{state="waiting"}`, `redis_connection_up`, erros por código.
5. **Segurança** — `security_events_total` por evento (login_failed,
   authorization_denied, token_refresh_failed, room_join_denied), 429 por limiter.
6. **Processo** — CPU, RSS, heap, event loop lag p99, reinícios
   (`changes(process_start_time_seconds[1h])`).

---

## 9. Alertas recomendados (PromQL / LogQL)

| Alerta | Expressão | Severidade |
|---|---|---|
| Taxa de 5xx | `sum(rate(http_requests_total{status_code=~"5.."}[5m])) / clamp_min(sum(rate(http_requests_total[5m])), 1) > 0.02` por 5m | page |
| Latência p95 | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{route!~"spa\|unrouted\|/uploads/\\*\|/updates/\\*\|/assets/\\*"}[5m]))) > 1` por 10m | ticket |
| Latência p99 | mesmo com `0.99` e `> 2.5` por 10m | ticket |
| Falhas de login | `sum(increase(security_events_total{event="login_failed"}[10m])) > 50` | page (segurança) |
| Refresh token reutilizado | `sum(increase(security_events_total{event="token_refresh_failed"}[10m])) > 20` | ticket (segurança) |
| Autorização negada | `sum(increase(security_events_total{event=~"authorization_denied\|room_join_denied"}[15m])) > 30` | ticket |
| Falha de auth WebSocket | `sum(rate(websocket_auth_failures_total{reason!="token_expired"}[5m])) > 1` | ticket |
| Quedas de WebSocket | `sum(rate(websocket_connections_closed_total{reason=~"ping_timeout\|transport_close\|transport_error"}[5m])) / clamp_min(sum(websocket_connections_active), 1) > 0.05` | ticket |
| Negociação WebRTC | `sum(increase(webrtc_failures_total[10m])) > 10` | page |
| ICE caindo | `sum(increase(webrtc_transport_state_changes_total{type="ice",state="disconnected"}[10m])) > 20` | ticket |
| Pool PostgreSQL esgotado | `max_over_time(db_pool_connections{state="waiting"}[5m]) > 0` por 5m ou `increase(db_pool_exhausted_total[5m]) > 0` | page |
| Timeout PostgreSQL | `sum(increase(db_errors_total{error_code=~"DB_TIMEOUT\|DB_POOL_TIMEOUT\|DB_CONNECTION_ERROR"}[5m])) > 0` | page |
| Redis indisponível | `min(redis_connection_up{client="main"}) == 0` por 2m | page |
| Pub/Sub do adapter | `min(redis_connection_up{client=~"adapter_.*"}) == 0` por 2m (só multi-instância) | page |
| Readiness | `health_check_status{check="database"} == 0` por 2m | page |
| Event loop bloqueado | `nodejs_eventloop_lag_p99_seconds > 0.2` por 5m | ticket |
| Reinícios | `changes(process_start_time_seconds[1h]) > 2` | ticket |
| Target fora | `up{job="navespeak"} == 0` por 2m | page |
| Ausência de logs | LogQL: `sum(count_over_time({service="navespeak-api"}[10m])) == 0` (ou `absent_over_time`) | page |
| Atraso do pipeline | diferença entre `timestamp` do log e horário de ingestão > 5 min (métrica do coletor) | ticket |
| Filas | não há filas/streams/jobs hoje — ao criar, adicionar tamanho e idade da mensagem mais antiga | — |

---

## 10. Runbooks

### HTTP 5xx

1. Dashboard: rota(s) e início do pico; correlacionar com deploy (`version`).
2. `jq -c 'select(.level=="error" and .http_status_code>=500) | {timestamp,request_id,http_route,error_code,event}' out.log | tail -50`
3. Pegue um `request_id` e veja todas as linhas: se houver
   `database_operation_failed`/`redis_command_failed` antes do `internal_error`,
   siga o runbook da dependência; senão, o `error.stack` do `internal_error`
   aponta o código.
4. `dependency_timeout` = dependência lenta, não bug de código.
5. Usuário mandou print com `requestId`: busque direto por ele.

### Login suspeito / força bruta

1. `jq -c 'select(.event=="login_failed") | {timestamp,source_ip,reason_code,user_id,suppressed_count}' out.log`
2. Muitos `unknown_account` de um IP = enumeração/stuffing; muitos
   `invalid_password` no mesmo `user_id` = ataque direcionado (vai gerar
   `account_locked`). `suppressed_count` > 0 = volume acima de 100/min.
3. Confirme que `TRUST_PROXY=1` está ativo atrás do Nginx (senão `source_ip`
   = 127.0.0.1 e o rate limit por IP vale para todos juntos).
4. Bloqueio no firewall/fail2ban pelo IP; se houver `login_succeeded` do mesmo
   IP após falhas, force troca de senha (revoga sessões).
5. `token_refresh_failed` alto para o mesmo usuário = possível roubo de
   refresh token → trocar senha (revoga todas as sessões).

### Falha de Redis

1. `redis_connection_up`, eventos `redis_connection_lost`/`redis_reconnecting`.
2. `redis-cli -u $REDIS_URL ping`; `systemctl status redis-server`; memória (`INFO memory`).
3. Impacto: presença/roster de voz e rate limit degradam (rate limit é
   fail-open, mas com offline queue os comandos esperam — requisições de login
   podem ficar lentas). Com `ENABLE_REDIS_ADAPTER=true`, chat em tempo real para.
4. `/health/ready` fica `degraded` (continua 200).
5. Após voltar: `redis_connection_restored`; roster fantasma some no próximo
   restart (`redis_ephemeral_presence_reset`).

### Falha de PostgreSQL

1. `db_errors_total` por `error_code`, `db_pool_connections{state="waiting"}`.
2. `DB_CONNECTION_ERROR`/`DB_UNAVAILABLE`: `pg_isready`, `systemctl status postgresql`, disco.
3. `DB_POOL_TIMEOUT`/`database_pool_exhausted`: consultas lentas segurando
   clientes — veja `database_query_slow` por `operation` e `pg_stat_activity`.
4. `DB_DEADLOCK`/`DB_SERIALIZATION_FAILURE`: retryable; investigar só se recorrente.
5. `DB_AUTH_FAILED`: credencial/`pg_hba.conf` alterado.
6. `/health/ready` → 503 (`unavailable`) enquanto o banco estiver fora.

### Problemas de voz/WebRTC

1. Usuário afetado: `jq -c 'select(.user_id=="<uuid>" and (.event|test("room_|voice_|webrtc_|media_")))' out.log`
2. Sequência esperada: `room_join_succeeded` → `voice_session_started` →
   (debug: `webrtc_transport_created` ×2) → … → `voice_session_ended`.
3. `room_join_denied` → permissão/role do canal (`reason_code`).
4. `webrtc_negotiation_failed stage=create_transport` → portas
   `MEDIASOUP_MIN_PORT..MAX_PORT` esgotadas/firewall; `connect_transport` ou
   `webrtc_peer_connection_failed dtls_failed` → UDP bloqueado, NAT,
   `MEDIASOUP_ANNOUNCED_IP` errado.
5. `media_session_degraded ice_disconnected` frequente → rede instável do
   usuário/VPN; cruze com `webrtc_ice_connection_state_changed` do client
   (`source: "client"`) e `webrtc_reconnect_attempted`.
6. `voice_session_ended reason_code=disconnected` com `websocket_connection_closed
   close_reason=ping_timeout` → queda de rede do usuário, não do servidor.
7. `mediasoup_worker_died` (fatal) → processo reinicia; verificar memória/OOM.

---

## 11. Retenção sugerida

| Dado | Retenção | Observação |
|---|---|---|
| Logs de aplicação (info+) | 14–30 dias | PM2 logrotate (`retain 14`) ou coletor |
| Logs de auditoria (`security_relevant: true`) | 90–180 dias | separar stream/índice; acesso restrito |
| Logs de debug / com corpo | ≤ 24 h | apagar após o troubleshooting |
| Telemetria do client | 14 dias | |
| Métricas | 15 dias brutas, 13 meses agregadas | |
| Traces | 7 dias, amostrados | |

LGPD: `user_id`, `source_ip` e `user_agent` são dados pessoais — minimização,
finalidade (segurança/operação), controle de acesso e exclusão no prazo.

---

## 12. Adicionando um evento novo

1. Nome em snake_case, no passado ou estado (`thing_created`, `thing_failed`),
   estável — alertas dependem dele. Adicione ao catálogo acima.
2. Use o que já existe:
   - evento normal: `logger.info({ event, ...ids }, 'Short English message')`
   - segurança/auditoria: `audit('thing_changed', { resource_type, resource_id })`
   - erro: `logError('thing_failed', err, { ...ids }, 'Thing failed')` — respeita "logar uma vez"
   - motivo de resposta HTTP: `res.locals.log = { event, reason_code }` (sem logar direto)
   - volume potencialmente alto: `shouldLog(key)` / `audit(..., { throttleKey })`
3. Campos: IDs e contagens; `error_code` estável; `duration_ms` numérico.
   **Nunca** objeto de request/payload inteiro.
4. Métrica nova: em `observability/metrics.js`, labels de conjunto fechado.
5. Teste: se lida com dado sensível, adicione caso em `server/test/*.test.js`
   provando que o valor não aparece na saída.

---

## 13. Riscos de privacidade e segurança

- Redaction por chave/padrão não pega tudo (ex.: dado pessoal em texto livre
  sem padrão reconhecível). Não logue texto livre de usuário.
- `LOG_REQUEST_BODY`/`LOG_RESPONSE_BODY` aumentam risco — só debug temporário.
- `/metrics` e `/health/ready` com detalhes revelam topologia: token + bloqueio
  no Nginx; `HEALTH_DETAILS_ENABLED=false` em produção.
- `X-Request-Id` recebido é aceito se tiver formato válido — não use como prova
  de auditoria (é correlação, não autenticação).
- Logs de auditoria contêm IP/UA: acesso restrito e retenção definida.
- A telemetria do client é autenticada e limitada, mas o conteúdo vem do
  navegador — trate como não confiável (schema fechado + redaction).

---

## 14. Exemplos de saída

```json
{"level":"info","timestamp":"2026-09-11T13:40:00.000Z","service":"navespeak-api","environment":"production","version":"b4692c9","request_id":"req-3f1c2a9e-8d7b-4e6f-9a1b-2c3d4e5f6a7b","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"9a8b7c6d5e4f3a2b","source_ip":"203.0.113.10","user_agent":"Mozilla/5.0 …","user_id":"8e1d…","event":"http_request","http_method":"GET","http_route":"/api/rooms/:roomId","http_status_code":200,"duration_ms":42.17,"response_size_bytes":5120,"outcome":"success","error_code":null,"message":"Request completed"}
{"level":"warn","timestamp":"2026-09-11T13:41:02.511Z","service":"navespeak-api","environment":"production","version":"b4692c9","request_id":"req-…","trace_id":"…","span_id":"…","source_ip":"198.51.100.4","event":"login_failed","outcome":"failure","security_relevant":true,"actor_type":"anonymous","auth_method":"password","reason_code":"invalid_password","user_id":"8e1d…","suppressed_count":0,"message":"Login failed"}
{"level":"warn","timestamp":"2026-09-11T13:42:10.004Z","service":"navespeak-api","environment":"production","version":"b4692c9","request_id":"req-…","database_system":"postgresql","event":"database_operation_failed","operation":"select_users","duration_ms":1200,"error_code":"DB_TIMEOUT","retryable":true,"error":{"type":"error","message":"canceling statement due to statement timeout","code":"57014"},"message":"PostgreSQL operation failed"}
{"level":"info","timestamp":"2026-09-11T13:43:00.120Z","service":"navespeak-api","environment":"production","version":"b4692c9","connection_id":"Xk2pQ9…","user_id":"8e1d…","source_ip":"203.0.113.10","websocket_event":"media:join","event":"voice_session_started","channel_id":"c0ffee00-…","room_id":"5f0c…","session_id":"vs-2b7d…","voice_room_type":"server_channel","message":"Voice session started"}
```
