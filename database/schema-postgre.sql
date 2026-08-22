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
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT uq_users_public_id UNIQUE (public_id)
);

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

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL NOT NULL PRIMARY KEY,
  room_id UUID NOT NULL,
  user_id BIGINT NOT NULL,
  content VARCHAR(2000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_messages_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_messages_room_created ON messages (room_id, created_at);
