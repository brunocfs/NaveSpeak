import os from 'node:os';
import { env } from '../config/env.js';

// Codecs oferecidos pelos Routers. Áudio (Opus) é usado desde a Fase 3 (voz);
// os codecs de vídeo já ficam registrados aqui para a Fase 4 (tela/câmera)
// não precisar recriar routers existentes.
export const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
  },
];

// Número de workers mediasoup: um por núcleo de CPU disponível (limitado a 4
// para não estourar memória em máquinas pequenas). Cada worker roda em seu
// próprio processo do SO e lida com um subconjunto dos peers.
export const numWorkers = Math.max(1, Math.min(os.cpus().length, 4));

export const workerSettings = {
  rtcMinPort: env.MEDIASOUP_MIN_PORT,
  rtcMaxPort: env.MEDIASOUP_MAX_PORT,
  logLevel: 'warn',
};

// announcedIp deve ser o IP pelo qual OUTROS peers conseguem alcançar este
// servidor - dentro da VPN, é o IP atribuído pela VPN (ex.: RadminVPN) nesta
// máquina. Sem isso preenchido, funciona só para peers na mesma máquina.
export const webRtcTransportOptions = {
  listenIps: [
    {
      ip: '0.0.0.0',
      announcedIp: env.MEDIASOUP_ANNOUNCED_IP || undefined,
    },
  ],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  initialAvailableOutgoingBitrate: 1_000_000,
};
