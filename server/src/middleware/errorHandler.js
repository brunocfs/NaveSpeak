// Handler de erro central: nunca vaza stack trace / detalhes internos para o
// cliente (isso vazaria estrutura do banco, caminhos de arquivo, etc.). A
// linha de log é escrita pelo access log (observability/http.js) no fim da
// requisição - aqui só classificamos e anexamos o erro, uma vez só.
import { getContext, serializeError } from '../observability/logger.js';
import { classifyError, isLogged, markLogged } from '../observability/errors.js';

export function errorHandler(err, req, res, _next) {
  const c = classifyError(err);
  res.locals.errorCode = c.error_code;
  res.locals.retryable = c.retryable;
  if (!isLogged(err)) {
    // Entrada inválida do cliente (JSON quebrado, corpo grande demais): sem stack.
    res.locals.error = serializeError(err, { stack: !c.expected });
    markLogged(err);
  }
  if (c.status === 400 || c.status === 413) {
    res.locals.log = { event: 'validation_failed', reason_code: c.error_code.toLowerCase() };
  }
  if (res.headersSent) return;
  const body = { error: c.public_message };
  // Só o ID de correlação - o suficiente pro suporte achar o log, nada interno.
  if (c.status >= 500) body.requestId = getContext()?.request_id;
  res.status(c.status).json(body);
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Rota não encontrada.' });
}
