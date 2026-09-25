import { mediaCodecs } from './config.js';
import { getNextWorker } from './workers.js';
import { metrics } from '../observability/metrics.js';

// roomId -> { router, peers: Map<socketId, PeerState> }
// PeerState = { userId, username, sessionId, serverId, joinedAt,
//               transports: Map<id, Transport>, producers: Map<id, Producer>,
//               consumers: Map<id, Consumer> }
const rooms = new Map();

// Recontado a cada entrada/saída (poucas salas por instância) - evita
// gauge "derivando" quando o mesmo socket repete media:join.
function countPeers() {
  let peers = 0;
  for (const room of rooms.values()) peers += room.peers.size;
  return peers;
}

function updateSessionGauge() {
  metrics.voiceSessionsActive.set(countPeers());
}

// Painel admin (adminStats.routes.js) - só contagens desta instância.
export const countMediaRooms = () => ({ rooms: rooms.size, peers: countPeers() });

// roomId -> Promise<room> enquanto o router ainda está sendo criado. Sem
// isso, dois media:join simultâneos num canal vazio criavam DOIS routers: o
// segundo sobrescrevia o primeiro em `rooms` (router nunca fechado, vazando
// no worker) e o peer do primeiro ficava órfão (createTransport falhava).
const creatingRooms = new Map();

export async function getOrCreateRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) return room;

  if (!creatingRooms.has(roomId)) {
    const promise = (async () => {
      try {
        const router = await getNextWorker().createRouter({ mediaCodecs });
        const created = { router, peers: new Map() };
        rooms.set(roomId, created);
        metrics.voiceRoomsActive.set(rooms.size);
        return created;
      } finally {
        creatingRooms.delete(roomId);
      }
    })();
    creatingRooms.set(roomId, promise);
  }
  return creatingRooms.get(roomId);
}

export function getRoom(roomId) {
  return rooms.get(roomId) ?? null;
}

export function addPeer(roomId, socketId, { userId, username, sessionId = null, serverId = null }) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const peer = {
    userId,
    username,
    sessionId,
    serverId,
    joinedAt: Date.now(),
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };
  room.peers.set(socketId, peer);
  updateSessionGauge();
  return peer;
}

export function getPeer(roomId, socketId) {
  return rooms.get(roomId)?.peers.get(socketId) ?? null;
}

// Fecha tudo que pertence a esse peer (transports fecham producers/consumers
// em cascata, é o próprio mediasoup que garante isso) e limpa o router da
// sala se ninguém mais estiver nela - evita vazamento de memória/processo
// com salas de voz abandonadas.
export function removePeer(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return [];

  const peer = room.peers.get(socketId);
  if (!peer) return [];

  const closedProducerIds = Array.from(peer.producers.keys());
  for (const transport of peer.transports.values()) {
    transport.close();
  }
  room.peers.delete(socketId);
  updateSessionGauge();

  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(roomId);
    metrics.voiceRoomsActive.set(rooms.size);
  }

  return closedProducerIds;
}

export function listOtherProducers(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const list = [];
  for (const [peerSocketId, peer] of room.peers.entries()) {
    if (peerSocketId === socketId) continue;
    for (const producer of peer.producers.values()) {
      list.push({
        producerId: producer.id,
        userId: peer.userId,
        username: peer.username,
        kind: producer.kind,
        appData: producer.appData,
        paused: producer.paused,
      });
    }
  }
  return list;
}
