# NaveSpeak

App de chat de texto, voz e compartilhamento de tela para um grupo fechado de
usuários (uso pretendido: dentro de uma VPN privada, ex. RadminVPN), com
Electron + versão web a partir do mesmo código React.

Este projeto foi construído em fases; todas as 6 fases planejadas estão
concluídas (veja o Roadmap no final deste arquivo).

## Pré-requisitos

- Node.js 20+
- Um servidor MySQL acessível (local ou na rede da VPN)

## Configuração

1. **Banco de dados**: rode `database/schema.sql` no seu MySQL. O script já
   inclui, comentado, o `CREATE USER`/`GRANT` recomendado para criar um
   usuário de aplicação com privilégio mínimo (não use `root` na aplicação).

2. **Variáveis de ambiente**:
   ```
   cp .env.example server/.env
   cp client/.env.example client/.env
   ```
   Preencha `server/.env` com as credenciais do MySQL e gere segredos JWT
   aleatórios (`openssl rand -hex 64` ou equivalente) para
   `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET`. **Nunca** faça commit do
   arquivo `.env`. Se a porta 4000 já estiver em uso na sua máquina, mude
   `PORT` no `server/.env` (e `VITE_API_URL` no `client/.env` para combinar).

3. **Instalar dependências** (na raiz, usando workspaces):
   ```
   npm install
   ```

4. **Rodar em desenvolvimento** (dois terminais):
   ```
   npm run dev:server
   npm run dev:client
   ```
   O client abre em `http://localhost:5173` e fala com a API em
   `http://localhost:4000` (ajuste `CORS_ORIGIN`/`VITE_API_URL` se mudar as
   portas).

5. Acesse `http://localhost:5173/register`, crie uma conta e confirme que o
   login funciona.

## Rodando em produção (um único processo servindo tudo)

Em produção, o próprio Express serve o bundle do client já buildado, então
não precisa do Vite dev server rodando à parte - uma única origem/porta para
toda a versão web:

```
npm run build:client
```

No `server/.env`, defina `NODE_ENV=production` e rode:

```
npm start --workspace server
```

O app fica disponível inteiro (UI + API + chat + voz + tela) em
`http://localhost:4000` (ou na porta que você configurou).

## Segurança — decisões importantes

- Senhas nunca são guardadas em texto puro (bcrypt, custo 12).
- Refresh tokens ficam em cookie `httpOnly`; só o hash SHA-256 deles é
  guardado no banco, e são rotacionados a cada uso.
- Toda query ao MySQL usa placeholders (`?`) via `mysql2` — nunca
  concatenação de string.
- Toda entrada de usuário é validada no servidor com `zod` antes de tocar o
  banco (a validação no formulário do React é só UX, não é a proteção real).
- Segredos (senha do MySQL, segredos JWT) só existem em variáveis de
  ambiente, nunca no código-fonte versionado.
- O servidor recusa subir se algum segredo obrigatório estiver faltando no
  `.env` (ver `server/src/config/env.js`).
- Toda a API vive sob `/api/*` para não colidir com as rotas de página do
  React Router quando client e API são servidos pela mesma origem em
  produção (ver `server/src/index.js`).

## Uso via VPN

Rode o servidor (produção: `npm start --workspace server`, com
`NODE_ENV=production`) na máquina que vai atuar como host, e configure
`CORS_ORIGIN` (no server) para o **IP atribuído pela VPN** a essa máquina.
Os demais usuários acessam a versão web nesse mesmo IP:porta pelo navegador,
ou usam o app Electron apontando `NAVESPEAK_SERVER_URL` para essa mesma URL
(ver seção Electron abaixo).

Para voz funcionar entre máquinas diferentes na VPN, preencha também
`MEDIASOUP_ANNOUNCED_IP` no `server/.env` com esse mesmo IP da VPN. Sem isso,
a voz só funciona entre abas/processos na mesma máquina.

## Chat de texto e voz (Fase 2 + 3)

- Crie uma sala em `/rooms` (ou entre em uma existente com um código de
  convite de 12 caracteres gerado por quem criou a sala).
- Dentro da sala: chat de texto em tempo real (persistido no MySQL) e um
  painel "Voz" — clicar em "Entrar na voz" pede permissão do microfone ao
  navegador (só nesse momento, nunca automaticamente) e conecta via SFU
  (mediasoup), suportando várias pessoas na mesma sala sem sobrecarregar o
  upload de cada participante.

## Compartilhamento de tela e câmera (Fase 4)

- É preciso estar conectado na voz (`Entrar na voz`) antes de compartilhar
  tela ou ligar a câmera - eles reaproveitam a mesma conexão de mídia.
- "Compartilhar tela" dispara o seletor nativo do navegador
  (`getDisplayMedia`), sempre a partir de um clique explícito. Fechar a
  captura pelo controle nativo do navegador/SO também atualiza a UI aqui.
- Se o usuário parar de compartilhar clicando no botão "Parar
  compartilhamento" do próprio navegador (em vez do nosso), o app detecta e
  encerra a transmissão do lado do servidor também.
- No app Electron, o mesmo botão lista as janelas/telas disponíveis via
  `desktopCapturer` (só a lista de id/nome/miniatura, nunca acesso geral ao
  sistema) e pede para você escolher qual compartilhar.

## App Electron (Fase 5)

O Electron é uma "casca" nativa em volta da mesma UI web - ele carrega, numa
janela nativa, a mesma página que os usuários acessariam pelo navegador
(servida pelo servidor NaveSpeak). Isso significa que todo mundo do grupo
sempre vê a versão mais atual da UI, sem precisar reinstalar o app Electron
a cada mudança.

1. Configure para qual servidor o Electron deve apontar:
   ```
   cp electron/.env.example electron/.env
   ```
   e edite `NAVESPEAK_SERVER_URL` com a URL (IP da VPN, em produção) do
   servidor NaveSpeak.

2. Rodar em desenvolvimento:
   ```
   npm run dev:electron
   ```

3. Gerar um instalador/executável distribuível (Windows/Mac/Linux, conforme
   a máquina onde rodar):
   ```
   npx electron-builder --config electron/package.json
   ```

### Hardening aplicado na janela Electron

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` - a
  página carregada não tem acesso a Node/Electron além do que o
  `electron/preload.js` expõe explicitamente (só a lista de fontes de tela).
- Navegação travada à origem configurada em `NAVESPEAK_SERVER_URL` - links
  externos abrem no navegador padrão do sistema em vez de dentro da janela
  do app.
- Permissão de câmera/microfone/tela só é concedida para a origem
  configurada, nunca para qualquer outra página.

## Roadmap

- [x] Fase 1 — scaffold, banco de dados, registro/login
- [x] Fase 2 — chat de texto em tempo real
- [x] Fase 3 — voz (mediasoup SFU)
- [x] Fase 4 — compartilhamento de tela e câmera
- [x] Fase 5 — shell Electron
- [x] Fase 6 — revisão final de segurança (ver achado corrigido: mensagem de
      registro unificada para não permitir enumeração de contas)
