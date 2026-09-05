-- NaveSpeak - schema PostgreSQL
--
-- IMPORTANTE (seguranca): rode este script conectado com um usuario administrativo
-- (superuser ou owner do banco), mas o SERVIDOR DA APLICACAO deve se conectar
-- usando um usuario dedicado e com privilegios minimos (apenas SELECT/INSERT/
-- UPDATE/DELETE nas tabelas abaixo), nunca o superusuario. Exemplo:
--
--   CREATE ROLE navespeak_app WITH LOGIN PASSWORD 'uma-senha-forte-unica';
--   GRANT CONNECT ON DATABASE navespeak TO navespeak_app;
--   -- apos criar as tabelas (abaixo) no schema public, conceda privilegios:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--     TO navespeak_app;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO navespeak_app;
--
-- Troque a senha acima pela mesma que voce colocar em DB_PASSWORD no .env.
--
-- NOTE: ao contrario do MySQL, o PostgreSQL ja opera dentro de um banco de dados
-- previamente criado. Crie o banco (como superuser) antes de rodar este script,
-- ou descomente a linha abaixo caso tenha permissao:
--
-- CREATE DATABASE navespeak WITH ENCODING 'UTF8' LC_COLLATE 'pt_BR.UTF-8' LC_CTYPE 'pt_BR.UTF-8' TEMPLATE template0;

-- Usuarios. Abordagem hibrida de ID:
--   * id BIGSERIAL  -> chave primaria INTERNA, estreita e rapida para joins,
--     FKs e indices (melhor performance/escala em tabelas grandes).
--   * public_id UUID -> exposta publicamente (tokens JWT, rotas da API) para
--     nao vazar a sequencia interna e dificultar enumeracao de IDs.
-- A checagem de autorizacao real acontece na camada da API (ver
-- server/src/routes), nunca so pelo formato do ID.
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  public_id UUID NOT NULL,
  username VARCHAR(32) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  bio VARCHAR(280) NULL,
  avatar_path VARCHAR(255) NULL,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT uq_users_public_id UNIQUE (public_id)
);

-- MIGRACAO (bancos ja existentes, criados antes da tela de edicao de
-- perfil): CREATE TABLE IF NOT EXISTS acima nao adiciona coluna em tabela ja
-- existente, entao os ALTER TABLE abaixo cobrem esse caso. Idempotentes
-- (IF NOT EXISTS) - rodar de novo em banco que ja tem as colunas nao faz
-- nada. avatar_path guarda so o caminho RELATIVO servido em /uploads (ver
-- server/src/index.js), nunca a URL completa. updated_at e mantido pela
-- aplicacao (server/src/db/users.repo.js seta NOW() em cada UPDATE), sem
-- trigger.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(280) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Status de presenca escolhido pelo usuario (online/ocupado/ausente/
-- invisivel) - persistido para sobreviver a reconexoes/reinicios (ver
-- server/src/sockets/onlineStore.js, que guarda no Redis so o efemero:
-- quem esta CONECTADO agora e a flag de inatividade). 'invisivel' e a
-- preferencia real do dono; para os OUTROS usuarios ela sempre aparece
-- como offline (colapsada em onlineStore.getPublicStatus).
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'online';
ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_status;
ALTER TABLE users ADD CONSTRAINT ck_users_status CHECK (status IN ('online', 'busy', 'away', 'invisible'));

-- Usernames PODEM se repetir entre usuários (ver invite-only registration) -
-- o identificador público único vira o par (username, discriminator), no
-- formato exibido "username#12345" (ver server/src/utils/discriminator.js).
-- discriminator é atribuído no cadastro (server/src/db/users.repo.js#createUser,
-- que tenta um valor aleatório de 5 dígitos e retenta em colisão) e nunca
-- muda sozinho depois - só o índice único abaixo garante a regra no banco.
--
-- MIGRAÇÃO (bancos já existentes, criados antes do discriminator): a coluna
-- nasce NULLABLE, o bloco DO abaixo sorteia um discriminator único por
-- username para toda linha que ainda não tem um, e só então a coluna vira
-- NOT NULL e o índice antigo (um username = uma conta) é trocado pelo novo
-- (username, discriminator). Idempotente: rodar de novo não mexe em linha
-- que já tem discriminator.
ALTER TABLE users ADD COLUMN IF NOT EXISTS discriminator CHAR(5) NULL;
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
BEGIN
  FOR r IN SELECT id, username FROM users WHERE discriminator IS NULL LOOP
    LOOP
      candidate := lpad((floor(random() * 99999) + 1)::text, 5, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM users u2
        WHERE LOWER(u2.username) = LOWER(r.username) AND u2.discriminator = candidate
      );
    END LOOP;
    UPDATE users SET discriminator = candidate WHERE id = r.id;
  END LOOP;
END $$;
ALTER TABLE users ALTER COLUMN discriminator SET NOT NULL;
DROP INDEX IF EXISTS uq_users_username_lower;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_discriminator ON users (LOWER(username), discriminator);

-- Admin da APLICAÇÃO (não confundir com dono/role de servidor, que são por
-- sala) - só quem tem is_admin=true acessa o painel de convites
-- (server/src/middleware/requireAdmin.js). SEM bootstrap automático de
-- propósito: nenhum usuário nasce admin sozinho, promova o primeiro rodando
-- manualmente (troque o email):
--   UPDATE users SET is_admin = true WHERE email = 'voce@exemplo.com';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Refresh tokens sao guardados como HASH (nunca o token em texto puro), assim
-- um vazamento do banco nao da acesso direto a sessoes validas. Rotacionados
-- a cada uso (ver server/src/utils/tokens.js).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID NOT NULL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS rooms (
  id UUID NOT NULL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  invite_code CHAR(12) NOT NULL,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rooms_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_rooms_invite_code UNIQUE (invite_code)
);

-- Tabela de membership: toda rota que devolve dados de uma sala (mensagens,
-- participantes, estado de voz) DEVE checar que existe uma linha aqui para
-- (room_id, user_id) antes de responder. Isso é o que evita IDOR - nao o
-- formato do ID.
CREATE TABLE IF NOT EXISTS room_members (
  room_id UUID NOT NULL,
  user_id BIGINT NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id),
  CONSTRAINT fk_room_members_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_room_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Canais de texto ou voz dentro de um servidor (rooms.id = o servidor).
-- type: 'text' (recebe mensagens) | 'voice' (estado de voz fica no Redis,
-- nao nesta tabela). position ordena a exibicao na sidebar do servidor.
-- (server_id, name) unico para nao duplicar nomes no mesmo servidor.
CREATE TABLE IF NOT EXISTS channels (
  id UUID NOT NULL PRIMARY KEY,
  server_id UUID NOT NULL,
  type VARCHAR(8) NOT NULL,
  name VARCHAR(64) NOT NULL,
  topic VARCHAR(255) NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_channels_server FOREIGN KEY (server_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT uq_channels_server_name UNIQUE (server_id, name),
  CONSTRAINT ck_channels_type CHECK (type IN ('text', 'voice'))
);
CREATE INDEX IF NOT EXISTS ix_channels_server_pos ON channels (server_id, position);

-- Mensagens pertencem a um CANAL de texto (channels.id), e nao mais
-- diretamente a uma sala/servidor. A app so insere aqui quando
-- channels.type = 'text' (canal de voz nao recebe mensagens).
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL NOT NULL PRIMARY KEY,
  channel_id UUID NOT NULL,
  user_id BIGINT NOT NULL,
  content VARCHAR(2000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_messages_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_messages_channel_created ON messages (channel_id, created_at);

-- Anexos de arquivo de uma mensagem de canal (0..N por mensagem - ver
-- server/src/routes/attachments.routes.js pro upload em si; aqui so guarda a
-- referencia). "position" preserva a ordem de selecao no client.
CREATE TABLE IF NOT EXISTS message_attachments (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL,
  path VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  size INTEGER NOT NULL,
  mime VARCHAR(127) NOT NULL,
  position SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_message_attachments_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_message_attachments_message ON message_attachments (message_id);

-- Amizade: UMA linha por par de usuarios, independente da ordem - o indice
-- unico abaixo normaliza o par via LEAST/GREATEST, entao nao existe como
-- terem duas linhas (pendente + aceita, ou duas pendentes cruzadas) para o
-- mesmo par ao mesmo tempo. status 'pending' = requester_id pediu amizade e
-- aguarda resposta de addressee_id; 'accepted' = os dois sao amigos. Recusar
-- uma solicitacao, cancelar uma solicitacao enviada e desfazer uma amizade
-- aceita sao a MESMA operacao no app (DELETE da linha) - nao guardamos
-- historico de recusas.
CREATE TABLE IF NOT EXISTS friendships (
  id BIGSERIAL PRIMARY KEY,
  requester_id BIGINT NOT NULL,
  addressee_id BIGINT NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL,
  CONSTRAINT fk_friendships_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_friendships_addressee FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_friendships_status CHECK (status IN ('pending', 'accepted')),
  CONSTRAINT ck_friendships_not_self CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_friendships_pair
  ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS ix_friendships_addressee_pending ON friendships (addressee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_friendships_requester_pending ON friendships (requester_id) WHERE status = 'pending';

-- Bloqueio e DIRECIONAL (A bloquear B nao implica B bloquear A) - por isso PK
-- composta em vez do mesmo indice normalizado de friendships. Bloquear
-- alguem impede nova solicitacao de amizade e nova mensagem privada nos dois
-- sentidos (checado em routes/sockets, nunca so pelo formato do ID) e remove
-- a amizade existente entre os dois, se houver.
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id BIGINT NOT NULL,
  blocked_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT fk_user_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

-- Mensagens privadas (DM) entre dois usuarios. O ENVIO acontece via
-- WebSocket (server/src/sockets/dm.handler.js), igual ao chat de canal -
-- esta tabela so guarda o resultado para o historico paginado
-- (server/src/routes/dm.routes.js).
CREATE TABLE IF NOT EXISTS private_messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id BIGINT NOT NULL,
  recipient_id BIGINT NOT NULL,
  content VARCHAR(2000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_private_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_private_messages_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_private_messages_not_self CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS ix_private_messages_pair
  ON private_messages (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), id);

-- Mesma coisa que message_attachments, pro lado das DMs.
CREATE TABLE IF NOT EXISTS private_message_attachments (
  id BIGSERIAL PRIMARY KEY,
  private_message_id BIGINT NOT NULL,
  path VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  size INTEGER NOT NULL,
  mime VARCHAR(127) NOT NULL,
  position SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_private_message_attachments_message FOREIGN KEY (private_message_id) REFERENCES private_messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_private_message_attachments_message ON private_message_attachments (private_message_id);

-- Estado de leitura de uma conversa privada, POR USUARIO - duas colunas
-- independentes sobre o mesmo par (user_id, peer_id):
--   cleared_before     -> "limpar historico": esconde mensagens antigas so
--                         de quem limpou, sem apagar linha nenhuma nem
--                         afetar a leitura (ver privateMessages.repo.js).
--   last_read_message_id -> cursor de leitura: maior id de private_messages
--                         que o usuario ja viu nesta conversa. Contagem de
--                         nao lidas (badge na lista de amigos) = mensagens
--                         recebidas com id maior que este cursor. Atualizado
--                         ao abrir a conversa e, se ja estiver aberta, a
--                         cada mensagem nova (nunca so ao listar historico).
CREATE TABLE IF NOT EXISTS conversation_clears (
  user_id BIGINT NOT NULL,
  peer_id BIGINT NOT NULL,
  cleared_before BIGINT NOT NULL DEFAULT 0,
  last_read_message_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, peer_id),
  CONSTRAINT fk_conversation_clears_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversation_clears_peer FOREIGN KEY (peer_id) REFERENCES users(id) ON DELETE CASCADE
);
-- MIGRACAO (bancos ja existentes, criados antes do campo last_read_message_id):
ALTER TABLE conversation_clears ADD COLUMN IF NOT EXISTS last_read_message_id BIGINT NOT NULL DEFAULT 0;

-- Estado de leitura de um canal de TEXTO, POR USUARIO - mesmo padrao de
-- conversation_clears.last_read_message_id, so que sobre messages.id em vez
-- de private_messages.id. Contagem de nao lidas (badge no canal, e somada
-- por servidor na tela inicial) = mensagens do canal com id maior que este
-- cursor, excluindo as do proprio usuario. Atualizado ao abrir o canal e,
-- com ele ja aberto, a cada mensagem nova (ver ChatPanel.jsx/RoomPage.jsx).
CREATE TABLE IF NOT EXISTS channel_reads (
  user_id BIGINT NOT NULL,
  channel_id UUID NOT NULL,
  last_read_message_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel_id),
  CONSTRAINT fk_channel_reads_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_channel_reads_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

-- Report enviado por um usuario pela pagina /reports (ReportsPage.jsx):
-- relato de bug ou sugestao de melhoria. type distingue os dois; nao ha
-- status/atribuicao ainda - so registro + listagem (todo usuario
-- autenticado ve todos, ver reports.routes.js), por ser um grupo fechado.
CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type VARCHAR(10) NOT NULL,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(4000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reports_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_reports_type CHECK (type IN ('bug', 'suggestion'))
);
CREATE INDEX IF NOT EXISTS ix_reports_created ON reports (created_at DESC);

-- Imagem do servidor (permissao "Alterar nome/imagem do servidor") - mesmo
-- padrao de users.avatar_path: guarda so o caminho RELATIVO servido em
-- /uploads, nunca a URL completa.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS icon_path VARCHAR(255) NULL;

-- Descricao curta do servidor, opcional - exibida na pagina de convite
-- (/join/:code) junto do nome/imagem, ver ServerUserInvite.jsx.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS description VARCHAR(300) NULL;

-- rooms.invite_code era o convite ÚNICO por servidor (modelo antigo, um só
-- link, regenerar apagava o anterior). Substituido por server_invites
-- (abaixo) - múltiplos convites por servidor, cada um com validade e
-- histórico próprios. A coluna fica só por compatibilidade com bancos
-- antigos (migrateLegacyRoomInvites em migrate.js copia o valor pra
-- server_invites uma vez); linhas novas não preenchem mais isso, daí
-- precisar deixar de ser NOT NULL. Idempotente: já sem NOT NULL não dá erro
-- rodar de novo.
ALTER TABLE rooms ALTER COLUMN invite_code DROP NOT NULL;

-- Convites de servidor - substitui o invite_code único de `rooms` (acima)
-- por N convites por servidor, cada um com seu criador, validade (30 dias,
-- regra de negócio) e possibilidade de ser revogado sem apagar - fica visível
-- na aba "Convites" de ServerSettingsModal.jsx pra quem tem CREATE_INVITE.
CREATE TABLE IF NOT EXISTS server_invites (
  id UUID NOT NULL PRIMARY KEY,
  server_id UUID NOT NULL,
  code CHAR(12) NOT NULL,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL,
  revoked_by BIGINT NULL,
  CONSTRAINT fk_server_invites_server FOREIGN KEY (server_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_server_invites_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_server_invites_revoked_by FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_server_invites_code UNIQUE (code)
);
CREATE INDEX IF NOT EXISTS ix_server_invites_server ON server_invites (server_id);

-- Histórico auditado de quem entrou por qual convite - uma linha por uso
-- (POST /rooms/join, ver rooms.routes.js). Deletar o convite (DELETE
-- /rooms/:roomId/invites/:inviteId) apaga o histórico dele junto (cascade) -
-- revogar (revoked_at) preserva tudo, é a ação reversível/auditável.
CREATE TABLE IF NOT EXISTS server_invite_uses (
  id BIGSERIAL PRIMARY KEY,
  invite_id UUID NOT NULL,
  user_id BIGINT NOT NULL,
  used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_server_invite_uses_invite FOREIGN KEY (invite_id) REFERENCES server_invites(id) ON DELETE CASCADE,
  CONSTRAINT fk_server_invite_uses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_server_invite_uses_invite ON server_invite_uses (invite_id);

-- Configuracoes de exibicao do servidor - hoje so o modo da lista de
-- membros (agrupada por role vs. simples online/offline, ver
-- server/src/pages/RoomPage.jsx). Criada sob demanda pelo repo (INSERT ...
-- ON CONFLICT DO NOTHING) na primeira leitura, entao servidores criados
-- antes desta tabela existir nao precisam de backfill.
CREATE TABLE IF NOT EXISTS server_settings (
  server_id UUID NOT NULL PRIMARY KEY,
  member_list_mode VARCHAR(10) NOT NULL DEFAULT 'grouped',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_server_settings_server FOREIGN KEY (server_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT ck_server_settings_member_list_mode CHECK (member_list_mode IN ('grouped', 'simple'))
);

-- Roles personalizadas por servidor (nome, cor, permissoes). O CRIADOR do
-- servidor (rooms.created_by) tem TODAS as permissoes sempre, independente
-- de qualquer role - essa regra vive no codigo (server/src/utils/permissions.js),
-- nao no banco. `permissions` e uma bitmask (ver PERMISSIONS em
-- permissions.js) - cabe em INTEGER (32 bits), so usamos 9 flags hoje.
-- `position` ordena a exibicao e decide, quando um membro tem mais de uma
-- role, sob qual delas ele aparece agrupado na lista de membros (a de maior
-- position) - maior = mais "alta" na hierarquia de exibicao.
CREATE TABLE IF NOT EXISTS roles (
  id UUID NOT NULL PRIMARY KEY,
  server_id UUID NOT NULL,
  name VARCHAR(32) NOT NULL,
  color CHAR(7) NOT NULL DEFAULT '#99AAB5',
  permissions INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_roles_server FOREIGN KEY (server_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT ck_roles_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);
CREATE INDEX IF NOT EXISTS ix_roles_server_position ON roles (server_id, position DESC);

-- Atribuicao de roles a usuarios - varios-para-varios, um usuario pode ter
-- mais de uma role no mesmo servidor.
CREATE TABLE IF NOT EXISTS role_members (
  role_id UUID NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, user_id),
  CONSTRAINT fk_role_members_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_role_members_user ON role_members (user_id);

-- Controle de acesso por canal: cada coluna aponta para a role EXIGIDA para
-- ver/enviar mensagem/compartilhar mídia (audio/webcam/tela) neste canal.
-- NULL = sem restricao (qualquer membro do servidor, comportamento padrao).
-- ON DELETE SET NULL: remover a role some com a restricao, nunca quebra o
-- canal.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS view_role_id UUID NULL;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS send_role_id UUID NULL;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS share_role_id UUID NULL;
ALTER TABLE channels DROP CONSTRAINT IF EXISTS fk_channels_view_role;
ALTER TABLE channels ADD CONSTRAINT fk_channels_view_role FOREIGN KEY (view_role_id) REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE channels DROP CONSTRAINT IF EXISTS fk_channels_send_role;
ALTER TABLE channels ADD CONSTRAINT fk_channels_send_role FOREIGN KEY (send_role_id) REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE channels DROP CONSTRAINT IF EXISTS fk_channels_share_role;
ALTER TABLE channels ADD CONSTRAINT fk_channels_share_role FOREIGN KEY (share_role_id) REFERENCES roles(id) ON DELETE SET NULL;

-- Banimento de servidor (permissao "Banir/expulsar usuarios"): distinto de
-- so remover de room_members (expulsar) - um usuario banido nao consegue
-- reentrar pelo invite_code enquanto a linha existir aqui (ver
-- server/src/db/rooms.repo.js#addRoomMember e a rota POST /rooms/join).
CREATE TABLE IF NOT EXISTS server_bans (
  server_id UUID NOT NULL,
  user_id BIGINT NOT NULL,
  banned_by BIGINT NULL,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (server_id, user_id),
  CONSTRAINT fk_server_bans_server FOREIGN KEY (server_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_server_bans_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_server_bans_banned_by FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Convite de cadastro (invite-only registration, ver server/src/routes/invites.routes.js
-- e INVITE_ONLY no .env). `code` é o token que vai na URL de convite
-- (/invite/:code -> /register?invite=:code). `type` só documenta como o
-- convite foi distribuído ('email' = admin mandou pra um endereço via
-- utils/mailer.js, 'link' = link genérico pra compartilhar) - o e-mail em si
-- NÃO restringe quem pode resgatar o convite, só quem recebeu o link
-- primeiro. uses_count/max_uses controla o limite de contas: o UPDATE
-- atômico em invites.repo.js#consumeInvite (WHERE uses_count < max_uses)
-- garante que o limite nunca é ultrapassado mesmo sob concorrência - dois
-- cadastros simultâneos no último uso disponível não conseguem os dois
-- passar.
CREATE TABLE IF NOT EXISTS invites (
  id UUID NOT NULL PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  type VARCHAR(10) NOT NULL,
  email VARCHAR(255) NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses_count INTEGER NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  revoked_at TIMESTAMP NULL,
  CONSTRAINT fk_invites_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_invites_code UNIQUE (code),
  CONSTRAINT ck_invites_type CHECK (type IN ('email', 'link')),
  CONSTRAINT ck_invites_max_uses CHECK (max_uses >= 1)
);
CREATE INDEX IF NOT EXISTS ix_invites_created_by ON invites (created_by);

-- Uma linha por conta criada a partir de um convite - é o que alimenta o
-- "acompanhamento" no painel admin (quem entrou, quando, por qual convite).
-- UNIQUE (invite_id, user_id) é só defensivo (um usuário só existe uma vez,
-- criado uma única vez a partir de no máximo um convite).
CREATE TABLE IF NOT EXISTS invite_redemptions (
  id BIGSERIAL PRIMARY KEY,
  invite_id UUID NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invite_redemptions_invite FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE CASCADE,
  CONSTRAINT fk_invite_redemptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_invite_redemptions_user UNIQUE (invite_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_invite_redemptions_invite ON invite_redemptions (invite_id);

-- MIGRACAO (bancos ja existentes que ainda tem messages.room_id):
-- 1) a tabela channels acima e criada normalmente (CREATE TABLE IF NOT EXISTS);
-- 2) para cada servidor existente, crie um canal texto padrao e repoint:
--    INSERT INTO channels (id, server_id, type, name, position)
--      SELECT gen_random_uuid(), r.id, 'text', 'geral', 0 FROM rooms r;
--    UPDATE messages m
--      SET channel_id = c.id
--      FROM channels c
--      WHERE c.server_id = m.room_id AND c.name = 'geral';
-- 3) remova a FK e a coluna antiga:
--    ALTER TABLE messages DROP CONSTRAINT fk_messages_room;
--    ALTER TABLE messages DROP COLUMN room_id;
