// Teste de ponta a ponta: percorre a API inteira com requisições reais.
// Pré-requisitos: API rodando + seed executado (npm run seed).
// Rodar:  node tests/e2e.js          (ou:  docker compose exec api npm run test:e2e)
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let ok = 0;
let falhas = 0;

async function req(metodo, caminho, { body, token } = {}) {
  const res = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch (e) { /* resposta sem corpo */ }
  return { status: res.status, body: json };
}

function conferir(nome, condicao, extra) {
  if (condicao) { ok += 1; console.log(`  ✔ ${nome}`); }
  else { falhas += 1; console.log(`  ✘ ${nome}`, extra !== undefined ? JSON.stringify(extra) : ''); }
}

async function logar(login, senha) {
  const l = await req('POST', '/auth/login', { body: { login, senha } });
  const v = await req('POST', '/auth/verify-2fa', { body: { desafio_token: l.body.desafio_token, codigo: l.body.codigo_dev } });
  return v.body;
}

const checklist = (alterar = {}) =>
  Array.from({ length: 35 }, (_, i) => ({ item_id: i + 1, resultado: 'C', ...(alterar[i + 1] || {}) }));

(async () => {
  console.log(`\nTestando ${BASE}\n`);

  console.log('Infraestrutura');
  const h = await req('GET', '/health');
  conferir('GET /health conecta no banco', h.status === 200 && h.body.banco === 'ok', h.body);
  if (!(h.status === 200 && h.body.banco === 'ok')) {
    console.log('\nA API não conseguiu falar com o banco. Confira o Supabase (npx supabase status) e o .env.');
    process.exit(1);
  }
  conferir('rota inexistente retorna 404', (await req('GET', '/nao-existe')).status === 404);

  console.log('\nAutenticação');
  const errada = await req('POST', '/auth/login', { body: { login: 'gestor@nixcore.test', senha: 'errada123' } });
  conferir('login com senha errada → 401', errada.status === 401, errada.body);
  const semCorpo = await req('POST', '/auth/login', { body: {} });
  conferir('login sem dados → 400 (Zod)', semCorpo.status === 400 && Array.isArray(semCorpo.body.detalhes));

  const l1 = await req('POST', '/auth/login', { body: { login: 'gestor@nixcore.test', senha: 'Gestor@123' } });
  conferir('login correto gera desafio 2FA', l1.status === 200 && !!l1.body.desafio_token && /^\d{6}$/.test(l1.body.codigo_dev), l1.body);
  const v0 = await req('POST', '/auth/verify-2fa', { body: { desafio_token: l1.body.desafio_token, codigo: '000000' === l1.body.codigo_dev ? '111111' : '000000' } });
  conferir('código 2FA errado → 401', v0.status === 401);
  const v1 = await req('POST', '/auth/verify-2fa', { body: { desafio_token: l1.body.desafio_token, codigo: l1.body.codigo_dev } });
  conferir('código 2FA correto entrega tokens', v1.status === 200 && !!v1.body.access_token && !!v1.body.refresh_token, v1.body);
  const v1b = await req('POST', '/auth/verify-2fa', { body: { desafio_token: l1.body.desafio_token, codigo: l1.body.codigo_dev } });
  conferir('código 2FA não pode ser reutilizado', v1b.status === 401);
  conferir('resposta não vaza senha_hash', !JSON.stringify(v1.body).includes('senha_hash'));

  const gestor = v1.body;
  const operador1 = await logar('operador1@nixcore.test', 'Operador@123');
  const operador2 = await logar('O002', 'Operador@123'); // login por código do colaborador
  conferir('login por código do colaborador funciona', !!operador2.access_token);

  const semToken = await req('GET', '/relatorios');
  conferir('rota protegida sem token → 401', semToken.status === 401);
  const tokenErrado = await req('GET', '/relatorios', { token: l1.body.desafio_token });
  conferir('token de desafio não vale como token de acesso → 401', tokenErrado.status === 401);
  const refreshComoAccess = await req('GET', '/relatorios', { token: gestor.refresh_token });
  conferir('refresh token não vale como token de acesso → 401', refreshComoAccess.status === 401);

  const rf = await req('POST', '/auth/refresh', { body: { refresh_token: gestor.refresh_token } });
  conferir('POST /auth/refresh renova os tokens', rf.status === 200 && !!rf.body.access_token, rf.body);
  const rf2 = await req('POST', '/auth/refresh', { body: { refresh_token: gestor.access_token } });
  conferir('access token não vale como refresh → 401', rf2.status === 401);

  const sufixo = Date.now();
  const novo = { codigo_colaborador: `T${sufixo}`, nome_completo: 'Usuário Teste', email: `teste${sufixo}@nixcore.test`, senha: 'Senha1234' };
  const r1 = await req('POST', '/auth/register', { body: novo });
  conferir('register público cria OPERADOR', r1.status === 201 && r1.body.cargo_perfil === 'OPERADOR' && !r1.body.senha_hash, r1.body);
  const r2 = await req('POST', '/auth/register', { body: { ...novo, cargo_perfil: 'GESTOR' } });
  conferir('register de GESTOR sem ser gerente → 403', r2.status === 403, r2.body);
  const r3 = await req('POST', '/auth/register', { body: { ...novo, cargo_perfil: 'GESTOR' }, token: operador1.access_token });
  conferir('register de GESTOR por operador → 403', r3.status === 403);
  const r4 = await req('POST', '/auth/register', { body: novo });
  conferir('e-mail duplicado → 409', r4.status === 409, r4.body);
  const r5 = await req('POST', '/auth/register', { body: { ...novo, email: 'x@x.com', senha: 'curta' } });
  conferir('senha fraca → 400', r5.status === 400);
  const r6 = await req('POST', '/auth/register', {
    body: { ...novo, codigo_colaborador: `G${sufixo}`, email: `g${sufixo}@nixcore.test`, cargo_perfil: 'GESTOR' },
    token: gestor.access_token,
  });
  conferir('gerente consegue criar outro GESTOR', r6.status === 201 && r6.body.cargo_perfil === 'GESTOR', r6.body);

  console.log('\nRelatórios (RDA)');
  const rel = {
    motorista_principal: 'João da Silva', veiculo: 'VW 24.260', placa: 'bra-2041', data_operacao: '2026-10-14',
    hora_registro: '07:30', regional: 'Norte', qtde_viagens: 3, horimetro_inicial: 1000, horimetro_final: 1008.5,
    motorista_1: 'João da Silva', hora_motorista_1: '06:00',
    coletores: ['Carlos', 'Marcos'],
    atividades: [{ lado_tabela: 'ESQ', indice_linha: 1, codigo_atividade: 'D', hora: '06:10', quilometragem: 12.5 }],
    descargas: [{ numero_descarga: 1, local_descarga: 'Aterro Central', numero_ticket: 'T-001', peso_kg: 4200.5 }, { numero_descarga: 2, peso_kg: 3100 }],
  };
  const c0 = await req('POST', '/relatorios', { body: { ...rel, horimetro_final: 500 }, token: operador1.access_token });
  conferir('horímetro final < inicial → 400', c0.status === 400, c0.body);
  const c0b = await req('POST', '/relatorios', { body: { ...rel, data_operacao: '14/10/2026' }, token: operador1.access_token });
  conferir('data em formato errado → 400', c0b.status === 400);
  const c1 = await req('POST', '/relatorios', { body: rel, token: operador1.access_token });
  conferir('POST /relatorios cria (201) e normaliza placa', c1.status === 201 && c1.body.placa === 'BRA-2041', c1.body);
  conferir('peso total = soma das descargas (7300.5)', Number(c1.body.peso_total_kg) === 7300.5, c1.body.peso_total_kg);
  conferir('filhos gravados (2 coletores, 1 atividade, 2 descargas)', c1.body.rda_coletores.length === 2 && c1.body.rda_atividades.length === 1 && c1.body.rda_descargas.length === 2);
  const idRel = c1.body.id;

  const g1 = await req('GET', `/relatorios/${idRel}`, { token: operador2.access_token });
  conferir('GET /relatorios/:id retorna detalhes completos', g1.status === 200 && g1.body.motorista_principal === 'João da Silva');
  conferir('GET /relatorios/abc → 400', (await req('GET', '/relatorios/abc', { token: gestor.access_token })).status === 400);
  conferir('GET /relatorios/999999 → 404', (await req('GET', '/relatorios/999999', { token: gestor.access_token })).status === 404);

  const lp = await req('GET', '/relatorios?placa=2041', { token: gestor.access_token });
  conferir('filtro por placa (parcial)', lp.status === 200 && lp.body.dados.some((x) => x.id === idRel), lp.body);
  const ld = await req('GET', '/relatorios?data_inicio=2026-10-14&data_fim=2026-10-14', { token: gestor.access_token });
  conferir('filtro por data', ld.status === 200 && ld.body.dados.every((x) => x.data_operacao === '2026-10-14') && ld.body.dados.length >= 1);
  const lx = await req('GET', '/relatorios?placa=ZZZ-0000', { token: gestor.access_token });
  conferir('filtro sem resultado retorna lista vazia', lx.status === 200 && lx.body.dados.length === 0 && lx.body.total === 0);
  conferir('data inválida no filtro → 400', (await req('GET', '/relatorios?data_inicio=ontem', { token: gestor.access_token })).status === 400);

  const u1 = await req('PUT', `/relatorios/${idRel}`, { body: { regional: 'Sul' }, token: operador2.access_token });
  conferir('PUT por outro operador → 403', u1.status === 403);
  const u2 = await req('PUT', `/relatorios/${idRel}`, { body: { regional: 'Sul', descargas: [{ numero_descarga: 1, peso_kg: 1000 }] }, token: operador1.access_token });
  conferir('PUT pelo autor edita e recalcula peso', u2.status === 200 && u2.body.regional === 'Sul' && Number(u2.body.peso_total_kg) === 1000 && u2.body.rda_descargas.length === 1, u2.body);
  const u3 = await req('PUT', `/relatorios/${idRel}`, { body: { qtde_viagens: 5 }, token: gestor.access_token });
  conferir('PUT por gerente é permitido', u3.status === 200 && u3.body.qtde_viagens === 5);
  conferir('PUT sem campos → 400', (await req('PUT', `/relatorios/${idRel}`, { body: {}, token: gestor.access_token })).status === 400);

  const d1 = await req('DELETE', `/relatorios/${idRel}`, { token: operador1.access_token });
  conferir('DELETE por operador → 403', d1.status === 403);
  const d2 = await req('DELETE', `/relatorios/${idRel}`, { token: gestor.access_token });
  conferir('DELETE por gerente → 204', d2.status === 204);
  conferir('após DELETE, GET → 404', (await req('GET', `/relatorios/${idRel}`, { token: gestor.access_token })).status === 404);
  conferir('DELETE repetido → 404', (await req('DELETE', `/relatorios/${idRel}`, { token: gestor.access_token })).status === 404);

  console.log('\nVistorias (checklist de 35 itens)');
  const cat = await req('GET', '/vistorias/checklist/itens', { token: operador1.access_token });
  conferir('catálogo tem 35 itens', cat.status === 200 && cat.body.length === 35);

  const base = { placa: 'BRA-2041', data_vistoria: '2026-10-14', hora_vistoria: '05:45', horimetro_km: 120345.5 };
  const v34 = await req('POST', '/vistorias', { body: { ...base, respostas: checklist().slice(0, 34) }, token: operador1.access_token });
  conferir('34 itens → 400', v34.status === 400, v34.body);
  const dup = checklist(); dup[34] = { item_id: 1, resultado: 'C' };
  const vdup = await req('POST', '/vistorias', { body: { ...base, respostas: dup }, token: operador1.access_token });
  conferir('item repetido (e item 35 faltando) → 400', vdup.status === 400 && JSON.stringify(vdup.body).includes('35'), vdup.body);
  const vnc = await req('POST', '/vistorias', { body: { ...base, respostas: checklist({ 15: { resultado: 'NC' } }) }, token: operador1.access_token });
  conferir('NC sem observação → 400', vnc.status === 400, vnc.body);
  const vfora = await req('POST', '/vistorias', { body: { ...base, respostas: checklist({ 3: { item_id: 99 } }) }, token: operador1.access_token });
  conferir('item_id fora de 1..35 → 400', vfora.status === 400);
  const vres = await req('POST', '/vistorias', { body: { ...base, respostas: checklist({ 3: { resultado: 'OK' } }) }, token: operador1.access_token });
  conferir('resultado inválido → 400', vres.status === 400);
  const vequip = await req('POST', '/vistorias', { body: { ...base, equipamento_id: 99999, respostas: checklist() }, token: operador1.access_token });
  conferir('equipamento inexistente → 400', vequip.status === 400, vequip.body);

  const ok1 = await req('POST', '/vistorias', { body: { ...base, observacoes_gerais: 'Veículo em bom estado', respostas: checklist({ 13: { resultado: 'NA' } }) }, token: operador1.access_token });
  conferir('vistoria sem problemas → 201 APROVADO', ok1.status === 201 && ok1.body.resultado === 'APROVADO', ok1.body);
  conferir('observações gerais voltam descriptografadas', ok1.body.observacoes_gerais === 'Veículo em bom estado');
  conferir('resumo correto (34 C / 0 NC / 1 NA)', ok1.body.resumo.conformes === 34 && ok1.body.resumo.nao_se_aplica === 1 && ok1.body.resumo.nao_conformes === 0, ok1.body.resumo);

  const rep = await req('POST', '/vistorias', {
    body: { ...base, placa: 'oxk-8812', respostas: checklist({ 15: { resultado: 'NC', observacao: 'Freio com ruído e curso longo' } }) },
    token: operador1.access_token,
  });
  conferir('vistoria com NC → REPROVADO', rep.status === 201 && rep.body.resultado === 'REPROVADO', rep.body);
  const idVist = rep.body.id;

  const gv = await req('GET', `/vistorias/${idVist}`, { token: gestor.access_token });
  const item15 = gv.body.checklist.find((i) => i.item_id === 15);
  conferir('GET /vistorias/:id traz 35 itens com grupo e descrição', gv.status === 200 && gv.body.checklist.length === 35 && item15.grupo === 'Freios e direção' && item15.descricao === 'Freio de serviço', gv.body);
  conferir('observação do item NC descriptografada', item15.observacao === 'Freio com ruído e curso longo');

  const lr = await req('GET', '/vistorias?resultado=REPROVADO&placa=oxk', { token: gestor.access_token });
  conferir('filtros resultado + placa', lr.status === 200 && lr.body.dados.some((x) => x.id === idVist) && lr.body.dados.every((x) => x.resultado === 'REPROVADO'), lr.body);
  const la = await req('GET', '/vistorias', { token: gestor.access_token });
  conferir('GET /vistorias lista todas (paginado)', la.status === 200 && la.body.total >= 2 && la.body.dados.length >= 2);

  const pv1 = await req('PUT', `/vistorias/${idVist}`, { body: { horimetro_km: 1 }, token: operador2.access_token });
  conferir('PUT vistoria por outro operador → 403', pv1.status === 403);
  const pv2 = await req('PUT', `/vistorias/${idVist}`, { body: { respostas: checklist().slice(0, 10) }, token: operador1.access_token });
  conferir('PUT com checklist incompleto → 400', pv2.status === 400);
  const pv3 = await req('PUT', `/vistorias/${idVist}`, { body: { respostas: checklist(), observacoes_gerais: 'Freio reparado e testado' }, token: operador1.access_token });
  conferir('PUT corrige checklist → recalcula para APROVADO', pv3.status === 200 && pv3.body.resultado === 'APROVADO' && pv3.body.resumo.nao_conformes === 0, pv3.body);
  conferir('PUT atualiza observação criptografada', pv3.body.observacoes_gerais === 'Freio reparado e testado');
  const pv4 = await req('PUT', `/vistorias/${idVist}`, { body: { horimetro_km: 130000 }, token: gestor.access_token });
  conferir('PUT parcial (só cabeçalho) por gerente', pv4.status === 200 && Number(pv4.body.horimetro_km) === 130000 && pv4.body.checklist.length === 35);
  conferir('GET /vistorias/999999 → 404', (await req('GET', '/vistorias/999999', { token: gestor.access_token })).status === 404);

  console.log('\nBloqueio de força bruta no 2FA');
  const lb = await req('POST', '/auth/login', { body: { login: 'operador2@nixcore.test', senha: 'Operador@123' } });
  const certo = lb.body.codigo_dev;
  const errado = certo === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i += 1) await req('POST', '/auth/verify-2fa', { body: { desafio_token: lb.body.desafio_token, codigo: errado } });
  const depois = await req('POST', '/auth/verify-2fa', { body: { desafio_token: lb.body.desafio_token, codigo: certo } });
  conferir('após 5 erros, até o código certo é recusado', depois.status === 401, depois.body);

  console.log(`\nResultado: ${ok} passaram, ${falhas} falharam.\n`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('Erro inesperado no teste:', e); process.exit(1); });
