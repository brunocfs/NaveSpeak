// Presença de canal no Redis (compartilhada entre instâncias do servidor):
// quem está com o canal aberto na UI, esteja ou não conectado à voz. Ver
// roomPresence.js para o modelo de dados (Hash + Set) e a atomicidade via Lua.
import { createRoomPresenceStore } from './roomPresence.js';

const store = createRoomPresenceStore('presence', (channelId) => `presence:${channelId}`);

export const addPresence = store.add;
export const removePresence = store.remove;
export const removeSocketFromAllRooms = store.removeSocketFromAll;
export const listPresence = store.list;
