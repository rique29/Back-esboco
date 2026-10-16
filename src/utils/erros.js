class ApiError extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

// Converte erros do Postgres/Supabase em respostas HTTP amigáveis.
function mapearErroBanco(error) {
  const codigo = error.code;
  if (codigo === '23505') return new ApiError(409, 'Registro duplicado: esse valor já existe.');
  if (codigo === '23503') {
    return new ApiError(400, 'Referência inválida: o registro relacionado não existe ou está em uso.');
  }
  if (['23514', '23502', '22P02', '22007', '22003'].includes(codigo)) {
    return new ApiError(400, 'Os dados foram rejeitados pelo banco.', error.message);
  }
  console.error('[db]', error);
  return new ApiError(500, 'Erro ao acessar o banco de dados.');
}

// Uso: const dados = checar(await supabase.from('x').select());
function checar({ data, error }) {
  if (error) throw mapearErroBanco(error);
  return data;
}

module.exports = { ApiError, mapearErroBanco, checar };
