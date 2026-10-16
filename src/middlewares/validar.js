const { ApiError } = require('../utils/erros');

// Uso: validar(schema)            -> valida req.body
//      validar(schema, 'query')   -> valida req.query (resultado em req.validado.query)
//      validar(schema, 'params')  -> valida req.params (resultado em req.validado.params)
function validar(schema, origem = 'body') {
  return (req, res, next) => {
    const resultado = schema.safeParse(req[origem]);
    if (!resultado.success) {
      const detalhes = resultado.error.issues.map((i) => ({
        campo: i.path.join('.') || '(corpo)',
        mensagem: i.message,
      }));
      return next(new ApiError(400, 'Dados inválidos.', detalhes));
    }
    if (origem === 'body') {
      req.body = resultado.data;
    } else {
      req.validado = req.validado || {};
      req.validado[origem] = resultado.data;
    }
    next();
  };
}

module.exports = { validar };
