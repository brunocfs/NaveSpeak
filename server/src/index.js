import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { assertDbConnection } from './config/db.js';
import authRoutes from './routes/auth.routes.js';
import roomsRoutes from './routes/rooms.routes.js';
import channelsRoutes from './routes/channels.routes.js';
import rolesRoutes from './routes/roles.routes.js';
import messagesRoutes from './routes/messages.routes.js';
import friendsRoutes from './routes/friends.routes.js';
import dmRoutes from './routes/dm.routes.js';
import usersRoutes from './routes/users.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import invitesRoutes from './routes/invites.routes.js';
import attachmentsRoutes from './routes/attachments.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { attachSockets } from './sockets/index.js';
import { createWorkers } from './mediasoup/workers.js';
import { resetEphemeralPresenceOnBoot } from './config/redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.join(__dirname, '..', '..', 'client', 'dist');
const uploadsDir = path.join(__dirname, '..', 'uploads');
const updatesDir = path.join(__dirname, '..', 'updates');

const app = express();

// CORS restrito a uma única origem conhecida, com credentials habilitado só
// para essa origem - nunca "*" quando cookies estão em jogo. Só importa
// mesmo em desenvolvimento (client Vite em outra porta); em produção o
// client é servido pelo próprio Express, então é a mesma origem.
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(helmet());
// Limite de corpo maior só para o upload de avatar (imagem em base64 dentro
// do JSON, sem multer/multipart - ver users.routes.js) - precisa vir ANTES
// do express.json global (100kb): o body-parser marca req._body assim que
// parseia e o próximo express.json na cadeia simplesmente pula, então só o
// primeiro a bater com o path é que decide o limite aplicado.
app.use('/api/users/me/avatar', express.json({ limit: '3mb' }));
app.use('/api/rooms', express.json({ limit: '3mb' }));
// Anexo de chat vai de base64 dentro do JSON também (mesmo motivo do
// comentário acima) - 20MB decodificados vira ~27MB em base64, mais folga
// pro resto do payload.
app.use('/api/attachments', express.json({ limit: '28mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Toda a API vive sob /api - isso evita colisão entre a rota de API
// "GET /rooms/:roomId" (JSON) e a rota de página do React Router
// "/rooms/:roomId" (HTML) quando ambas passam a ser servidas pela mesma
// origem em produção.
app.get('/api/health', (req, res) => res.json({ ok: true }));
// Versão do build do client atualmente servido - lida do package.json a
// CADA request (nunca cacheada, arquivo pequeno) pra sempre refletir o que
// tá de pé de verdade, mesmo sem reiniciar o processo entre um
// `npm run build:client` e o próximo. É o que UpdateAvailableBanner.jsx
// (client) usa pra saber que existe uma versão mais nova que a que já tá
// rodando na aba/janela aberta - ver comentário lá.
app.get('/api/version', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(clientDistDir, '..', 'package.json'), 'utf8'));
    res.set('Cache-Control', 'no-store').json({ version: pkg.version });
  } catch {
    res.status(503).json({ version: null });
  }
});
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/rooms/:roomId/channels', channelsRoutes);
app.use('/api/rooms/:roomId/roles', rolesRoutes);
app.use('/api/channels/:channelId/messages', messagesRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/dm/:userId', dmRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/invites', invitesRoutes);
app.use('/api/attachments', attachmentsRoutes);

// Avatares enviados por usuário (users.routes.js) - fora de /api de
// propósito, são arquivos estáticos, não respostas JSON.
app.use(
  '/uploads',
  (req, res, next) => {
    // helmet() define Cross-Origin-Resource-Policy: same-origin por padrão,
    // que bloquearia o <img> carregando daqui a partir de outra origem em
    // dev (client no Vite :5173, server em :4100) mesmo com CORS liberado -
    // CORP é checado pelo navegador independente do CORS. Em produção
    // client e server já são a mesma origem (ver clientDistDir acima), então
    // isso não afrouxa nada ali.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(uploadsDir)
);

// Feed de auto-update do app Electron (electron/main.js, autoUpdater
// provider "generic") - pasta estática com o(s) instalador(es) + latest.yml
// que o electron-builder gera (`npm run build:electron`, ver deploy.md).
// Fora de /api pelo mesmo motivo de /uploads: arquivo estático, não JSON, e
// o electron-updater espera exatamente esse formato de resposta (GET
// direto no arquivo, sem nenhum wrapper). Gitignored - artefato de build,
// não conteúdo do repositório.
app.use('/updates', express.static(updatesDir));

// Link "Download App" (TopBar do client, só aparece fora do Electron) -
// redireciona pro instalador MAIS RECENTE sem o client precisar saber nome
// de arquivo/versão (troca sozinho a cada release): lê o `path:` de
// latest.yml, o MESMO manifesto que o electron-updater já consome pra
// checar update (electron/main.js) - nunca fica desatualizado dos dois
// lados por acidente, é uma fonte só.
app.get('/download', (req, res) => {
  try {
    const yml = fs.readFileSync(path.join(updatesDir, 'latest.yml'), 'utf8');
    const filename = yml.match(/^path:\s*['"]?([^'"\n]+)['"]?\s*$/m)?.[1]?.trim();
    if (!filename) throw new Error('latest.yml sem campo "path"');
    res.redirect(`/updates/${encodeURIComponent(filename)}`);
  } catch {
    // Servidor novo, ainda sem nenhuma versão publicada em server/updates/
    // (ver deploy.md seção 20) - erro claro em vez de 404 genérico do
    // express.static.
    res.status(404).send('Nenhuma versão publicada ainda.');
  }
});

// Em produção, o próprio Express serve o bundle do client (gerado por
// `npm run build:client`) - assim a versão web roda inteira a partir de uma
// única origem/porta, sem precisar do Vite dev server rodando à parte. O
// fallback para index.html é o que permite o React Router lidar com rotas
// como /rooms/:roomId no navegador (refresh de página não vira 404).
if (env.NODE_ENV === 'production') {
  // Cache-Control explícito - sem isso o express.static manda só
  // `max-age=0` (fraco: alguns navegadores/Electron ainda servem do cache
  // local num reload normal em vez de revalidar, daí precisar de
  // Shift+F5 pra pegar build novo). index.html NUNCA pode vir do cache -
  // é ele que aponta pro nome (com hash) do JS/CSS atual, tem que ser
  // sempre buscado fresco. Os arquivos dentro de /assets JÁ têm o hash do
  // conteúdo no nome (Vite) - um build novo gera nomes novos, então cachear
  // esses PRA SEMPRE é 100% seguro (nunca fica stale, é literalmente uma
  // URL diferente quando o conteúdo muda) e livra banda/latência à toa.
  app.use(
    express.static(clientDistDir, {
      setHeaders(res, filePath) {
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-store');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(clientDistDir, 'index.html'), {
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

const httpServer = http.createServer(app);
const io = attachSockets(httpServer);
// A sinalização do mediasoup (voz/tela) também se anexa a este mesmo
// httpServer, através do mesmo servidor Socket.IO retornado acima.

// Exposto para rotas HTTP que precisam empurrar um evento em tempo real (ex.:
// friends.routes.js avisando o destinatário de uma solicitação de amizade
// pela room pessoal user:<publicId>, ver sockets/online.handler.js) - lido
// via req.app.get('io') no momento da requisição, não na definição da rota.
app.set('io', io);

async function start() {
  try {
    await assertDbConnection();
    console.log('Conexão com o PostgreSQL OK.');
  } catch (err) {
    console.error('Não foi possível conectar ao PostgreSQL. Confira DB_HOST/DB_USER/DB_PASSWORD no .env.');
    console.error(err.message);
    process.exit(1);
  }

  try {
    await createWorkers();
  } catch (err) {
    console.error('Não foi possível iniciar os workers do mediasoup (voz/tela).');
    console.error(err.message);
    process.exit(1);
  }

  // Antes de aceitar qualquer conexão: descarta presença/roster de voz
  // fantasma deixados por uma execução anterior deste processo (ver
  // comentário em config/redis.js). Roda antes do listen() de propósito -
  // nenhum socket consegue conectar antes da porta abrir.
  await resetEphemeralPresenceOnBoot();

  httpServer.listen(env.PORT, () => {
    console.log(`NaveSpeak server ouvindo em http://localhost:${env.PORT} (CORS: ${env.CORS_ORIGIN})`);
    if (env.NODE_ENV === 'production') {
      console.log(`Servindo o client a partir de ${clientDistDir}`);
    }
  });
}

start();
