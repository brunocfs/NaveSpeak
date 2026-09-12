// Cria (ou confirma que já existe) só a conta oficial do sistema ("Zeno, o
// Astronauta") - `npm run seed:system-user` (veja package.json). Diferente
// de migrate.js (que aplica database/schema-postgre.sql inteiro, exigindo um
// usuário de banco com permissão de CREATE/ALTER), este script SÓ FAZ
// INSERT - roda com o mesmo usuário de aplicação de privilégio mínimo que a
// própria API usa em produção (DB_USER do .env, ver deploy.md seção 7:
// `navespeak_app` só tem GRANT de SELECT/INSERT/UPDATE/DELETE).
//
// Uso na VPS (depois de aplicar o schema atualizado via
// `sudo -u postgres psql -d navespeak -f database/schema-postgre.sql`,
// que já cria as colunas/tabela que este script pressupõe):
//   cd /opt/navespeak/server && npm run seed:system-user
import pg from 'pg';
import { config as loadDotenv } from 'dotenv';
import { ensureSystemUser } from './src/db/seedSystemUser.js';

loadDotenv();

const { Pool } = pg;

const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Faltam variáveis de ambiente obrigatórias: ${missing.join(', ')}`);
  console.error('Confira o arquivo .env (ver .env.example).');
  process.exit(1);
}

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await ensureSystemUser(pool);
    console.log('OK: conta oficial ("Zeno, o Astronauta") existe (criada agora ou já existia).');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Falha ao criar a conta oficial:');
  console.error(err.message);
  process.exit(1);
});
