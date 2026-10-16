const { z } = require('zod');
const { dataISO, hora, placa, paginacao } = require('./comum');

const CODIGOS_ATIVIDADE = ['D', 'B', 'G', 'C', 'E', 'A', 'RF', 'O', 'S', 'M', 'P', 'T', 'V', 'L', 'AP'];

const texto = (max) => z.string().trim().max(max).nullable().optional();

// Campos do cabeçalho do RDA (tabela relatorios_diarios_rda)
const cabecalho = {
  motorista_principal: z.string().trim().min(2).max(120),
  veiculo: z.string().trim().min(1).max(100),
  equipamento_id: z.number().int().positive().nullable().optional(),
  placa,
  data_operacao: dataISO,
  hora_registro: hora.nullable().optional(),
  regional: texto(100),
  procedencia: texto(100),
  horimetro_inicial: z.number().min(0).nullable().optional(),
  horimetro_final: z.number().min(0).nullable().optional(),
  litros_abastecidos: z.number().min(0).optional(),
  qtde_viagens: z.number().int().min(0).optional(),
};
// motorista_1..4, fiscal_1..2 e aux_trafego, cada um com sua hora
['motorista_1', 'motorista_2', 'motorista_3', 'motorista_4', 'fiscal_1', 'fiscal_2', 'aux_trafego'].forEach(
  (campo) => {
    cabecalho[campo] = texto(120);
    cabecalho[`hora_${campo}`] = hora.nullable().optional();
  }
);

const atividadeSchema = z.object({
  lado_tabela: z.enum(['ESQ', 'DIR']),
  indice_linha: z.number().int().min(1).max(20),
  codigo_atividade: z.enum(CODIGOS_ATIVIDADE).nullable().optional(),
  hora: hora.nullable().optional(),
  quilometragem: z.number().min(0).nullable().optional(),
});

const descargaSchema = z.object({
  numero_descarga: z.number().int().min(1).max(6),
  local_descarga: texto(150),
  numero_ticket: texto(60),
  peso_kg: z.number().min(0).default(0),
});

const filhos = {
  coletores: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  atividades: z.array(atividadeSchema).max(40).optional(),
  descargas: z.array(descargaSchema).max(6).optional(),
};

function regrasGerais(dados, ctx) {
  const { horimetro_inicial: ini, horimetro_final: fim } = dados;
  if (ini != null && fim != null && fim < ini) {
    ctx.addIssue({ code: 'custom', path: ['horimetro_final'], message: 'Horímetro final não pode ser menor que o inicial.' });
  }
  const dup = (lista, chave, caminho, msg) => {
    if (!lista) return;
    const vistos = new Set();
    lista.forEach((item, i) => {
      const k = chave(item);
      if (vistos.has(k)) ctx.addIssue({ code: 'custom', path: [caminho, i], message: msg });
      vistos.add(k);
    });
  };
  dup(dados.atividades, (a) => `${a.lado_tabela}-${a.indice_linha}`, 'atividades', 'Linha de atividade repetida (mesmo lado e índice).');
  dup(dados.descargas, (d) => d.numero_descarga, 'descargas', 'Número de descarga repetido.');
}

const base = z.object({ ...cabecalho, ...filhos });

const criarRelatorioSchema = base.superRefine(regrasGerais);
const editarRelatorioSchema = base.partial().superRefine(regrasGerais);

const listarRelatoriosQuery = z.object({
  data_inicio: dataISO.optional(),
  data_fim: dataISO.optional(),
  placa: z.string().trim().min(1).max(15).optional(),
  ...paginacao,
});

module.exports = { criarRelatorioSchema, editarRelatorioSchema, listarRelatoriosQuery };
