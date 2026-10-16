// Garante que erros em funções async cheguem ao tratador de erros (Express 4 e 5).
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
