// Garante que a conta oficial ("Zeno, o Astronauta") exista - idempotente
// (ON CONFLICT DO NOTHING no public_id fixo, ver config/systemUser.js).
// password_hash é o hash de um UUID aleatório que ninguém guarda em lugar
// nenhum: login por essa conta é impossível.
//
// De propósito só faz INSERT, nunca DDL (CREATE/ALTER) - isso separa esta
// função do resto de migrate.js (que aplica database/schema-postgre.sql
// inteiro) justamente pra poder rodar sozinha com um usuário de banco de
// privilégio MÍNIMO em produção (ver server/seedSystemUser.js e a seção de
// deploy no VPS em deploy.md), que só tem GRANT de
// SELECT/INSERT/UPDATE/DELETE - nunca CREATE/ALTER TABLE.
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../utils/password.js';
import {
  SYSTEM_PUBLIC_ID,
  SYSTEM_USERNAME,
  SYSTEM_DISCRIMINATOR,
  SYSTEM_EMAIL,
} from '../config/systemUser.js';

export async function ensureSystemUser(pool) {
  const passwordHash = await hashPassword(randomUUID());
  await pool.query(
    `INSERT INTO users (public_id, username, discriminator, email, password_hash, is_system)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (public_id) DO NOTHING`,
    [SYSTEM_PUBLIC_ID, SYSTEM_USERNAME, SYSTEM_DISCRIMINATOR, SYSTEM_EMAIL, passwordHash]
  );
}
