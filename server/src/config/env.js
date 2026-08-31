// Carrega e valida as variaveis de ambiente uma unica vez na inicializacao.
// Falha rapido (processo nao sobe) se algum segredo obrigatorio estiver faltando -
// isso evita que o servidor rode "acidentalmente" com segredo vazio/default.
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN é obrigatório'),

  DB_HOST: z.string().min(1),
  // MySQL=3306, PostgreSQL=5432. O .env define o valor real.
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD é obrigatório - o banco não pode ficar sem senha'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET deve ter pelo menos 16 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET deve ter pelo menos 16 caracteres'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  MEDIASOUP_ANNOUNCED_IP: z.string().optional().default(''),
  MEDIASOUP_MIN_PORT: z.coerce.number().int().positive().default(40000),
  MEDIASOUP_MAX_PORT: z.coerce.number().int().positive().default(40100),

  // Redis: usado para rate limit compartilhado, presença online/offline e
  // cache de mensagens. O adapter do socket.io também usa essa URL quando
  // ENABLE_REDIS_ADAPTER=true (modo multi-instância). Opcional.
  REDIS_URL: z.string().optional().default('redis://127.0.0.1:6379'),
  // Liga o adapter Redis do socket.io (necessário só para multi-instância).
  // false = adapter em memória (single-instance, funciona sem Redis).
  ENABLE_REDIS_ADAPTER: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  // ---- Cadastro (registro/invite-only) ----
  // true = POST /auth/register exige um convite válido (ver
  // routes/invites.routes.js e routes/auth.routes.js); false = cadastro
  // público liberado, convite é ignorado mesmo se enviado.
  INVITE_ONLY: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Origem usada para montar o link de convite (ex.: no email enviado por
  // utils/mailer.js): "<APP_BASE_URL>/invite/<code>". Cai em CORS_ORIGIN
  // quando vazio - mesma origem que o client já usa em desenvolvimento, e a
  // única origem válida em produção (client servido pelo próprio Express).
  APP_BASE_URL: z.string().optional().default(''),

  // ---- SMTP (convite por email, utils/mailer.js) ----
  // Todos opcionais: sem SMTP_HOST configurado, o envio de email cai em
  // fallback (loga o link no console do servidor em vez de falhar) - o
  // convite continua sendo criado e utilizável pelo link normalmente, só o
  // envio automático por email fica indisponível até configurar isto.
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  // Endereço "De:" nos emails de convite - cai em SMTP_USER quando vazio.
  SMTP_FROM: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Configuração de ambiente inválida:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nConfira o .env contra o .env.example e preencha os valores faltantes.');
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
  console.error('JWT_ACCESS_SECRET e JWT_REFRESH_SECRET não podem ser iguais em produção.');
  process.exit(1);
}

export const env = parsed.data;
