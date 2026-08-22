import { useAuth } from '../context/AuthContext.jsx';
import ParticipantTile from './ParticipantTile.jsx';

// Recebe o hook useMediasoup já instanciado pelo RoomPage (em vez de criar o
// seu próprio), assim VoicePanel e ScreenShareView compartilham a mesma
// conexão/estado em vez de abrir transports duplicados.
export default function VoicePanel({ media }) {
  const { user } = useAuth();
  const { connected, muted, remoteStreams, error, joinVoice, leaveVoice, toggleMute, cameraOn, localCameraStream, shareCamera, stopCamera } = media;

  const voiceParticipants = remoteStreams.filter((s) => s.appData?.source === 'mic');
  const cameraParticipants = remoteStreams.filter((s) => s.appData?.source === 'camera');

  return (
    <div className="voice-panel">
      <div className="voice-panel-header">
        <h3>Voz</h3>
        {!connected ? (
          <button onClick={joinVoice}>Entrar na voz</button>
        ) : (
          <div className="voice-controls">
            <button onClick={toggleMute}>{muted ? 'Ativar mic' : 'Silenciar'}</button>
            <button onClick={cameraOn ? stopCamera : shareCamera}>{cameraOn ? 'Desligar câmera' : 'Ligar câmera'}</button>
            <button onClick={leaveVoice} className="danger">Sair da voz</button>
          </div>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      {connected && (
        <div className="voice-participants">
          <ParticipantTile username={`${user?.username} (você)`} muted={muted} isLocal />
          {voiceParticipants.map((p) => (
            <ParticipantTile key={p.producerId} username={p.username} stream={p.stream} muted={p.paused} />
          ))}

          {cameraOn && (
            <ParticipantTile username={`${user?.username} (câmera)`} stream={localCameraStream} kind="video" isLocal />
          )}
          {cameraParticipants.map((p) => (
            <ParticipantTile key={p.producerId} username={p.username} stream={p.stream} kind="video" muted={p.paused} />
          ))}
        </div>
      )}
    </div>
  );
}
