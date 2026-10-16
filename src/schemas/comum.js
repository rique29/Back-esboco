const { z } = require('zod');

const dataISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida. Use AAAA-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Data inexistente.');

const hora = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Hora inválida. Use HH:MM.');

const placa = z
  .string()
  .trim()
  .min(6, 'Placa muito curta.')
  .max(15, 'Placa muito longa.')
  .transform((v) => v.toUpperCase());

const idParams = z.object({
  id: z.coerce.number().int().positive('ID inválido.'),
});

const paginacao = {
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
};

module.exports = { dataISO, hora, placa, idParams, paginacao };
