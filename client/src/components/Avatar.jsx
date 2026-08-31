import { useEffect, useState } from "react";
import { API_URL } from "../api/config.js";

// Fonte única de verdade pra montar a URL de um avatar a partir do caminho
// relativo gravado no banco (users.avatar_path, ex.: "avatars/<uuid>.png") -
// mesmo formato usado por mensagens de chat/DM, amigos, membros de servidor
// e roster de voz. Reaproveitado fora do componente por quem só precisa da
// URL (ex.: NotificationContext.jsx pro ícone da notificação desktop).
export function avatarSrc(avatarPath) {
  return avatarPath ? `${API_URL}/uploads/${avatarPath}` : null;
}

// Iniciais de fallback (1 ou 2 letras) - mesma regra usada antes só dentro
// de ParticipantTile.jsx, agora compartilhada por todo lugar que usa Avatar.
export function initials(name = "") {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
  xl: "h-20 w-20 text-2xl",
};

// Avatar padrão da aplicação inteira: foto cadastrada (users.avatar_path)
// quando existe, senão um círculo com as iniciais do username - mesmo
// fallback em todo lugar (servidor, chat de servidor/privado, lista de
// amigos, topbar). Usado também dentro de ParticipantTile.jsx como estado
// visual padrão de quem está sem câmera/tela compartilhada na chamada.
export default function Avatar({ avatarPath, username, size = "md", className = "" }) {
  const src = avatarSrc(avatarPath);
  const [broken, setBroken] = useState(false);

  // Se o avatar mudar (ex.: outro participante, ou o próprio usuário trocou
  // de foto) um erro de carregamento anterior não deve continuar "preso" -
  // sem isso, uma vez quebrado o fallback ficaria pra sempre mesmo com uma
  // URL nova e válida.
  useEffect(() => {
    setBroken(false);
  }, [src]);

  const sizeClass = SIZES[size] ?? SIZES.md;

  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setBroken(true)}
        className={`${sizeClass} shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <span
      className={`${sizeClass} inline-flex shrink-0 items-center justify-center rounded-full bg-slate-300 font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200 ${className}`}
    >
      {initials(username)}
    </span>
  );
}
