import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Avatar from "../components/Avatar.jsx";
import { getInvitePreview, joinRoomByInvite } from "../api/rooms.js";
import logo from "../assets/nvspk.svg";

// Página de convite de servidor (/join/:code) - o link que ServerUserInvite.jsx
// gera e compartilha. Diferente de /invite/:code (InviteRedirectPage.jsx,
// convite de CADASTRO na aplicação): aqui o usuário já está logado
// (ProtectedRoute em App.jsx) e só falta decidir se entra NESTE servidor.
// Mostra nome/imagem/descrição antes de perguntar - só entra de fato (POST
// /rooms/join) se ele clicar em "Entrar"; "Recusar" não faz nenhuma
// chamada, só volta pra tela inicial.
export default function ServerInvitePage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getInvitePreview(code)
      .then((data) => {
        if (!cancelled) setState({ loading: false, error: null, data });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function handleAccept() {
    setJoining(true);
    setJoinError(null);
    try {
      const { room } = await joinRoomByInvite(code);
      navigate(`/rooms/${room.id}`, { replace: true });
    } catch (err) {
      setJoinError(err.message ?? "Não foi possível entrar no servidor.");
      setJoining(false);
    }
  }

  function handleDecline() {
    navigate("/rooms", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <img src={logo} alt="" className="mx-auto mb-4 h-10 w-10 dark:hidden" />

        {state.loading && (
          <p className="py-6 text-sm text-slate-500 dark:text-slate-400">Carregando convite...</p>
        )}

        {!state.loading && state.error && (
          <>
            <p className="mb-6 text-sm text-red-600 dark:text-red-400">{state.error}</p>
            <Link
              to="/rooms"
              className="inline-block rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Voltar
            </Link>
          </>
        )}

        {!state.loading && !state.error && (state.data?.expired || state.data?.revoked) && (
          <>
            <h1 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
              {state.data.revoked ? "Convite revogado" : "Convite expirado"}
            </h1>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
              Esse link de convite não é mais válido. Peça um novo link a algum membro do servidor.
            </p>
            <Link
              to="/rooms"
              className="inline-block rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Voltar
            </Link>
          </>
        )}

        {!state.loading && !state.error && !state.data?.expired && !state.data?.revoked && state.data?.banned && (
          <>
            <h1 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
              Você não pode entrar
            </h1>
            <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
              Você foi banido deste servidor.
            </p>
            <Link
              to="/rooms"
              className="inline-block rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Voltar
            </Link>
          </>
        )}

        {!state.loading && !state.error && !state.data?.expired && !state.data?.revoked && !state.data?.banned && (
          <>
            <Avatar
              avatarPath={state.data.room.icon_path}
              username={state.data.room.name}
              size="xl"
              className="mx-auto mb-4"
            />
            <h1 className="mb-1 truncate text-xl font-bold text-slate-900 dark:text-white">
              {state.data.room.name}
            </h1>
            {state.data.room.description && (
              <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                {state.data.room.description}
              </p>
            )}

            {state.data.alreadyMember ? (
              <>
                <p className="mb-6 mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Você já é membro deste servidor.
                </p>
                <button
                  onClick={() => navigate(`/rooms`, { replace: true })}
                  className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Ir para o servidor
                </button>
              </>
            ) : (
              <>
                <p className="mb-6 mt-2 text-sm text-slate-600 dark:text-slate-300">
                  Deseja entrar neste servidor?
                </p>
                {joinError && (
                  <p className="mb-3 text-xs text-red-600 dark:text-red-400">{joinError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleDecline}
                    disabled={joining}
                    className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Recusar
                  </button>
                  <button
                    onClick={handleAccept}
                    disabled={joining}
                    className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    {joining ? "Entrando..." : "Entrar"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
