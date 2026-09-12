import { apiRequest } from "./http.js";

// Perfil da conta oficial ("Zeno, o Astronauta") - mesmo formato de
// api/profile.js (que é o "/users/me" do próprio usuário logado), só que
// mirado no usuário de sistema via rota admin-only (adminSystemUser.routes.js).
export const getSystemProfile = () => apiRequest("/admin/system-user");

export const updateSystemProfile = (fields) =>
  apiRequest("/admin/system-user", { method: "PATCH", body: JSON.stringify(fields) });

// `dataUrl` = FileReader.readAsDataURL(file), mesmo contrato de uploadAvatar.
export const uploadSystemAvatar = (dataUrl) =>
  apiRequest("/admin/system-user/avatar", { method: "POST", body: JSON.stringify({ image: dataUrl }) });

export const removeSystemAvatar = () =>
  apiRequest("/admin/system-user/avatar", { method: "DELETE" });
