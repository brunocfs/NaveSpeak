// Handler de erro central: nunca vaza stack trace / detalhes internos para o
// cliente (isso vazaria estrutura do banco, caminhos de arquivo, etc.).
export function errorHandler(err, req, res, _next) {
  console.error(err);
  if (res.headersSent) return;
  res.status(err.status ?? 500).json({ error: 'Erro interno do servidor.' });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Rota não encontrada.' });
}
