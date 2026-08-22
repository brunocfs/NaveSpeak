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
import pg from 'pg';
import { config as loadDotenv } from 'dotenv';

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
