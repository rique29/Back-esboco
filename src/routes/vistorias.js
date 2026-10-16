const express = require('express');
const supabase = require('../config/supabase');
const { ApiError, checar } = require('../utils/erros');
const { criptografar, descriptografar } = require('../utils/crypto');
const asyncHandler = require('../utils/asyncHandler');
const { autenticar } = require('../middlewares/auth');
const { validar } = require('../middlewares/validar');
const { idParams } = require('../schemas/comum');
const { criarVistoriaSchema, editarVistoriaSchema, listarVistoriasQuery } = require('../schemas/vistorias');

const router = express.Router();
const COLUNAS_LISTA =
  'id, data_vistoria, placa, equipamento_id, resultado, vistoriador_id, horimetro_km, created_at';

router.use(autenticar);

const calcularResultado = (respostas) => (respostas.some((r) => r.resultado === 'NC') ? 'REPROVADO' : 'APROVADO');

// Campos sensíveis (observações) ficam criptografados com AES-256-GCM no banco.
const linhasRespostas = (vistoriaId, respostas) =>
  respostas.map((r) => ({
    vistoria_id: vistoriaId,
    item_id: r.item_id,
    resultado: r.resultado,
    observacao: criptografar(r.observacao || null),
  }));

async function buscarCompleta(id) {
  const v = checar(
    await supabase
      .from('vistorias')
      .select('*, vistoria_respostas(item_id, resultado, observacao, checklist_itens(grupo, descricao))')
      .eq('id', id)
      .maybeSingle()
  );
  if (!v) throw new ApiError(404, 'Vistoria não encontrada.');

  const checklist = v.vistoria_respostas
    .map((r) => ({
      item_id: r.item_id,
      grupo: r.checklist_itens?.grupo,
      descricao: r.checklist_itens?.descricao,
      resultado: r.resultado,
      observacao: descriptografar(r.observacao),
    }))
    .sort((a, b) => a.item_id - b.item_id);

  const { vistoria_respostas, ...cabecalho } = v;
  return {
    ...cabecalho,
    observacoes_gerais: descriptografar(v.observacoes_gerais),
    resumo: {
      conformes: checklist.filter((i) => i.resultado === 'C').length,
      nao_conformes: checklist.filter((i) => i.resultado === 'NC').length,
      nao_se_aplica: checklist.filter((i) => i.resultado === 'NA').length,
    },
    checklist,
  };
}

// GET /vistorias/checklist/itens  ->  catálogo dos 35 itens (útil para montar o formulário)
router.get(
  '/checklist/itens',
  asyncHandler(async (req, res) => {
    res.json(checar(await supabase.from('checklist_itens').select('*').order('id')));
  })
);

// GET /vistorias?data_inicio=&data_fim=&placa=&resultado=&pagina=&limite=
router.get(
  '/',
  validar(listarVistoriasQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { data_inicio, data_fim, placa, resultado, pagina, limite } = req.validado.query;
    let consulta = supabase.from('vistorias').select(COLUNAS_LISTA, { count: 'exact' });
    if (data_inicio) consulta = consulta.gte('data_vistoria', data_inicio);
    if (data_fim) consulta = consulta.lte('data_vistoria', data_fim);
    if (resultado) consulta = consulta.eq('resultado', resultado);
    if (placa) consulta = consulta.ilike('placa', `%${placa.replace(/[%_]/g, '')}%`);

    const inicio = (pagina - 1) * limite;
    const { data, error, count } = await consulta
      .order('data_vistoria', { ascending: false })
      .order('id', { ascending: false })
      .range(inicio, inicio + limite - 1);
    checar({ data, error });

    res.json({ pagina, limite, total: count, dados: data });
  })
);

// POST /vistorias
router.post(
  '/',
  validar(criarVistoriaSchema),
  asyncHandler(async (req, res) => {
    const { respostas, observacoes_gerais, ...cabecalho } = req.body;
    const criada = checar(
      await supabase
        .from('vistorias')
        .insert({
          ...cabecalho,
          observacoes_gerais: criptografar(observacoes_gerais ?? null),
          resultado: calcularResultado(respostas),
          vistoriador_id: req.usuario.id,
        })
        .select('id')
        .single()
    );
    try {
      checar(await supabase.from('vistoria_respostas').insert(linhasRespostas(criada.id, respostas)));
    } catch (e) {
      await supabase.from('vistorias').delete().eq('id', criada.id); // desfaz o cabeçalho
      throw e;
    }
    res.status(201).json(await buscarCompleta(criada.id));
  })
);

// GET /vistorias/:id
router.get(
  '/:id',
  validar(idParams, 'params'),
  asyncHandler(async (req, res) => {
    res.json(await buscarCompleta(req.validado.params.id));
  })
);

// PUT /vistorias/:id  (autor ou gerente). Se enviar "respostas", precisam ser os 35 itens.
router.put(
  '/:id',
  validar(idParams, 'params'),
  validar(editarVistoriaSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.validado.params;
    if (Object.keys(req.body).length === 0) throw new ApiError(400, 'Nada para atualizar.');

    const existente = checar(await supabase.from('vistorias').select('id, vistoriador_id').eq('id', id).maybeSingle());
    if (!existente) throw new ApiError(404, 'Vistoria não encontrada.');
    if (existente.vistoriador_id !== req.usuario.id && req.usuario.perfil !== 'GESTOR') {
      throw new ApiError(403, 'Somente o autor da vistoria ou um gerente pode alterá-la.');
    }

    const { respostas, observacoes_gerais, ...cabecalho } = req.body;
    const alteracoes = { ...cabecalho };
    if (observacoes_gerais !== undefined) alteracoes.observacoes_gerais = criptografar(observacoes_gerais);
    if (respostas) alteracoes.resultado = calcularResultado(respostas);

    if (Object.keys(alteracoes).length) checar(await supabase.from('vistorias').update(alteracoes).eq('id', id));
    if (respostas) {
      checar(
        await supabase
          .from('vistoria_respostas')
          .upsert(linhasRespostas(id, respostas), { onConflict: 'vistoria_id,item_id' })
      );
    }
    res.json(await buscarCompleta(id));
  })
);

module.exports = router;
