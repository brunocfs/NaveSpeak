// Executa o schema do banco (database/schema-postgre.sql) no PostgreSQL
// configurado via variáveis de ambiente (DB_HOST/DB_PORT/DB_NAME/DB_USER/
// DB_PASSWORD). Rodado por `npm run migrate` (veja package.json).
//
// O schema usa CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, então
// rodar o script repetidas vezes é seguro (idempotente) - não recria tabelas
// nem apaga dados existentes.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { config as loadDotenv } from 'dotenv';
import { hashPassword } from './src/utils/password.js';
import {
  SYSTEM_PUBLIC_ID,
  SYSTEM_USERNAME,
  SYSTEM_DISCRIMINATOR,
  SYSTEM_EMAIL,
} from './src/config/systemUser.js';

loadDotenv();

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Faltam variáveis de ambiente obrigatórias: ${missing.join(', ')}`);
  console.error('Confira o arquivo .env (ver .env.example).');
  process.exit(1);
}

const schemaPath = path.join(__dirname, '..', 'database', 'schema-postgre.sql');

// Converte bancos antigos (que ainda têm messages.room_id) para o novo modelo
// de canais. É idempotente: se a coluna room_id não existir, não faz nada. Usa
// UUIDs do próprio Node (randomUUID) para não depender de extensões do Postgres.
async function migrateLegacyMessages(pool) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'messages' AND column_name = 'room_id'
     LIMIT 1`
  );
  if (rows.length === 0) return; // já no formato novo (channel_id)

  console.log('Convertendo mensagens antigas (room_id -> canal de texto "geral")...');
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel_id UUID;`);

  const { rows: servers } = await pool.query(`SELECT id FROM rooms`);
  for (const { id } of servers) {
    const textId = randomUUID();
    const voiceId = randomUUID();
    await pool.query(
      `INSERT INTO channels (id, server_id, type, name, topic, position, created_at)
       VALUES ($1, $2, 'text', 'geral', NULL, 0, NOW()),
              ($3, $2, 'voice', 'Voz', NULL, 1, NOW())`,
      [textId, id, voiceId]
    );
    await pool.query(`UPDATE messages SET channel_id = $1 WHERE room_id = $2`, [textId, id]);
  }

  // Segurança: não deveria sobrar nenhuma mensagem sem canal.
  await pool.query(
    `UPDATE messages SET channel_id = $1 WHERE channel_id IS NULL`,
    ['00000000-0000-0000-0000-000000000000']
  );
  await pool.query(`ALTER TABLE messages DROP CONSTRAINT IF EXISTS fk_messages_room`);
  await pool.query(`ALTER TABLE messages ALTER COLUMN channel_id SET NOT NULL`);
  await pool.query(
    `ALTER TABLE messages ADD CONSTRAINT fk_messages_channel
     FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE`
  );
  await pool.query(`ALTER TABLE messages DROP COLUMN room_id`);
  console.log(`Convertidas ${servers.length} sala(s) para o modelo de canais.`);
}

// Convite de servidor era 1 código único em rooms.invite_code (modelo
// antigo); virou N linhas em server_invites (múltiplos convites, cada um
// com criador/validade próprios - ver database/schema-postgre.sql). Idempotente:
// só cria uma linha "de migração" pro servidor que ainda não tem NENHUM
// convite em server_invites, então rodar de novo não duplica. Convites
// gerados depois da migração (via UI) não entram aqui.
async function migrateLegacyRoomInvites(pool) {
  const { rows: rooms } = await pool.query(
    `SELECT r.id, r.invite_code, r.created_by
     FROM rooms r
     WHERE r.invite_code IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM server_invites si WHERE si.server_id = r.id)`
  );
  if (rooms.length === 0) return;

  console.log(`Migrando ${rooms.length} convite(s) de servidor pro modelo novo (server_invites)...`);
  for (const room of rooms) {
    // Não dá pra saber a validade "original" (a coluna antiga não tinha
    // expiração) - conta os 30 dias a partir de agora, igual a um convite
    // recém-criado.
    await pool.query(
      `INSERT INTO server_invites (id, server_id, code, created_by, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days')
       ON CONFLICT (code) DO NOTHING`,
      [randomUUID(), room.id, room.invite_code, room.created_by]
    );
  }
}

// Garante que a conta oficial ("Zeno, o Astronauta") exista, sem nunca
// sobrescrever uma linha já existente (ON CONFLICT DO NOTHING no
// public_id fixo, ver src/config/systemUser.js) - idempotente, mesmo padrão
// das migrações legadas acima. password_hash é o hash de um UUID aleatório
// que ninguém guarda em lugar nenhum: login por essa conta é impossível.
async function ensureSystemUser(pool) {
  const passwordHash = await hashPassword(randomUUID());
  await pool.query(
    `INSERT INTO users (public_id, username, discriminator, email, password_hash, is_system)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (public_id) DO NOTHING`,
    [SYSTEM_PUBLIC_ID, SYSTEM_USERNAME, SYSTEM_DISCRIMINATOR, SYSTEM_EMAIL, passwordHash]
  );
}

async function main() {
  const sql = await readFile(schemaPath, 'utf8');

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await pool.query(sql);
    await migrateLegacyMessages(pool);
    await migrateLegacyRoomInvites(pool);
    await ensureSystemUser(pool);
    console.log(`Migração aplicada com sucesso em "${process.env.DB_NAME}" (PostgreSQL).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Falha ao aplicar a migração:');
  console.error(err.message);
  process.exit(1);
});
