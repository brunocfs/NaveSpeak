// Pool de conexão MySQL. Credenciais vêm exclusivamente de variáveis de ambiente
// (nunca hardcoded aqui) e o usuário configurado em DB_USER deve ser um usuário
// de aplicação com privilégios mínimos (ver database/schema.sql) - nunca root.
import mysql from 'mysql2/promise';
import { env } from './env.js';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
});

export async function assertDbConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}
