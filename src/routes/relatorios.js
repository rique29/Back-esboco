const express = require('express');
const supabase = require('../config/supabase');
const { ApiError, checar } = require('../utils/erros');
const asyncHandler = require('../utils/asyncHandler');
const { autenticar, exigirPerfil } = require('../middlewares/auth');
const { validar } = require('../middlewares/validar');
const { idParams } = require('../schemas/comum');
const { criarRelatorioSchema, editarRelatorioSchema, listarRelatoriosQuery } = require('../schemas/relatorios');

const router = express.Router();
const TABELA = 'relatorios_diarios_rda';
const COLUNAS_LISTA =
  'id, data_operacao, placa, veiculo, motorista_principal, regional, qtde_viagens, peso_total_kg, enviado_por_id, created_at';

router.use(autenticar);

const somarPeso = (descargas) => Math.round(descargas.reduce((s, d) => s + (d.peso_kg || 0), 0) * 100) / 100;

async function inserirFilhos(rdaId, { coletores, atividades, descargas }) {
  if (coletores && coletores.length) {
    checar(
      await supabase
        .from('rda_coletores')
        .insert(coletores.map((nome, i) => ({ rda_id: rdaId, nome_coletor: nome, ordem: i + 1 })))
    );
  }
  if (atividades && atividades.length) {
    checar(await supabase.from('rda_atividades').insert(atividades.map((a) => ({ ...a, rda_id: rdaId }))));
  }
  if (descargas && descargas.length) {
    checar(await supabase.from('rda_descargas').insert(descargas.map((d) => ({ ...d, rda_id: rdaId }))));
  }
}

async function buscarCompleto(id) {
  const rel = checar(
    await supabase
      .from(TABELA)
      .select('*, rda_coletores(*), rda_atividades(*), rda_descargas(*)')
      .eq('id', id)
      .maybeSingle()
  );
  if (!rel) throw new ApiError(404, 'Relatório não encontrado.');
  rel.rda_coletores.sort((a, b) => a.ordem - b.ordem);
  rel.rda_descargas.sort((a, b) => a.numero_descarga - b.numero_descarga);
  rel.rda_atividades.sort((a, b) => a.lado_tabela.localeCompare(b.lado_tabela) || a.indice_linha - b.indice_linha);
  return rel;
}

function conferirPermissaoEdicao(req, relatorio) {
  const dono = relatorio.enviado_por_id === req.usuario.id;
  if (!dono && req.usuario.perfil !== 'GESTOR') {
    throw new ApiError(403, 'Somente o autor do relatório ou um gerente pode alterá-lo.');
  }
}

// GET /relatorios?data_inicio=&data_fim=&placa=&pagina=&limite=
router.get(
  '/',
  validar(listarRelatoriosQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { data_inicio, data_fim, placa, pagina, limite } = req.validado.query;
    let consulta = supabase.from(TABELA).select(COLUNAS_LISTA, { count: 'exact' });
    if (data_inicio) consulta = consulta.gte('data_operacao', data_inicio);
    if (data_fim) consulta = consulta.lte('data_operacao', data_fim);
    if (placa) consulta = consulta.ilike('placa', `%${placa.replace(/[%_]/g, '')}%`);

    const inicio = (pagina - 1) * limite;
    const { data, error, count } = await consulta
      .order('data_operacao', { ascending: false })
      .order('id', { ascending: false })
      .range(inicio, inicio + limite - 1);
    checar({ data, error });

    res.json({ pagina, limite, total: count, dados: data });
  })
);

// POST /relatorios
router.post(
  '/',
  validar(criarRelatorioSchema),
  asyncHandler(async (req, res) => {
    const { coletores, atividades, descargas, ...cabecalho } = req.body;
    const criado = checar(
      await supabase
        .from(TABELA)
        .insert({ ...cabecalho, peso_total_kg: somarPeso(descargas || []), enviado_por_id: req.usuario.id })
        .select('id')
        .single()
    );
    try {
      await inserirFilhos(criado.id, { coletores, atividades, descargas });
    } catch (e) {
      await supabase.from(TABELA).delete().eq('id', criado.id); // desfaz o cabeçalho
      throw e;
    }
    res.status(201).json(await buscarCompleto(criado.id));
  })
);

// GET /relatorios/:id
router.get(
  '/:id',
  validar(idParams, 'params'),
  asyncHandler(async (req, res) => {
    res.json(await buscarCompleto(req.validado.params.id));
  })
);

// PUT /relatorios/:id  (autor ou gerente). Listas enviadas SUBSTITUEM as antigas.
router.put(
  '/:id',
  validar(idParams, 'params'),
  validar(editarRelatorioSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.validado.params;
    const existente = checar(await supabase.from(TABELA).select('id, enviado_por_id').eq('id', id).maybeSingle());
    if (!existente) throw new ApiError(404, 'Relatório não encontrado.');
    conferirPermissaoEdicao(req, existente);

    const { coletores, atividades, descargas, ...cabecalho } = req.body;
    if (Object.keys(req.body).length === 0) throw new ApiError(400, 'Nada para atualizar.');

    const alteracoes = { ...cabecalho };
    if (descargas) alteracoes.peso_total_kg = somarPeso(descargas);
    if (Object.keys(alteracoes).length) checar(await supabase.from(TABELA).update(alteracoes).eq('id', id));

    const tabelasFilhas = [
      [coletores, 'rda_coletores'],
      [atividades, 'rda_atividades'],
      [descargas, 'rda_descargas'],
    ];
    for (const [lista, tabela] of tabelasFilhas) {
      if (lista) checar(await supabase.from(tabela).delete().eq('rda_id', id));
    }
    await inserirFilhos(id, { coletores, atividades, descargas });

    res.json(await buscarCompleto(id));
  })
);

// DELETE /relatorios/:id  (somente gerente)
router.delete(
  '/:id',
  exigirPerfil('GESTOR'),
  validar(idParams, 'params'),
  asyncHandler(async (req, res) => {
    const removidos = checar(await supabase.from(TABELA).delete().eq('id', req.validado.params.id).select('id'));
    if (!removidos.length) throw new ApiError(404, 'Relatório não encontrado.');
    res.status(204).end();
  })
);

module.exports = router;
