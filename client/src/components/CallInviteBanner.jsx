import { PhoneOff, Phone } from "lucide-react";
import { useCall } from "../context/CallContext.jsx";

// Montado globalmente (App.jsx, junto de VoiceStatusBar/VoicePanel) - uma
// chamada recebida precisa aparecer não importa em qual tela o usuário
// esteja (tela inicial, dentro de uma sala, etc.), mesmo raciocínio que já
// levou a barra de voz a ser global.
export default function CallInviteBanner() {
  const { incomingCalls, acceptCall, declineCall } = useCall();

  if (incomingCalls.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 z-20 flex -translate-x-1/2 flex-col gap-2">
      {incomingCalls.map((invite) => (
        <div
          key={invite.callId}
          className="flex items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-lg dark:bg-slate-800"
        >
          <span className="text-sm font-medium">Chamada de {invite.from.username}</span>
          <button
            onClick={() => acceptCall(invite)}
            title="Aceitar"
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            <Phone className="size-4" /> Aceitar
          </button>
          <button
            onClick={() => declineCall(invite)}
            title="Recusar"
            className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            <PhoneOff className="size-4" /> Recusar
          </button>
        </div>
      ))}
    </div>
  );
}
