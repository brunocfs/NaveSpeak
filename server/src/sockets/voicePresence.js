// Roster de voz persistente no Redis: Hash voice:channel:{channelId}:members
// -> userId -> JSON { username, socketIds: [] }.
//
// É a fonte de verdade de "quem está na chamada" para efeitos de exibição -
// ao contrário do Map em memória de mediasoup/rooms.js (que guarda routers,
// transports, producers/consumers: estado de mídia inerentemente efêmero e
// preso ao processo, isso não sobrevive a um restart e nem tem como), este
// roster:
//   - sobrevive a um restart do processo: um usuário que estava na chamada
//     continua listado como participante até o próprio socket cair (o cliente
//     reconecta e refaz media:join automaticamente, ver useMediasoup.js);
//   - é visível para quem está só navegando no canal (channel:join), sem
//     precisar entrar na chamada - basta ler o Redis, não depende de estar no
//     mesmo processo que hospeda o router mediasoup daquele canal;
//   - funciona entre múltiplas instâncias atrás do adapter Redis do
//     socket.io (ENABLE_REDIS_ADAPTER=true), já que io.to(channelId).emit é
//     roteado via pub/sub do Redis para todas as instâncias.
import { createRoomPresenceStore } from './roomPresence.js';

const store = createRoomPresenceStore('voice', (channelId) => `voice:channel:${channelId}:members`);

export const addVoicePresence = store.add;
export const removeVoicePresence = store.remove;
export const removeSocketFromAllVoiceChannels = store.removeSocketFromAll;
export const listVoicePresence = store.list;
