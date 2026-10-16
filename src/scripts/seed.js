// Cria usuários e equipamentos iniciais (fixos) para testes.
// Rode:  docker compose exec api npm run seed
const bcrypt = require('bcryptjs');
const { EM_PRODUCAO } = require('../config/env');
const supabase = require('../config/supabase');

if (EM_PRODUCAO) {
  console.error('Seed bloqueado em produção.');
  process.exit(1);
}

const usuarios = [
  { codigo_colaborador: 'G001', nome_completo: 'Gestor de Teste', email: 'gestor@nixcore.test', senha: 'Gestor@123', cargo_perfil: 'GESTOR', setor: 'Gestão' },
  { codigo_colaborador: 'O001', nome_completo: 'Operador Um', email: 'operador1@nixcore.test', senha: 'Operador@123', cargo_perfil: 'OPERADOR', setor: 'Operação' },
  { codigo_colaborador: 'O002', nome_completo: 'Operador Dois', email: 'operador2@nixcore.test', senha: 'Operador@123', cargo_perfil: 'OPERADOR', setor: 'Operação' },
];

const equipamentos = [
  { codigo_equipamento: '77', sub_codigo: '31934', nome_equipamento: 'VW 24.260 CONSTELLATION', placa: 'BRA-2041' },
  { codigo_equipamento: '12', sub_codigo: '20551', nome_equipamento: 'Escavadeira CAT 320', placa: 'OXK-8812' },
];

async function main() {
  for (const { senha, ...u } of usuarios) {
    const senha_hash = await bcrypt.hash(senha, 12);
    const { error } = await supabase
      .from('usuarios')
      .upsert({ ...u, senha_hash, ativo: true, dois_fatores_ativo: true }, { onConflict: 'codigo_colaborador' });
    if (error) throw error;
  }
  const { error } = await supabase.from('equipamentos_frota').upsert(equipamentos, { onConflict: 'placa' });
  if (error) throw error;

  console.log('Seed concluído. Usuários de teste:');
  console.table(usuarios.map((u) => ({ perfil: u.cargo_perfil, email: u.email, codigo: u.codigo_colaborador, senha: u.senha })));
}

main().catch((e) => {
  console.error('Falha no seed:', e.message || e);
  process.exit(1);
});
