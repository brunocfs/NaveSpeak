import os from 'node:os';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { pool } from '../config/db.js';
import { listOnlineUserIds } from '../sockets/onlineStore.js';
import { listUsersInVoice } from '../sockets/voicePresence.js';
import { getWorkers } from '../mediasoup/workers.js';
import { countMediaRooms } from '../mediasoup/rooms.js';

// Visão geral do painel admin: só contagens agregadas de uso + recursos do
// processo - nada por usuário.
const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const [{ rows }, onlineIds, inVoice, workers] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE is_system = FALSE) AS "totalUsers",
          (SELECT COUNT(*) FROM users WHERE banned_until > NOW()) AS "bannedUsers",
          (SELECT COUNT(*) FROM rooms) AS "servers",
          (SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '24 hours')
            + (SELECT COUNT(*) FROM private_messages WHERE created_at > NOW() - INTERVAL '24 hours') AS "messages24h"
      `),
      listOnlineUserIds(),
      listUsersInVoice(),
      Promise.all(getWorkers().map((w) => w.getResourceUsage().then((u) => ({ pid: w.pid, ...u })))),
    ]);

    const voiceTypes = [...inVoice.values()];
    const counts = Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
    const mem = process.memoryUsage();

    return res.json({
      usage: {
        ...counts,
        online: onlineIds.length,
        inServerVoice: voiceTypes.filter((t) => t === 'server').length,
        inCall: voiceTypes.filter((t) => t === 'call').length,
        media: countMediaRooms(),
      },
      resources: {
        uptimeSeconds: Math.round(process.uptime()),
        processRssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        systemTotalMemBytes: os.totalmem(),
        systemFreeMemBytes: os.freemem(),
        cpuCount: os.cpus().length,
        loadAvg: os.loadavg(),
        // ru_maxrss em KB, ru_utime/ru_stime em ms (tempo de CPU acumulado).
        mediasoupWorkers: workers.map((w) => ({
          pid: w.pid,
          maxRssBytes: w.ru_maxrss * 1024,
          cpuMs: w.ru_utime + w.ru_stime,
        })),
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
