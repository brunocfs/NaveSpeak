// Middleware genérico de validação: valida (e normaliza) req.body contra um
// schema zod ANTES de qualquer handler tocar o banco. Nenhuma rota deve ler
// req.body diretamente sem passar por aqui primeiro.
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Dados inválidos.',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    req.body = result.data;
    return next();
  };
}
