const { z } = require('zod');

const PERFIS = ['OPERADOR', 'GESTOR'];

const senhaForte = z
  .string()
  .min(8, 'A senha precisa ter pelo menos 8 caracteres.')
  .max(72, 'A senha pode ter no máximo 72 caracteres.')
  .regex(/[A-Za-z]/, 'A senha precisa ter pelo menos uma letra.')
  .regex(/\d/, 'A senha precisa ter pelo menos um número.');

const registerSchema = z.object({
  codigo_colaborador: z.string().trim().min(1).max(30),
  nome_completo: z.string().trim().min(3).max(150),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(150),
  senha: senhaForte,
  cargo_perfil: z.enum(PERFIS).optional(),
  setor: z.string().trim().max(100).optional(),
});

const loginSchema = z.object({
  login: z.string().trim().min(1, 'Informe e-mail ou código do colaborador.').max(150),
  senha: z.string().min(1, 'Informe a senha.').max(72),
});

const verify2faSchema = z.object({
  desafio_token: z.string().min(10, 'desafio_token é obrigatório.'),
  codigo: z.string().regex(/^\d{6}$/, 'O código deve ter exatamente 6 dígitos.'),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(10, 'refresh_token é obrigatório.'),
});

module.exports = { PERFIS, registerSchema, loginSchema, verify2faSchema, refreshSchema };
