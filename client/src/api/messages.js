import { apiRequest } from './http.js';

// Avança o cursor de leitura do canal para o usuário autenticado - zera o
// badge de não lidas dele (ver ChatPanel.jsx/RoomPage.jsx), mesmo padrão de
// markConversationRead em api/dm.js.
export const markChannelRead = (channelId) =>
  apiRequest(`/channels/${channelId}/messages/read`, { method: 'POST' });
