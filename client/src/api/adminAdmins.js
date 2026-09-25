import { apiRequest } from "./http.js";

export const listAdmins = () => apiRequest("/admin/admins");

export const addAdmin = (tag) =>
  apiRequest("/admin/admins", { method: "POST", body: JSON.stringify({ tag }) });

export const removeAdmin = (userId) =>
  apiRequest(`/admin/admins/${userId}`, { method: "DELETE" });
