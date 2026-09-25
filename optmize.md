# Otimização: segurança e performance (mídia / compartilhamento de tela)

Auditoria feita em 2026-09-23, na branch `ui-refactor`. Por enquanto é só um relatório; as correções ainda serão implementadas.
Os números de linha valem para essa data. Antes de editar, confira-os com grep, porque o código pode ter mudado.

## Notas para quem for implementar (Claude)

- **Ordem sugerida:** Fase 1 (segurança crítica), depois Fase 2, depois Fase 3 (performance rápida), depois Fase 4 (estrutural). Cada item é independente: dá pra fazer um commit por item.
- **Já conferido no código:**
  - O broadcast do chat na room do servidor (`chat.handler.js:141`).
  - A blocklist em `attachmentUpload.js:7`.
  - Express `^4.19.2`, que não trata promise rejeitada.
  - O `catch` sem `track.stop()` em `startScreenShare` (`MediaSessionContext.jsx:~1316`).
- **Checado e ok (não precisa mexer):**
  - SQL: tudo parametrizado.
  - JWT: segredo mínimo de 16 caracteres, TTL de 15 minutos, token só no header Bearer.
  - CORS: origem única.
  - Rotas de admin: usam `requireAdmin`.
  - Electron: `contextIsolation`, `sandbox` e `webSecurity` ligados, `nodeIntegration` desligado.
  - Client: nenhum `dangerouslySetInnerHTML`.
  - Mediasoup: transports, producers e consumers são buscados por `socket.id`, então ninguém mexe nos de outro usuário.
  - Leave e disconnect fecham os transports.
  - Socket listeners têm `on`/`off` pareados.
  - `srcObject` só é atribuído quando o stream muda.
  - getStats a cada 3 s é razoável.
- **Cuidados:**
  - **Item S1:** o `NotificationContext.jsx` depende do `chat:message` que chega pela room do servidor para notificar canais que não estão abertos. Ao trocar por um evento sem conteúdo (`chat:notify`), ajuste o client no mesmo commit, senão as notificações desktop quebram.
  - **Item P1 (pause de consumer):** "clique para assistir" é o padrão do screen share (`autoplayScreenShare` desligado, `VoicePanel.jsx:~463`). O consumer precisa ser retomado (`resume`) no clique e pausado de novo se o tile sumir.
  - **Item P2 (VP9/simulcast):** exige a mudança no router do servidor (`mediaCodecs`) **e** no client (`encodings`/`codec` no `produce`). Teste Electron e browser, porque o suporte a VP9 SVC muda entre versões do Chromium.
  - Antes de mexer em UI, leia o `DESIGN.md` (regra do `CLAUDE.md`).
  - O projeto é todo em português: mantenha comentários e mensagens de erro em PT-BR.
- **Verificação geral:**
  - Rodar o app com duas contas em dois navegadores.
  - `chrome://webrtc-internals` para ver bitrate e bytes recebidos.
  - React DevTools Profiler para os re-renders.
  - DevTools → Network → WS para ver os payloads dos sockets.

---

## Segurança

### Fase 1: crítica

> **Status: implementada em 2026-09-25**, ainda sem commit. O que mudou em relação ao plano:
> - **S1:** não foi criado `chat:notify`. O `chat:message` continua indo para a room do canal e a do servidor quando o canal não tem role de visualização. Em canal restrito, vai só para os sockets (dessas rooms) de quem tem `view`. Assim o client (notificação e badges) não mudou, e quem não tem acesso não recebe nem o autor nem a existência da mensagem.
> - **S2:** `npm i express-async-errors` falhou (bug do arborist no npm 10.9.2, "Cannot read properties of null (reading 'location')"). O mesmo patch foi feito em `server/src/middleware/asyncErrors.js`, primeiro import de `index.js`. Handlers de socket já tinham try/catch via `instrumentConnection`; faltava só o bloco de conexão de `online.handler.js`. Também receberam teto as permissões e posições de role e canal.
> - **S3:** a blocklist foi removida, então todo formato pode ser anexado (html, svg, js e xml são usados no trabalho). Além dos três headers, tudo que não é imagem, vídeo ou áudio é servido como `application/octet-stream`. Com `nosniff`, isso impede um `.js` enviado de rodar via `<script src>`.
> - **S4:** `http:` também é permitido no `openExternal` (links de chat em VPN). O check de `senderFrame.url` é um patch único em `ipcMain.handle/on`, que aceita a origem do app e `about:blank` (janelas destacadas).

**S1. Vazamento de mensagens de canal restrito** (alto)
- **Onde:** `server/src/sockets/chat.handler.js:141`, `sockets/online.handler.js:34`, `sockets/presence.handler.js:50-63`.
- **Problema:**
  - `io.to(channelId).to(channel.server_id).emit("chat:message", …)` manda o conteúdo inteiro para todo membro do servidor, porque todo socket entra na room do servidor ao conectar.
  - `channel:join` e `chat:typing` não checam `view`.
  - `chat:send` (linha ~114) checa só `send`.
- **Exploit:** um membro sem permissão de ver o canal recebe em tempo real todas as mensagens e anexos dele.
- **Correção:**
  - Na room do servidor, emitir só `chat:notify { channelId, serverId, messageId, authorId }` e ajustar o `NotificationContext.jsx`.
  - Adicionar `canAccessChannel({action:'view'})` em `channel:join`, `chat:typing` e `chat:send`.

**S2. Crash do processo por promise rejeitada** (alto)
- **Onde:**
  - `server/src/routes/friends.routes.js:~200` (`loadOwnPendingRequest`).
  - `server/src/validation/schemas.js:121`.
  - Todos os middlewares async: `loadRoomForMember`, `loadChannelForMember`, `loadPeer`, `loadRole`, `loadTargetMember`, `loadTargetUser`, `loadInviteInRoom`.
- **Problema:**
  - `z.coerce.number().int().positive()` não tem máximo, então `1e20` passa e o Postgres dá "bigint out of range".
  - O Express 4 não trata promise rejeitada. Vira `unhandledRejection`, e `observability/shutdown.js:59` desliga o processo.
- **Exploit:** `POST /api/friends/requests/100000000000000000000/accept` em loop mantém o servidor fora do ar. Qualquer erro de banco ou Redis nesses middlewares também derruba.
- **Correção:**
  - `npm i express-async-errors` e `require('express-async-errors')` no topo de `server/src/index.js`.
  - `.max(2147483647)` nos IDs numéricos (ou o limite de bigint, conforme a coluna).
  - try/catch no bloco de conexão de `sockets/online.handler.js`.

**S3. XSS armazenado via `/uploads`** (alto)
- **Onde:** `server/src/utils/attachmentUpload.js:7` e `server/src/index.js:207-218` (`express.static(uploadsDir)`).
- **Problema:**
  - A blocklist só cobre `html htm xhtml shtml svg`, então `.xht`, `.xml` e `.xsl` executam como XHTML.
  - Um `.js` enviado é servido na mesma origem, e o CSP `script-src 'self'` deixa rodar.
- **Exploit:**
  1. Enviar `p.js` com o payload.
  2. Enviar um `.xht` com `<script src="/uploads/attachments/<uuid>-p.js"/>`.
  3. Mandar o link no chat.
  4. Quando a vítima abre, o script chama `POST /api/auth/refresh`, pega o token e o envia para fora. Também pode trocar o e-mail via `PATCH /api/users/me` e tomar a conta pelo reset de senha.
- **Correção:**
  - `setHeaders` no static de `/uploads/attachments` com `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` e `Content-Security-Policy: sandbox; default-src 'none'`.
  - Acrescentar `xht xml xsl js mjs` à blocklist como segunda camada. O ideal no futuro é uma origem separada, sem cookie.

**S4. Electron `openExternal` sem checar o esquema** (médio, vira crítico se somado a um XSS)
- **Onde:** `electron/main.js:457,479` e `:652` (`setDisplayMediaRequestHandler`).
- **Problema:**
  - `shell.openExternal(url)` aceita `file:`, `ms-msdt:`, `search-ms:` e caminhos UNC. Somado a um XSS, isso vira execução de código na máquina do usuário.
  - O display handler usa `sources[0]` quando não há fonte escolhida, então a tela pode ser capturada sem o seletor aparecer.
- **Correção:**
  - Só chamar `openExternal` para `https:` ou `mailto:`.
  - Negar a captura quando não houver fonte pendente.
  - Checar `event.senderFrame.url` nos handlers IPC.

### Fase 2: média

> **Status: implementada em 2026-09-25**, ainda sem commit. O que mudou em relação ao plano:
> - **S5:** o `removePeer` do mesmo socket já existia no `media:join` (P9). O transport fechado sai de `peer.transports` (`observer 'close'`) para não travar o limite de 2. `WebRtcServer` ficou de fora.
> - **S6:** `evictUserFromServer` em `mediasoup.handler.js`, chamado pelas rotas de kick e ban. Emite também `voice:kicked`, para o client limpar o estado da call.
> - **S8:** o servidor não recusa subir sem `TRUST_PROXY` (produção direta na VPN, sem Nginx, é válida); só loga um aviso.
> - **S9:** cota de 500 MB/dia por usuário no Redis (fail-open) e limpeza horária de anexos com mais de 24 h sem referência (inclui arquivos de mensagens apagadas). Adicionado `ALTER TABLE system_broadcasts ADD COLUMN IF NOT EXISTS attachments`, que faltava em bancos antigos.

**S5. DoS de transports mediasoup**
- **Onde:** `server/src/sockets/mediasoup.handler.js:411`, `server/src/mediasoup/rooms.js:42-58`, `mediasoup/config.js` (portas 40000-40100).
- **Problema:** não há limite de transports por peer, e `media:join` em outro canal não limpa o anterior.
- **Consequência:** criando uns 100 transports, um usuário esgota as portas e a voz cai para todo mundo.
- **Correção:**
  - No máximo 2 transports por peer.
  - `leaveVoiceChannel` do canal anterior no `media:join`.
  - Em `addPeer`, fazer `removePeer` se já existir um peer com o mesmo `socket.id`.
  - Opcional: `WebRtcServer`, com uma porta só.

**S6. Kick/ban não tira o usuário das rooms**
- **Onde:** `server/src/routes/rooms.routes.js:438-460` (kick) e `:471-499` (ban).
- **Problema:** as rotas só emitem `server:removed`. Um client modificado ignora o evento e continua recebendo mensagens, presença e o roster de voz, e fica na call.
- **Correção:**
  - `io.in('user:'+id).socketsLeave([roomId, ...channelIds, ...voiceRooms])`.
  - `leaveVoiceChannel` dos peers nos canais daquele servidor.

**S7. Brute force do código de reset**
- **Onde:** `server/src/routes/auth.routes.js:341-393`.
- **Problema:**
  - Código de 6 dígitos com 5 tentativas, mas pedir um código novo zera as tentativas.
  - A checagem e o incremento de `attempts` não são atômicos.
  - Não há limite por conta.
- **Correção:**
  - `UPDATE … SET attempts=attempts+1 WHERE id=$1 AND attempts<5 RETURNING` antes de comparar o código.
  - No máximo 3 códigos por hora por conta.

**S8. `TRUST_PROXY` ausente no deploy**
- **Onde:** `server/src/config/env.js`, `deploy.md:285-321`.
- **Problema:** atrás do Nginx, sem `TRUST_PROXY=1`, todo mundo aparece como `127.0.0.1`. Um atacante gasta o rate limit de autenticação (20 requisições a cada 15 minutos) e trava o login de todos.
- **Correção:**
  - Adicionar `TRUST_PROXY=1` ao bloco `.env` do `deploy.md` e corrigir a nota desatualizada.
  - Opcional: recusar subir em produção sem essa variável.

**S9. Body grande processado antes da autenticação; uploads nunca apagados**
- **Onde:** `server/src/index.js:147-158`, `routes/attachments.routes.js`.
- **Problema:** um anônimo faz o servidor bufferizar 28 MB, 15 MB ou 3 MB antes do `requireAuth`. Os uploads órfãos nunca são apagados e podem encher o disco.
- **Correção:**
  - Montar `requireAuth` antes dos parsers grandes.
  - Cota por usuário e limpeza de órfãos.

**S10. Sem `setMaxIncomingBitrate`**
- **Onde:** `mediasoup.handler.js:~419`.
- **Problema:** um client pode empurrar 8 Mbps de tela, mais câmera e áudio.
- **Correção:** `transport.setMaxIncomingBitrate(10_000_000)` nos send transports.

### Baixos (anotados, sem prioridade)
- **Hierarquia de roles:** quem tem `BAN_MEMBERS`, `MUTE_MEMBERS`, `DISCONNECT_MEMBERS` ou `MOVE_MEMBERS` consegue agir sobre admin e dono (`rooms.routes.js:438,471`, `mediasoup.handler.js:272`).
- **`call:create`** (`calls.handler.js:90`) não exige amizade nem servidor em comum e não tem rate limit, então dá pra usar como spam de chamada.
- **Lockout abusivo:** 5 senhas erradas travam qualquer conta por 15 minutos (`users.repo.js:115`).
- **Enumeração de contas por timing:** o login não roda bcrypt para usuário inexistente.
- **Race no refresh token:** buscar e revogar não é atômico.
- **Sockets longos:** o JWT e o ban só são checados no handshake.
- **Roster de voz de canal restrito** fica visível para todos os membros.
- **Regex de `path` de anexo** (`schemas.js:328`) aceita `../`, o que deixa checar se um arquivo existe dentro de `uploads/`.
- **`/uploads` é público:** anexos de DM ficam acessíveis por URL mesmo depois de limpar a conversa.
- **Auto-update sem checagem de assinatura** (electron-updater).

---

## Performance (mídia / compartilhamento de tela)

### Fase 3: rápida (diff pequeno, ganho alto)

> **Status: implementada em 2026-09-23**, ainda sem commit. O que mudou em relação ao plano:
> - **P4:** `networkStats` foi para um contexto próprio, `useNetworkStats()`, e o `setNetworkStats` ignora valores iguais. Só deduplicar não bastava, porque o ping em ms quase nunca se repete.
> - **P5:** o tile continua na grade, mas com placeholder ("Aberto em outra janela") e o `<video>` pausado. Assim o botão de fechar a janela separada continua acessível. Todo tile "gated" (oculto, ou "clique para assistir") agora também pausa o `<video>`, mas a rede continua recebendo o stream até o P1.
> - **P7:** só o `contentHint` foi trocado. `degradationPreference` ficou de fora, porque o Chrome já deriva o comportamento do `contentHint`.
> - **P9:** no servidor, o `media:join` repetido pelo mesmo socket fecha o peer antigo e emite `producerClosed`. Trocar de canal sem sair continua pendente (S5).
> - **P10:** todos os itens foram feitos, e a fila de `newProducer` pendentes também. Extra: `switchCamera` para a captura nova se o `replaceTrack` falhar.

**P3. A captura continua ligada quando o produce falha**
- **Onde:** `client/src/context/MediaSessionContext.jsx`: screen share em `~1290-1323`, câmera em `~1432-1457`, troca de fonte em `~1363-1413`.
- **Problema:** o `catch` não para os tracks do `stream`. Na troca de fonte, `activeScreenVideoTrackRef` já aponta para o track novo.
- **Consequências:**
  - O indicador de "compartilhando tela" do SO e a luz da webcam ficam acesos sem ninguém ver nada. É um problema de privacidade e de confiança.
  - No Electron, o loopback de áudio nativo continua mandando PCM por IPC, com CPU gasta à toa.
  - Com o blur ligado, o processador de fundo continua processando 30 fps sem destino.
  - Na troca de fonte, o evento `ended` do track antigo passa a ser ignorado, a UI fica dessincronizada e o botão "parar" não reflete o estado real.
- **Correção:** `stream?.getTracks().forEach(t => t.stop())` no `catch` e, na troca de fonte, restaurar o ref.

**P4. `networkStats` re-renderiza o app todo a cada 3 s**
- **Onde:** `MediaSessionContext.jsx:1596,1612` (entra no `useMemo` em 1661/1665).
- **Consequências:**
  - A cada 3 s, todo consumidor de `useMediaSession()` re-renderiza: RoomPage (com o chat), VoicePanel com todos os tiles, VoiceRosterEntry, DmSidebar e FriendsPanel.
  - Em call com muitos tiles e chat longo, aparecem micro-travadas periódicas, rolagem com engasgo, input do chat perdendo frames e mais CPU e bateria em notebook.
- **Correção:** só chamar `setNetworkStats` quando ping, perda ou qualidade mudarem, ou mover para um contexto próprio lido só pelo `ConnectionStatusButton`.

**P5. Tile em popout continua renderizado na grade**
- **Onde:** `client/src/components/VoicePanel.jsx:958,967`.
- **Consequências:**
  - O mesmo stream é decodificado e desenhado em dois `<video>`, com dois `useSpeaking` (mais AudioContexts e loops rAF).
  - Para um screen share em 1440p60, isso dobra o custo de composição na GPU. O popout existe justamente pra ver melhor, mas deixa a janela principal mais pesada.
- **Correção:** tirar `poppedOutKeys` de `visibleTiles`.

**P6. Electron `getSources` gera thumbnails de todas as janelas**
- **Onde:** `electron/main.js:652-663`; os fallbacks em `client/src/api/media.js:212,224,233,243` chamam de 2 a 3 vezes.
- **Consequências:**
  - Cada início ou troca de share leva de 100 a 500 ms a mais (ou mais, com muitas janelas abertas).
  - Pico de CPU capturando thumbnails 150×150 de toda janela, que podem nem ser usadas.
  - Parece que o botão "compartilhar" não responde.
- **Correção:** `thumbnailSize: {width:0, height:0}, fetchWindowIcons: false` quando a thumbnail não for exibida.

**P7. `contentHint` fixo em `'motion'`, sem `degradationPreference`**
- **Onde:** `MediaSessionContext.jsx:1292,1365`.
- **Consequências:**
  - Quando a banda aperta, o Chrome derruba primeiro a resolução para manter o fps.
  - Para desktop, código, planilha e slides (o uso mais comum), o texto fica borrado e ilegível justo quando mais importa.
  - Com `'detail'`, o encoder manteria a nitidez e sacrificaria fps.
- **Correção:**
  - `'detail'` quando fps ≤ 30 e `'motion'` a 60 fps (jogos), ou deixar o usuário escolher.
  - `degradationPreference` via `producer.rtpSender.setParameters`.

**P8. Race em `getOrCreateRoom`**
- **Onde:** `server/src/mediasoup/rooms.js:26-36`.
- **Consequências:**
  - Dois usuários entrando juntos num canal vazio criam dois routers. O segundo sobrescreve o primeiro, que nunca é fechado.
  - Vaza memória e CPU do worker mediasoup.
  - O primeiro usuário fica "órfão": o `createTransport` dele falha, ele vê a call conectando e não ouve nem é ouvido, e precisa sair e entrar de novo.
- **Correção:** guardar a promise no Map (`rooms.set(id, promise)`).

**P9. Join duplo vaza transports**
- **Onde:** client `MediaSessionContext.jsx:859`, `RoomPage.jsx:198`; servidor `rooms.js:42-58` (`addPeer` sobrescreve o peer).
- **Consequências:**
  - Um duplo clique ou um join durante reconexão cria dois conjuntos de transports e producers.
  - O producer de microfone antigo continua enviando áudio que ninguém controla. Pode gerar eco ou voz duplicada, e o mute não silencia o producer antigo.
  - Portas e banda do servidor ficam presas até o socket desconectar.
- **Correção:** um ref de "join em andamento" no client e `removePeer` antes do `addPeer` no servidor (junto com S5).

**P10. Robustez e limpeza diversas**
- `consumer.resume()` sem try/catch (`mediasoup.handler.js:612`) e `emitAsync` sem timeout (`MediaSessionContext.jsx:65-72`).
  - **Consequência:** se o `resume` falhar, o ack nunca volta, e `consumeProducer` ou `joinVoice` ficam pendurados para sempre. O usuário vê "conectando…" eternamente ou um tile preto sem erro.
  - **Correção:** try/catch e `socket.timeout(10000).emit`.
- Effect `setLevel` duplicado (`MediaSessionContext.jsx:845` e `985`).
  - **Consequência:** trabalho em dobro a cada mudança de nível, e risco de os dois divergirem numa edição futura.
  - **Correção:** apagar um dos dois.
- Câmera sem limites (`client/src/api/media.js:294`, `video:true`).
  - **Consequência:** webcams 4K ou 1080p60 entregam frames enormes, o blur de fundo fica muito mais pesado e o encoder precisa fazer downscale.
  - **Correção:** `{width:{ideal:1280}, frameRate:{max:30}}`.
- `sender.once('destroyed')` registrado a cada início de áudio de tela (`electron/screenAudio.js:77`).
  - **Consequência:** listeners se acumulam no webContents, aparece o warning `MaxListenersExceeded` depois de uns 10 shares e há um pequeno vazamento de memória em sessões longas.
  - **Correção:** registrar uma vez só ou remover no `stop`.
- Producers consumidos em série (`MediaSessionContext.jsx:951-953`).
  - **Consequência:** entrar numa sala cheia leva N × 3 round-trips, e com 10 pessoas o áudio e vídeo aparecem aos poucos por alguns segundos.
  - **Correção:** `Promise.all`.
- `newProducer` descartado quando chega antes do `recvTransport` existir (`MediaSessionContext.jsx:366`).
  - **Consequência:** alguém que começou a compartilhar bem na hora do seu join fica invisível e mudo para você até alguém reentrar.
  - **Correção:** enfileirar até o transport ficar pronto.

### Fase 4: estrutural (maior ganho de banda e CPU)

**P1. Consumers nunca são pausados quando o tile não está visível**
- **Onde:** servidor `mediasoup.handler.js:582,606-614` (só existe `media:resumeConsumer`); client `ParticipantTile.jsx:114,150` (esconde só com CSS) e `VoicePanel.jsx:1060` (a janela flutuante mostra 1 tile).
- **Consequências:**
  - "Clique para assistir" é o padrão do screen share, mas cada viewer já baixa e decodifica o stream inteiro (2,5 a 8 Mbps) antes de clicar.
  - Numa call de 10 pessoas com um share, o servidor manda até 9 × 8 Mbps que quase ninguém vê.
  - Em conexões mais fracas, o stream escondido rouba banda do áudio, e a voz fica picotada e com atraso.
  - A CPU e a GPU do viewer decodificam vídeo invisível, com notebook esquentando, bateria indo embora e ventoinha alta.
  - Com a janela minimizada, o vídeo remoto continua sendo decodificado (só o preview local pausa, `VoicePanel.jsx:214-231,435`).
- **Correção:**
  - Handler `media:pauseConsumer` no servidor (`consumer.pause()`).
  - O client pausa quando o tile está oculto, em "clique para assistir", fora do layout ou com a janela minimizada, e retoma quando o tile volta a ser visível.

**P2. Tela e câmera enviadas em um único stream, sem simulcast nem SVC**
- **Onde:** `MediaSessionContext.jsx:33` (tela), `:1446` (câmera 1 Mbps), `ScreenSourcePicker.jsx:151` (até 8000 kbps customizado), `server/src/mediasoup/config.js:7-30` (só VP8 e H264), `mediasoup.handler.js:512` (`produce`).
- **Consequências:**
  - Todo viewer recebe a resolução cheia, mesmo com o tile em miniatura: banda desperdiçada no servidor e em cada viewer.
  - O viewer com pior conexão degrada a experiência de todos. A perda de pacote dele gera pedidos de keyframe (PLI) que chegam ao sender e fazem o encoder mandar keyframes grandes para todos, com picos de bitrate e artefatos na tela de todo mundo.
  - Viewer em rede fraca simplesmente trava: sem camada menor, o SFU não tem o que mandar para ele.
  - O custo de banda do servidor cresce linearmente com resolução × viewers.
  - H264 `42e01f` (`config.js:26`, level 3.1) limita a 720p30 se um dia for negociado.
- **Correção:**
  - VP9 no `mediaCodecs`.
  - Tela: VP9 com `scalabilityMode: 'L1T3'` (ou `'L3T3_KEY'`).
  - Câmera: 3 encodings de simulcast (`scaleResolutionDownBy` 4/2/1, cerca de 150k/500k/1,2M).
  - `consumer.setPreferredLayers` conforme o tamanho do tile e o pin.
  - `keyFrameRequestDelay: 1000` no `produce` de vídeo.

**P11. `useSpeaking` cria um AudioContext e um loop rAF por uso**
- **Onde:** `client/src/hooks/useSpeaking.js:37,62`; chamado em `ParticipantTile.jsx:90`, `VoiceRosterEntry.jsx:76`, `VoicePanel.jsx:44` (SpeakingProbe) e nos popouts.
- **Consequências:**
  - Cada participante custa de 2 a 3 AudioContexts, cada um com sua própria thread de áudio em tempo real, mais loops a 60 Hz. Com 10 pessoas são de 20 a 30 contexts.
  - O navegador tem limite de AudioContexts. Passado o limite, novos contexts falham, e o indicador de fala ou até o áudio param de funcionar.
  - CPU constante mesmo em silêncio.
  - Com `backgroundThrottling: false` no Electron (`electron/main.js:436`), isso continua rodando com o app minimizado e drena bateria.
  - Mais threads de áudio competindo também aumentam o risco de estalos e glitches no áudio da call.
- **Correção:** um AudioContext compartilhado no módulo, um analyser por track id com refcount e um timer de cerca de 10 Hz notificando os assinantes.

**P12. Blur de fundo em resolução cheia na main thread, a 30 fps**
- **Onde:** `client/src/utils/backgroundProcessor.js:119-139`.
- **Consequências:**
  - `getAsFloat32Array` lê a máscara da GPU para a CPU a cada frame, o que trava o pipeline, e há um loop JS por pixel mais `blur(14px)` em canvas 2D no frame inteiro.
  - A main thread fica ocupada, e a UI inteira (chat, cliques, animações) fica lenta enquanto a câmera com blur está ligada.
  - O próprio vídeo da câmera cai de fps e fica com jitter.
  - Em máquina modesta, a CPU vai a 100%: o encoder de tela perde frames e o áudio pode picotar.
- **Correção:**
  - Borrar num canvas a 1/4 da resolução e escalar de volta.
  - Segmentar a cerca de 15 fps.
  - Depois, mover para um Worker com `OffscreenCanvas` / `MediaStreamTrackProcessor`.

**P13. Estado velho no servidor quando o transport fecha**
- **Onde:** `mediasoup.handler.js:429-431`, `rooms.js:91-109` (`listOtherProducers`).
- **Consequências:**
  - Quando o DTLS falha, o transport fecha, mas continua em `peer.transports` e seus producers continuam nos mapas.
  - Quem entra depois recebe a oferta de producers mortos: o consume falha, e aparecem tiles fantasmas ou erro no join.
  - Os mapas crescem enquanto o peer estiver na sala, com um vazamento lento de memória em salas longas.
- **Correção:** apagar as entradas em `transport.observer 'close'` e `producer 'transportclose'`.

**P14. Race de consumer quando o producer fecha durante o consume**
- **Onde:** `MediaSessionContext.jsx:364-397` e `404-409`.
- **Consequências:**
  - Se `media:producerClosed` chegar antes de `consumeProducer` terminar, o consumer vaza e `addRemoteStream` roda depois da remoção.
  - Aparece um tile fantasma (preto ou congelado) de alguém que já parou de compartilhar, e ele só some saindo da call.
- **Correção:** guardar um set de producers fechados (ou um token pendente por producer) e fechar o consumer se o producer fechou durante o await.

**P15. Cadeia do microfone com 2 a 3 AudioContexts**
- **Onde:** `client/src/audio/rnnoise.js:48` / `gtcrn.js:37` / `deepfilternet.js:113`, depois `noiseGate.js:35`, ligados por MediaStreamDestination → MediaStreamSource.
- **Consequências:**
  - Cada salto soma uma thread de render e um buffer de latência, então a sua voz chega mais atrasada para os outros.
  - Mais CPU, mais risco de dessincronia de clock entre contexts (drift) e estalos em sessões longas.
- **Correção:** montar o denoiser e o gate num único context compartilhado.

**P16. Custos menores**
- `useMicLevel.js:48-49` chama `setLevelDb` a 60 Hz.
  - **Consequência:** o `PreferencesModal` re-renderiza a 60 fps enquanto está aberto, e o modal fica pesado e os sliders engasgam.
  - **Correção:** limitar a cerca de 15 Hz ou escrever no DOM via ref.
- `pcmPlayerWorklet.js:18-27` aloca um Float32Array por chunk e usa `queue.shift()`, que é O(n); `dfn3Worklet.js:138` aloca um por frame de 10 ms.
  - **Consequência:** garbage collection na thread de áudio pode causar estalos no áudio da tela compartilhada e no denoiser.
  - **Correção:** ring buffer pré-alocado.
- `deepfilternet.js:136` copia cerca de 24 MB de wasm e modelo para o worklet a cada join, e mantém o cache na main thread para sempre.
  - **Consequência:** join mais lento e cerca de 24 a 48 MB de RAM presos.
  - **Correção:** compilar o `WebAssembly.Module` uma vez e reaproveitar, e liberar os bytes.
- `VoicePanel.jsx:322-417,422-499`: closures inline por tile e `ParticipantTile` sem memo.
  - **Consequência:** qualquer mudança no roster ou nas preferências re-renderiza todos os tiles. É pouco hoje, mas cresce com o número de pessoas.
  - **Correção:** `React.memo` e callbacks estáveis.
- `useTilePopouts.js:17-47` chama `window.open` dentro do updater de `setWindows`.
  - **Consequência:** no StrictMode (dev) abre duas janelas, e o comportamento fica imprevisível em futuras versões do React.
  - **Correção:** tirar o efeito colateral de dentro do updater.
- `electron/screenAudio.js` manda cerca de 100 mensagens IPC de PCM por segundo.
  - **Consequência:** overhead de IPC e serialização enquanto há áudio de tela. Aceitável hoje, mas vale agrupar chunks se aparecer CPU alta.

---

## Verificação (por fase)

- **S1:** duas contas, uma sem `view` num canal privado. No DevTools → WS da conta sem permissão, não pode aparecer `chat:message` com conteúdo. A notificação desktop continua funcionando para quem tem acesso.
- **S2:** `curl -X POST .../api/friends/requests/100000000000000000000/accept` com um token válido deve voltar 400 com o processo ainda de pé.
- **S3:** enviar um `.xht` e abrir a URL. O navegador baixa o arquivo e não executa nada.
- **S4:** `window.open('file:///C:/')` no console do Electron não abre nada.
- **P3:** travar a mídia do canal como moderador e tentar compartilhar a tela. O indicador de captura do SO deve sumir.
- **P4:** React DevTools Profiler, parado em call, não deve mostrar commit global a cada 3 s.
- **P1:** três participantes, um compartilhando e o viewer sem clicar em "assistir". No `chrome://webrtc-internals` do viewer, `bytesReceived` do vídeo de tela deve ficar parado.
- **P2:** no `webrtc-internals` do sender, 3 camadas (simulcast) ou `scalabilityMode` ativo. Viewer com tile pequeno recebendo a camada baixa.
- **P11:** `chrome://media-internals` / Task Manager com o número de AudioContexts sem crescer por participante.
