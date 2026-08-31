import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { reportCreateSchema } from '../validation/schemas.js';
import { createReport, listReports } from '../db/reports.repo.js';

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
router.get('/', async (req, res, next) => {
  try {
    const reports = await listReports({
      limit: req.query.limit,
      beforeId: req.query.before,
    });
    return res.json({ reports });
  } catch (err) {
    return next(err);
  }
});

export default router;
