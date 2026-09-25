import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { validateBody } from '../middleware/validate.js';
import { reportCreateSchema, reportUpdateSchema, reportStatusSchema } from '../validation/schemas.js';
import { createReport, listReports, updateReport } from '../db/reports.repo.js';

const router = Router();
router.use(requireAuth);

// Envio (ReportsPage.jsx): bug ou sugestão, sempre associado a quem está
// autenticado (nunca um userId vindo do body).
router.post('/', validateBody(reportCreateSchema), async (req, res, next) => {
  try {
    const report = await createReport({
      userId: req.user.internalId,
      type: req.body.type,
      title: req.body.title,
      description: req.body.description,
    });
    return res.status(201).json({ report });
  } catch (err) {
    return next(err);
  }
});

// Listagem: app é de grupo fechado (ver CLAUDE.md), então qualquer usuário
// autenticado pode ver todos os reports - sem checagem de role adicional.
// status/type/userId são filtros opcionais lidos direto da query (mesmo
// padrão de limit/before já existente) - status inválido é ignorado em vez
// de dar erro, pra não quebrar a listagem por um filtro mal formado.
router.get('/', async (req, res, next) => {
  try {
    const status = reportStatusSchema.safeParse(req.query.status).success ? req.query.status : null;
    const type = req.query.type === 'bug' || req.query.type === 'suggestion' ? req.query.type : null;
    const reports = await listReports({
      limit: req.query.limit,
      beforeId: req.query.before,
      status,
      type,
      userId: req.query.userId || null,
    });
    return res.json({ reports });
  } catch (err) {
    return next(err);
  }
});

// Resposta/triagem da equipe - só admin (users.is_admin, ver requireAdmin.js).
router.patch('/:id', requireAdmin, validateBody(reportUpdateSchema), async (req, res, next) => {
  try {
    const report = await updateReport(req.params.id, {
      status: req.body.status,
      response: req.body.response,
    });
    if (!report) return res.status(404).json({ error: 'Report não encontrado.' });
    return res.json({ report });
  } catch (err) {
    return next(err);
  }
});

export default router;
