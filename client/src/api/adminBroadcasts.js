import { apiRequest } from "./http.js";

export const listBroadcasts = () => apiRequest("/admin/broadcasts");

// payload: { content, attachments, target: 'all' } ou { content, attachments, target: 'user', tag }
export const sendBroadcast = (payload) =>
  apiRequest("/admin/broadcasts", { method: "POST", body: JSON.stringify(payload) });
