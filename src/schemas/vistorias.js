const { z } = require('zod');
const { dataISO, hora, placa, paginacao } = require('./comum');

const TOTAL_ITENS = 35;
const RESULTADOS = ['C', 'NC', 'NA']; // Conforme / Não conforme / Não se aplica

const respostaSchema = z.object({
  item_id: z.number().int().min(1).max(TOTAL_ITENS),
  resultado: z.enum(RESULTADOS),
  observacao: z.string().trim().max(500).nullable().optional(),
});

// O checklist precisa ter EXATAMENTE os 35 itens: sem faltar, sem repetir.
const respostasSchema = z
  .array(respostaSchema)
  .length(TOTAL_ITENS, `O checklist deve ter exatamente ${TOTAL_ITENS} itens.`)
  .superRefine((respostas, ctx) => {
    const vistos = new Set();
    respostas.forEach((r, i) => {
      if (vistos.has(r.item_id)) {
        ctx.addIssue({ code: 'custom', path: [i, 'item_id'], message: `Item ${r.item_id} repetido.` });
      }
      vistos.add(r.item_id);
      if (r.resultado === 'NC' && !r.observacao) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'observacao'],
          message: `Item ${r.item_id}: descreva o problema quando for "NC" (não conforme).`,
        });
      }
    });
    const faltando = [];
    for (let n = 1; n <= TOTAL_ITENS; n += 1) if (!vistos.has(n)) faltando.push(n);
    if (faltando.length) {
      ctx.addIssue({ code: 'custom', message: `Itens faltando no checklist: ${faltando.join(', ')}.` });
    }
  });

const cabecalho = z.object({
  equipamento_id: z.number().int().positive().nullable().optional(),
  placa,
  data_vistoria: dataISO,
  hora_vistoria: hora.nullable().optional(),
  horimetro_km: z.number().min(0).nullable().optional(),
  observacoes_gerais: z.string().trim().max(2000).nullable().optional(),
});

const criarVistoriaSchema = cabecalho.extend({ respostas: respostasSchema });
const editarVistoriaSchema = cabecalho.partial().extend({ respostas: respostasSchema.optional() });

const listarVistoriasQuery = z.object({
  data_inicio: dataISO.optional(),
  data_fim: dataISO.optional(),
  placa: z.string().trim().min(1).max(15).optional(),
  resultado: z.enum(['APROVADO', 'REPROVADO']).optional(),
  ...paginacao,
});

module.exports = { TOTAL_ITENS, criarVistoriaSchema, editarVistoriaSchema, listarVistoriasQuery };
