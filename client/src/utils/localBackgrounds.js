// Fundos de câmera enviados pelo usuário, guardados SÓ neste dispositivo
// (IndexedDB) - a foto da casa da pessoa nunca sai do PC. Quando o upload no
// servidor for liberado (app_settings.user_backgrounds_server_enabled), o
// CameraSetupModal passa a usar api/backgrounds.js em vez daqui.
const DB_NAME = 'navespeak-backgrounds';
const STORE = 'images';
export const MAX_LOCAL_BACKGROUNDS = 10;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = () => reject(tx.error);
  });
}

// [{ id, name, blob, createdAt }] ordenado do mais antigo pro mais novo.
export const listLocalBackgrounds = async () =>
  (await run('readonly', (s) => s.getAll())).sort((a, b) => a.createdAt - b.createdAt);

export const getLocalBackground = (id) => run('readonly', (s) => s.get(id));

export async function addLocalBackground({ name, blob }) {
  const record = { id: crypto.randomUUID(), name, blob, createdAt: Date.now() };
  await run('readwrite', (s) => s.add(record));
  return record;
}

export const deleteLocalBackground = (id) => run('readwrite', (s) => s.delete(id));
