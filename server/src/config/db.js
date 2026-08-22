// Pool de conexão PostgreSQL. Credenciais vêm exclusivamente de variáveis de ambiente
// (nunca hardcoded aqui) e o usuário configurado em DB_USER deve ser um usuário
// de aplicação com privilégios mínimos (ver database/schema-postgre.sql) - nunca
// um superusuário. A conexão MySQL antiga foi preservada em db.mysql.js.
import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  max: 10,
  // O pool do pg converte strings da coluna em JS por padrão; manter o
  // comportamento nativo evita surpresas com tipos numéricos grandes.
});

export async function assertDbConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
