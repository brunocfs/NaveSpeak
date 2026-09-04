import { useEffect, useRef } from "react";
import {
  MicOff,
  Pin,
  PinOff,
  HeadphoneOff,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Play,
} from "lucide-react";
import { useSpeaking } from "../hooks/useSpeaking.js";
import Avatar from "./Avatar.jsx";

// Um "quadradinho" da chamada, no estilo Discord: representa UMA pessoa (com
// câmera ligada ou avatar com iniciais) OU uma tela compartilhada - nunca os
// dois juntos no mesmo tile (uma tela compartilhada é sempre um tile à parte,
// rotulado com o nome de quem está compartilhando). kind='person' desenha o
// anel roxo de "está falando" a partir de `micStream` - a REPRODUÇÃO do áudio
// em si não mora aqui (ver RemoteAudioPlayers.jsx): este tile pode desmontar
// (ex.: "esconder quem está sem câmera/tela" em VoicePanel.jsx) sem cortar o
// som de ninguém.
export default function ParticipantTile({
  username,
  avatarPath = null,
  videoStream = null,
  micStream = null,
  micMuted = false,
  isLocal = false,
  deafened = false,
  kind = "person",
  pinned = false,
  onTogglePin,
  // Só usados em kind='screen': se este compartilhamento tem áudio (ver
  // appData.source 'screen-audio' em MediaSessionContext.jsx) e o controle
  // de volume correspondente - de ENVIO (setLocalScreenAudioVolume) pro
  // tile LOCAL da própria tela, de ESCUTA (getScreenAudioVolume/
  // setScreenAudioVolume em PreferencesContext) pros tiles REMOTOS. Este
  // componente não distingue os dois casos, só renderiza o slider e chama o
  // callback que VoicePanel já resolveu certo pra cada tile.
  hasAudio = false,
  audioVolume = 100,
  onAudioVolumeChange,
  // 200 pro tile LOCAL (ganho de ENVIO, ver audio/gainStream.js), 100 pros
  // tiles REMOTOS (volume de escuta via el.volume, sem boost - ver
  // RemoteAudioPlayers.jsx).
  audioVolumeMax = 100,
  // Ocultar (webcam OU tela, conforme quem monta o tile decide - ver
  // VoicePanel.jsx) é uma escolha 100% LOCAL de quem está vendo: nunca
  // chega no servidor, nunca afeta o que os outros participantes veem.
  // Passar `onToggleHiddenMedia` já é o que decide se o botão de olho
  // aparece - tiles locais (a própria câmera/tela) nunca recebem esse prop.
  hiddenMedia = false,
  onToggleHiddenMedia,
  // "Precisa de início manual": mídia disponível mas NÃO tocando ainda,
  // porque a preferência de autoplay (webcam/tela, ver PreferencesContext)
  // está desligada e ninguém clicou pra assistir esta ainda (estado
  // efêmero, vive em VoicePanel.jsx). Só faz sentido quando `hiddenMedia`
  // for false - oculto sempre tem prioridade sobre "aguardando clique".
  needsManualStart = false,
  onStartWatching,
  // Mute LOCAL do mic (kind='person', remoto) - silencia só a REPRODUÇÃO
  // pra quem aplicou, nunca o producer real de quem fala (esse seria
  // moderação/mute de verdade, outro mecanismo, ver VoiceRosterEntry.jsx).
  locallyMuted = false,
  onToggleLocalMute,
  className = "",
  style,
}) {
  const videoRef = useRef(null);
  const speaking = useSpeaking(kind === "person" ? micStream : null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoStream) return;
    el.srcObject = videoStream;
    el.play?.().catch(() => {});
  }, [videoStream]);

  // Reprodução local sempre muda (não ecoar o próprio mic/câmera); a de
  // qualquer participante remoto some com "silenciar todos" (deafen) ativo.
  const playbackMuted = isLocal || deafened;
  const hasVideo = Boolean(videoStream);
  // Oculto tem prioridade sobre "aguardando clique" - ver comentário de
  // needsManualStart acima. `gated` só controla a VISIBILIDADE do <video>
  // (classe CSS, ver abaixo) - o elemento em si fica sempre montado quando
  // hasVideo, nunca desmontado por isso. Importante: o efeito que faz
  // `el.srcObject = videoStream` só depende de [videoStream], não do estado
  // de gate - se o <video> fosse desmontado/remontado ao sair do gate (ex.:
  // renderização condicional `{!gated && <video/>}`), o elemento NOVO
  // nasceria sem srcObject nenhum (o efeito não re-executaria, já que
  // videoStream não mudou) e a mídia nunca apareceria depois de assistir.
  // Manter o nó sempre vivo e só trocar a exibição visual evita essa classe
  // inteira de bug.
  const gated = hasVideo && (hiddenMedia || needsManualStart);

  return (
    <div
      className={`group relative aspect-video w-full  items-center justify-center overflow-hidden rounded-xl bg-slate-800 ring-3 transition ${
        speaking ? "ring-green-400" : "ring-transparent"
      } ${className}`}
      style={style}
    >
      {hasVideo && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={playbackMuted}
          // Espelha só a PRÓPRIA câmera (efeito "espelho", como o resto do
          // mercado - Discord/Meet/Zoom fazem igual): é só um flip visual
          // deste elemento <video>, a track que sai pro sendTransport nunca
          // é tocada, então quem recebe continua vendo do jeito normal.
          // Nunca aplica em tela compartilhada (kind='screen') - inverter a
          // própria tela ficaria ilegível. `gated` some com o vídeo via
          // CSS (não desmonta - ver comentário acima).
          className={`h-full w-full ${gated ? "hidden" : ""} ${kind === "screen" ? "object-contain bg-black" : "object-cover"} ${
            isLocal && kind === "person" ? "-scale-x-100" : ""
          }`}
        />
      )}
      {(!hasVideo || gated) && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-700">
          {/* Foto de perfil como estado visual padrão - de quem está sem
              câmera/tela, de mídia OCULTADA, ou aguardando clique pra
              assistir (autoplay desligado, ver needsManualStart acima). */}
          <Avatar
            avatarPath={avatarPath}
            username={username}
            size="xl"
            className="!bg-slate-600 !text-slate-100"
          />
          {hasVideo && hiddenMedia && (
            <span className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[11px] font-medium text-slate-200">
              <EyeOff className="size-3" /> Mídia oculta
            </span>
          )}
          {hasVideo && !hiddenMedia && needsManualStart && (
            <button
              onClick={onStartWatching}
              title="Clique para assistir"
              className="flex items-center gap-1.5 rounded-full bg-blue-600/90 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
            >
              <Play className="size-3.5" /> Assistir
            </button>
          )}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
        <span className="truncate text-xs font-medium text-white">
          {username}
        </span>
        <div className="flex items-center gap-2">
          {kind === "person" && micMuted && (
            <MicOff className="size-3.5 shrink-0 text-red-400" />
          )}
          {kind === "person" && deafened && (
            <HeadphoneOff className="size-3.5 shrink-0 text-red-400" />
          )}
          {kind === "person" && locallyMuted && (
            <VolumeX
              className="size-3.5 shrink-0 text-orange-400"
              title="Mutado localmente (só pra você)"
            />
          )}
          {/* Indicador visual + controle de volume do áudio compartilhado -
              só em tiles de tela que de fato carregam áudio. Slider some por
              padrão (só o ícone fica), aparece no hover pra não ocupar
              espaço da barra o tempo todo - mesmo padrão do botão de pin. */}
          {kind === "screen" && hasAudio && (
            <div
              className="group/vol flex items-center gap-1.5"
              title="Áudio compartilhado"
            >
              <Volume2 className="size-3.5 shrink-0 text-white" />
              {onAudioVolumeChange && (
                <input
                  type="range"
                  min={0}
                  max={audioVolumeMax}
                  value={audioVolume}
                  onChange={(e) => onAudioVolumeChange(Number(e.target.value))}
                  onClick={(e) => e.stopPropagation()}
                  title={`Volume: ${audioVolume}%`}
                  className="h-1 w-0 cursor-pointer accent-blue-500 opacity-0 transition-all duration-150 group-hover/vol:w-16 group-hover/vol:opacity-100"
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Ações LOCAIS por participante - só pra tiles remotos (nunca a
          própria câmera/tela/mic). Empilhadas no canto superior direito,
          junto do pin: ocultar mídia (webcam OU tela, quem monta o tile
          decide QUAL - ver VoicePanel.jsx) e, só em kind='person', mutar
          o mic localmente. Nenhuma delas afeta os outros participantes -
          são só preferências de audição/visualização de quem clica,
          persistidas em PreferencesContext. */}
      <div
        className={`absolute right-1.5 top-1.5 flex gap-1 transition ${
          pinned || hiddenMedia || locallyMuted
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100"
        }`}
      >
        {onToggleLocalMute && (
          <button
            onClick={onToggleLocalMute}
            title={
              locallyMuted
                ? "Reativar áudio (só pra você)"
                : "Mutar localmente (só pra você)"
            }
            className="rounded-lg bg-black/50 p-1.5 text-white transition hover:bg-black/70"
          >
            {locallyMuted ? (
              <VolumeX className="size-3.5" />
            ) : (
              <Volume2 className="size-3.5" />
            )}
          </button>
        )}
        {onToggleHiddenMedia && (
          <button
            onClick={onToggleHiddenMedia}
            title={
              hiddenMedia
                ? "Mostrar esta mídia"
                : "Ocultar esta mídia (só pra você)"
            }
            className="rounded-lg bg-black/50 p-1.5 text-white transition hover:bg-black/70"
          >
            {hiddenMedia ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
          </button>
        )}
        {onTogglePin && (
          <button
            onClick={onTogglePin}
            title={pinned ? "Desafixar" : "Fixar (deixar maior)"}
            className="rounded-lg bg-black/50 p-1.5 text-white transition hover:bg-black/70"
          >
            {pinned ? (
              <PinOff className="size-3.5" />
            ) : (
              <Pin className="size-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
