import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Avatar from "./Avatar.jsx";

export default function UserProfilePreview({
  isSelf,
  userId,
  username,
  discriminator,
  avatarPath,
}) {
  const navigate = useNavigate();
  const [message, setMessage] = useState("");

  // Não manda a mensagem daqui - abre a conversa completa em /rooms (mesmo
  // formato de state que a notificação de DM usa, ver NotificationContext.jsx/
  // RoomsPage.jsx) já com o texto digitado pronto pra enviar (DmPanel.jsx
  // dispara o dm:send assim que a conversa abre).
  function handleSend(e) {
    e.preventDefault();
    const text = message.trim();
    if (!text || !userId) return;
    navigate("/rooms", {
      state: {
        openDmWith: { id: userId, username, avatarPath, pendingMessage: text },
      },
    });
  }

  return (
    <div className="z-[9999] w-80   rounded-lg border border-slate-200 bg-white   shadow-lg dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-col p-3 ">
        <div className="relative dark:bg-black h-25 -mx-3 -mt-3 rounded-t-lg">
          <Avatar
            avatarPath={avatarPath}
            username={username}
            size="xl"
            className="absolute left-5 top-15 z-10 border"
          />
        </div>

        <div class="flex flex-col w-full pt-12 gap-3">
          <span>{username}</span>
          {!isSelf && (
            <form onSubmit={handleSend}>
              <input
                className="w-full p-2 dark:bg-slate-900 rounded-xl "
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Manda o papo.. "
              />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
