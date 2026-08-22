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

export const roomIdParamSchema = z.string().uuid('ID de sala inválido.');

export const messageContentSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .min(1, 'Mensagem vazia.')
      .max(2000, 'Mensagem muito longa (máx. 2000 caracteres).')
  );
