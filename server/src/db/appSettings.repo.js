// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
import { pool } from '../config/db.js';

const DEFAULTS = {
  soundboardMaxSounds: 20,
  soundboardMaxDurationMs: 10000,
  userBackgroundsServerEnabled: false,
  userBackgroundsMaxCount: 10,
};
const COLUMNS =
  'soundboard_max_sounds, soundboard_max_duration_ms, user_backgrounds_server_enabled, user_backgrounds_max_count';

function toClient(row) {
  if (!row) return { ...DEFAULTS };
  return {
    soundboardMaxSounds: row.soundboard_max_sounds,
    soundboardMaxDurationMs: row.soundboard_max_duration_ms,
    userBackgroundsServerEnabled: row.user_backgrounds_server_enabled,
    userBackgroundsMaxCount: row.user_backgrounds_max_count,
  };
}

// Singleton (id=1) criado sob demanda, mesmo padrão de serverSettings.repo.js
// - servidores/instâncias que já rodavam antes desta tabela existir não
// precisam de backfill/migração à parte.
export async function getAppSettings() {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM app_settings WHERE id = 1 LIMIT 1`
  );
  if (rows[0]) return toClient(rows[0]);

  await pool.query(
    `INSERT INTO app_settings (id, soundboard_max_sounds, soundboard_max_duration_ms) VALUES (1, $1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULTS.soundboardMaxSounds, DEFAULTS.soundboardMaxDurationMs]
  );
  return { ...DEFAULTS };
}

export async function updateAppSettings({
  soundboardMaxSounds,
  soundboardMaxDurationMs,
  userBackgroundsServerEnabled,
  userBackgroundsMaxCount,
} = {}) {
  await getAppSettings(); // garante que a linha existe antes do UPDATE
  const fields = [];
  const values = [];
  let i = 1;
  if (soundboardMaxSounds !== undefined) { fields.push(`soundboard_max_sounds = $${i++}`); values.push(soundboardMaxSounds); }
  if (soundboardMaxDurationMs !== undefined) { fields.push(`soundboard_max_duration_ms = $${i++}`); values.push(soundboardMaxDurationMs); }
  if (userBackgroundsServerEnabled !== undefined) { fields.push(`user_backgrounds_server_enabled = $${i++}`); values.push(userBackgroundsServerEnabled); }
  if (userBackgroundsMaxCount !== undefined) { fields.push(`user_backgrounds_max_count = $${i++}`); values.push(userBackgroundsMaxCount); }
  if (fields.length === 0) return getAppSettings();

  const { rows } = await pool.query(
    `UPDATE app_settings SET ${fields.join(', ')}, updated_at = NOW() WHERE id = 1
     RETURNING ${COLUMNS}`,
    values
  );
  return toClient(rows[0]);
}
