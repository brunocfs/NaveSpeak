-- NaveSpeak - schema MySQL
--
-- IMPORTANTE (seguranca): rode este script conectado com um usuario administrativo,
-- mas o SERVIDOR DA APLICACAO deve se conectar usando um usuario dedicado e com
-- privilegios minimos (apenas SELECT/INSERT/UPDATE/DELETE nas tabelas abaixo),
-- nunca o usuario "root". Exemplo:
--
--   CREATE USER 'navespeak_app'@'%' IDENTIFIED BY 'uma-senha-forte-unica';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON navespeak.* TO 'navespeak_app'@'%';
--   FLUSH PRIVILEGES;
--
-- Troque a senha acima pela mesma que voce colocar em DB_PASSWORD no .env.

CREATE DATABASE IF NOT EXISTS nvshom
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE navespeak;

-- Usuarios. Abordagem hibrida de ID:
--   * id BIGINT AUTO_INCREMENT -> chave primaria INTERNA, estreita e rapida
--     para joins, FKs e indices (melhor performance/escala).
--   * public_id CHAR(36) -> UUID exposto publicamente (tokens JWT, rotas da
--     API) para nao vazar a sequencia interna e dificultar enumeracao de IDs.
-- A checagem de autorizacao real acontece na camada da API (ver
-- server/src/routes), nunca so pelo formato do ID.
CREATE TABLE IF NOT EXISTS users (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL,
  username VARCHAR(32) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_public_id (public_id)
) ENGINE=InnoDB;

-- Refresh tokens sao guardados como HASH (nunca o token em texto puro), assim
-- um vazamento do banco nao da acesso direto a sessoes validas. Rotacionados
-- a cada uso (ver server/src/utils/tokens.js).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_refresh_tokens_hash (token_hash),
  KEY ix_refresh_tokens_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rooms (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  invite_code CHAR(12) NOT NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rooms_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rooms_invite_code (invite_code)
) ENGINE=InnoDB;

-- Tabela de membership: toda rota que devolve dados de uma sala (mensagens,
-- participantes, estado de voz) DEVE checar que existe uma linha aqui para
-- (room_id, user_id) antes de responder. Isso é o que evita IDOR - nao o
-- formato do ID.
CREATE TABLE IF NOT EXISTS room_members (
  room_id CHAR(36) NOT NULL,
  user_id BIGINT NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id),
  CONSTRAINT fk_room_members_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_room_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  user_id BIGINT NOT NULL,
  content VARCHAR(2000) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_messages_room FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY ix_messages_room_created (room_id, created_at)
) ENGINE=InnoDB;
