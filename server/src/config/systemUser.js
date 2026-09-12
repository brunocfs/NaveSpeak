// Identidade fixa da conta oficial do sistema ("Zeno, o Astronauta") -
// única fonte de verdade pro public_id/username/discriminator/email usados
// tanto pela seed (server/migrate.js:ensureSystemUser) quanto pelas rotas
// que enviam mensagem "como" o Zeno (routes/adminBroadcasts.routes.js).
// Username com vírgula/espaço nunca colide com cadastro de usuário real -
// usernameFieldSchema (validation/schemas.js) proíbe isso pra contas
// normais; o Zeno é inserido direto via SQL, fora desse fluxo.
export const SYSTEM_PUBLIC_ID = '00000000-0000-0000-0000-000000000001';
export const SYSTEM_USERNAME = 'Zeno, o Astronauta';
export const SYSTEM_DISCRIMINATOR = '00001';
export const SYSTEM_EMAIL = 'zeno@navespeak.internal';
