// Schemas de validação compartilhados entre rotas HTTP e handlers de socket,
// para que a mesma regra (tamanho, formato) valha nos dois transportes.
import { z } from 'zod';

export const roomNameSchema = z.object({
  name: z.string().trim().min(1, 'Nome da sala é obrigatório.').max(64, 'Nome muito longo.'),
});

export const inviteCodeSchema = z.object({
  inviteCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-F0-9]{12}$/, 'Código de convite inválido.'),
});

// Mesmo formato de inviteCodeSchema.shape.inviteCode, mas como schema solto
// (não objeto) - usado pra validar o :code de GET /rooms/invite/:code
// (parâmetro de rota, não body).
export const roomInviteCodeParamSchema = inviteCodeSchema.shape.inviteCode;

export const roomIdParamSchema = z.string().uuid('ID de sala inválido.');

export const inviteIdParamSchema = z.string().uuid('ID de convite inválido.');

export const channelIdParamSchema = z.string().uuid('ID de canal inválido.');

// media:join aceita tanto um canal de voz de servidor (UUID puro) quanto uma
// chamada privada (prefixo "call:" + UUID, ver sockets/calls.handler.js) - é
// esse prefixo que permite ao mediasoup.handler.js tratar os dois com o
// MESMO pipeline de sinalização (join/transport/produce/consume) sem
// precisar de um segundo conjunto de eventos redundante, só trocando a
// checagem de autorização.
export const mediaChannelIdSchema = z.string().refine(
  (v) =>
    channelIdParamSchema.safeParse(v).success ||
    (v.startsWith('call:') && z.string().uuid().safeParse(v.slice(5)).success),
  { message: 'ID de canal inválido.' }
);

export const channelTypeSchema = z
  .enum(['text', 'voice'], { errorMap: () => ({ message: 'Tipo de canal inválido.' }) });

export const channelNameSchema = z
  .string()
  .trim()
  .min(1, 'Nome do canal é obrigatório.')
  .max(64, 'Nome muito longo.');

export const channelCreateSchema = z.object({
  name: channelNameSchema,
  type: channelTypeSchema,
  topic: z.string().trim().max(255, 'Tópico muito longo.').optional().nullable(),
  // Role exigida para ver/enviar mensagem/compartilhar mídia neste canal -
  // null ou ausente = sem restrição (qualquer membro), ver
  // utils/permissions.js#canAccessChannel.
  viewRoleId: z.string().uuid('ID de role inválido.').nullable().optional(),
  sendRoleId: z.string().uuid('ID de role inválido.').nullable().optional(),
  shareRoleId: z.string().uuid('ID de role inválido.').nullable().optional(),
});

// Roles de servidor (nome, cor, permissões, posição) - server/src/routes/roles.routes.js.
export const roleNameSchema = z.string().trim().min(1, 'Nome da role é obrigatório.').max(32, 'Nome muito longo.');
export const roleColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida (use #rrggbb).');
export const rolePermissionsSchema = z.number().int().min(0, 'Permissões inválidas.');
export const rolePositionSchema = z.number().int();

export const roleCreateSchema = z.object({
  name: roleNameSchema,
  color: roleColorSchema.optional(),
  permissions: rolePermissionsSchema.optional(),
  position: rolePositionSchema.optional(),
});

export const roleUpdateSchema = z
  .object({
    name: roleNameSchema.optional(),
    color: roleColorSchema.optional(),
    permissions: rolePermissionsSchema.optional(),
    position: rolePositionSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nenhum campo para atualizar.' });

export const roleIdParamSchema = z.string().uuid('ID de role inválido.');

// Acesso por canal: cada campo é o id da role EXIGIDA, ou null para "sem
// restrição" (qualquer membro) - server/src/utils/permissions.js#canAccessChannel.
const channelRoleFieldSchema = z.string().uuid('ID de role inválido.').nullable();

export const channelUpdateSchema = z
  .object({
    name: channelNameSchema.optional(),
    topic: z.string().trim().max(255, 'Tópico muito longo.').optional().nullable(),
    position: z.number().int().optional(),
    viewRoleId: channelRoleFieldSchema.optional(),
    sendRoleId: channelRoleFieldSchema.optional(),
    shareRoleId: channelRoleFieldSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nenhum campo para atualizar.' });

// Configurações gerais do servidor (rooms.routes.js).
export const serverSettingsUpdateSchema = z.object({
  memberListMode: z.enum(['grouped', 'simple'], { errorMap: () => ({ message: 'Modo inválido.' }) }),
});

export const roomUpdateSchema = z
  .object({
    name: roomNameSchema.shape.name.optional(),
    // Mesmo formato de avatarUploadSchema.image (data URL completo) -
    // revalidado a partir dos bytes decodificados em rooms.routes.js.
    icon: z
      .string()
      .regex(/^data:image\/(png|jpe?g|webp|gif);base64,/, 'Formato de imagem não suportado.')
      .nullable()
      .optional(),
    // Exibida na página de convite (/join/:code) - null remove a descrição.
    description: z.string().trim().max(300, 'Descrição muito longa.').nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nenhum campo para atualizar.' });

export const friendRequestIdParamSchema = z.coerce
  .number()
  .int('ID de solicitação inválido.')
  .positive('ID de solicitação inválido.');

export const userIdParamSchema = z.string().uuid('ID de usuário inválido.');

export const messageContentSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .min(1, 'Mensagem vazia.')
      .max(2000, 'Mensagem muito longa (máx. 2000 caracteres).')
  );

// Campos de identidade compartilhados entre cadastro (auth.routes.js) e
// edição de perfil (users.routes.js) - uma única fonte de regra evita que os
// dois pontos de entrada validem "quase a mesma coisa" e um dia divirjam.
export const usernameFieldSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_]{3,32}$/, 'Username deve ter 3-32 caracteres (letras, números, _).');

export const emailFieldSchema = z.string().trim().toLowerCase().email('Email inválido.').max(255);

// Identificador público único (friends.routes.js: pedido de amizade e
// bloqueio por tag, agora que username sozinho pode se repetir entre
// contas - ver discriminator em users.repo.js). Formato exibido em toda a
// aplicação: "username#12345".
export const userTagSchema = z.object({
  tag: z
    .string()
    .trim()
    .refine((v) => /^.{3,32}#\d{5}$/.test(v), 'Formato esperado: usuario#12345.'),
});

// Convites de cadastro (invite-only registration) - routes/invites.routes.js.
export const inviteTypeSchema = z.enum(['email', 'link'], {
  errorMap: () => ({ message: 'Tipo de convite inválido.' }),
});

export const inviteCreateSchema = z
  .object({
    type: inviteTypeSchema,
    email: emailFieldSchema.optional(),
    maxUses: z.coerce.number().int().min(1, 'Mínimo de 1 uso.').max(1000, 'Máximo de 1000 usos.').default(1),
    expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
  })
  .refine((data) => data.type !== 'email' || Boolean(data.email), {
    message: 'Email é obrigatório para convite por email.',
    path: ['email'],
  });

// Não confundir com inviteCodeSchema no topo do arquivo (esse é o
// invite_code de SALA, formato fixo A-F0-9{12}) - este é o code da tabela
// `invites` (cadastro), gerado em invites.repo.js com outro formato/tamanho.
export const registrationInviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(4, 'Código de convite inválido.')
  .max(32, 'Código de convite inválido.');

// Mínimo 10 caracteres, pelo menos uma letra e um número.
export const passwordFieldSchema = z
  .string()
  .min(10, 'Senha deve ter pelo menos 10 caracteres.')
  .max(200)
  .regex(/[A-Za-z]/, 'Senha deve conter ao menos uma letra.')
  .regex(/[0-9]/, 'Senha deve conter ao menos um número.');

export const bioFieldSchema = z.string().trim().max(280, 'Bio muito longa (máx. 280 caracteres).');

// Preferência de presença: 'invisible' é a única que difere do que os
// OUTROS usuários enxergam (aparece como offline pra eles - ver
// sockets/onlineStore.js getPublicStatus).
export const userStatusSchema = z.enum(['online', 'busy', 'away', 'invisible'], {
  errorMap: () => ({ message: 'Status inválido.' }),
});

export const statusUpdateSchema = z.object({
  status: userStatusSchema,
});

// PATCH parcial: cada campo é opcional, mas pelo menos um precisa vir -
// senão a rota receberia um corpo vazio e não teria o que atualizar.
export const profileUpdateSchema = z
  .object({
    username: usernameFieldSchema.optional(),
    email: emailFieldSchema.optional(),
    bio: bioFieldSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nenhum campo para atualizar.' });

// Perfil da conta oficial ("Zeno, o Astronauta" - routes/adminSystemUser.routes.js).
// NÃO reusa usernameFieldSchema: aquele regex (só letras/números/_) existe
// pra impedir usuário comum de escolher um nome "estranho", mas o nome de
// exibição do Zeno é de propósito uma frase com vírgula/espaço - só mais
// permissivo (qualquer texto, mesmo limite de tamanho da coluna) porque só
// admin chega nesta rota (requireAdmin).
// Personalização de exibição do nome (cor/gradiente, negrito/itálico/
// sublinhado, fonte, efeito) - ver name_style no schema e
// client/src/components/StyledUsername.jsx, que é quem realmente interpreta
// cada campo. Objeto sempre substituído por inteiro (nunca merge parcial no
// banco, ver updateProfile em db/users.repo.js), então aqui valida a FORMA
// completa - cada campo é opcional (omitido = "sem esse estilo").
const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #RRGGBB).');

export const nameStyleSchema = z
  .object({
    color: hexColorSchema.nullable().optional(),
    gradient: z.tuple([hexColorSchema, hexColorSchema]).nullable().optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    font: z.enum(['default', 'serif', 'mono', 'display']).optional(),
    effect: z.enum(['none', 'shine', 'pulse']).optional(),
  })
  .strict();

export const systemUserUpdateSchema = z
  .object({
    username: z.string().trim().min(1, 'Nome obrigatório.').max(32, 'Máximo de 32 caracteres.').optional(),
    bio: bioFieldSchema.optional(),
    nameStyle: nameStyleSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nenhum campo para atualizar.' });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.').max(200),
    newPassword: passwordFieldSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'A nova senha deve ser diferente da atual.',
    path: ['newPassword'],
  });

// Report de bug/sugestão (reports.routes.js) - ver ReportsPage.jsx.
export const reportTypeSchema = z.enum(['bug', 'suggestion'], {
  errorMap: () => ({ message: 'Tipo de report inválido.' }),
});

export const reportCreateSchema = z.object({
  type: reportTypeSchema,
  title: z.string().trim().min(1, 'Título é obrigatório.').max(120, 'Título muito longo (máx. 120 caracteres).'),
  description: z
    .string()
    .trim()
    .min(1, 'Descrição é obrigatória.')
    .max(4000, 'Descrição muito longa (máx. 4000 caracteres).'),
});

// `image` é o data URL completo (ex.: "data:image/png;base64,AAAA...") - só
// o formato do prefixo é checado aqui; o tipo e o tamanho REAIS são
// revalidados a partir dos bytes decodificados em users.routes.js, nunca só
// pelo que o cliente diz que está mandando.
export const avatarUploadSchema = z.object({
  image: z
    .string()
    .min(1, 'Selecione uma imagem.')
    .regex(/^data:image\/(png|jpe?g|webp|gif);base64,/, 'Formato de imagem não suportado.'),
});

// POST /api/attachments (attachments.routes.js) - upload de UM arquivo por
// chamada. fileData é revalidado a partir dos bytes decodificados
// (decodeAttachmentDataUrl em utils/attachmentUpload.js), nunca só pelo mime
// que o client declara aqui.
export const attachmentUploadBodySchema = z.object({
  fileData: z
    .string()
    .min(1, 'Selecione um arquivo.')
    .regex(/^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,/, 'Arquivo inválido.'),
  fileName: z.string().trim().min(1, 'Nome de arquivo obrigatório.').max(255, 'Nome muito longo.'),
});

// Referência a um anexo JÁ enviado (POST /api/attachments), usada no payload
// de chat:send/dm:send. `path` é revalidado nos handlers de socket contra o
// padrão gravado em disco (attachments/<uuid>-<nome>) e contra a existência
// real do arquivo - isto aqui só garante o formato do payload.
export const attachmentRefSchema = z.object({
  path: z.string().regex(/^attachments\/[0-9a-f-]{36}-.{1,200}$/, 'Anexo inválido.'),
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  mime: z.string().min(1).max(127),
});

export const attachmentsArraySchema = z
  .array(attachmentRefSchema)
  .max(10, 'Máximo de 10 anexos por mensagem.');

// Corpo do POST /api/admin/broadcasts (routes/adminBroadcasts.routes.js) -
// `tag` só é exigido/validado quando target = 'user' (envio individual); no
// broadcast pra todos ('all') não há destinatário nenhum pra validar.
// `content` pode vir vazio se houver ao menos 1 anexo - mesma regra de
// chat:send/dm:send (aplicada manualmente na rota, não dá pra expressar só
// com messageContentSchema porque ele já exige min(1)).
export const adminBroadcastCreateSchema = z
  .object({
    target: z.enum(['all', 'user'], { errorMap: () => ({ message: 'Alvo inválido.' }) }),
    content: z.string().trim().max(2000, 'Mensagem muito longa (máx. 2000 caracteres).').default(''),
    tag: z.string().trim().optional(),
    attachments: attachmentsArraySchema.default([]),
  })
  .refine((data) => data.content.length > 0 || data.attachments.length > 0, {
    message: 'Mensagem vazia.',
    path: ['content'],
  })
  .refine((data) => data.target !== 'user' || /^.{3,32}#\d{5}$/.test(data.tag ?? ''), {
    message: 'Formato esperado: usuario#12345.',
    path: ['tag'],
  });

// POST /rooms/:roomId/soundboard (upload de efeito sonoro, rooms.routes.js) -
// `fileData` é revalidado a partir dos bytes decodificados (magic bytes, ver
// decodeSoundboardAudioDataUrl em utils/soundboardUpload.js) e a duração real
// (music-metadata) contra app_settings.soundboard_max_duration_ms na rota -
// isto aqui só garante o formato do payload.
export const soundboardUploadBodySchema = z.object({
  name: z.string().trim().min(1, 'Nome do som é obrigatório.').max(32, 'Nome muito longo.'),
  fileData: z
    .string()
    .min(1, 'Selecione um arquivo de áudio.')
    .regex(/^data:audio\/(mpeg|ogg|wav|webm);base64,/, 'Formato de áudio não suportado.'),
});

export const soundIdParamSchema = z.string().uuid('ID de som inválido.');

// PATCH /api/admin/settings (adminSettings.routes.js) - limites globais do
// soundboard, editáveis só por admin da aplicação. Faixas generosas mas
// finitas: sem teto, um admin distraído poderia configurar um limite absurdo
// (ex.: duração de 1h) que vira vetor de abuso (upload de música inteira como
// "efeito sonoro").
export const appSettingsUpdateSchema = z
  .object({
    soundboardMaxSounds: z.number().int().min(1).max(200).optional(),
    soundboardMaxDurationMs: z.number().int().min(1000).max(60_000).optional(),
    userBackgroundsServerEnabled: z.boolean().optional(),
    userBackgroundsMaxCount: z.number().int().min(1).max(50).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nenhum campo para atualizar.' });

// POST /api/backgrounds/system|mine - imagem revalidada pelos magic bytes
// (decodeImageDataUrl); ver backgrounds.routes.js.
export const backgroundUploadSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(48, 'Nome muito longo.'),
  image: z
    .string()
    .min(1, 'Selecione uma imagem.')
    .regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Formato de imagem não suportado.'),
});

export const backgroundIdParamSchema = z.string().uuid('ID de fundo inválido.');
