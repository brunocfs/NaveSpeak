import { apiRequest } from './http.js';

// Converte um File do input <input type="file"> num data URL base64 - mesmo
// formato que o server espera em POST /attachments (fileData) e que
// AvatarUpload já usa pra ícone de servidor/avatar.
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

// Sobe UM arquivo e devolve a referência ({path, name, size, mime}) usada no
// payload de chat:send/dm:send (ver MessageInput.jsx). MessageInput chama
// isso uma vez por arquivo selecionado.
export async function uploadAttachment(file) {
  const fileData = await readFileAsDataUrl(file);
  return apiRequest('/attachments', {
    method: 'POST',
    body: JSON.stringify({ fileData, fileName: file.name }),
  });
}
