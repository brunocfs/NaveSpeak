import { useState } from 'react';
import { isElectron, listScreenSources } from '../api/media.js';
import ScreenSourcePicker from './ScreenSourcePicker.jsx';
import ParticipantTile from './ParticipantTile.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Área de compartilhamento de tela: mostra a prévia local (quando você está
// compartilhando) e a tela de qualquer outro participante que esteja
// compartilhando na sala. Só aparece quando há pelo menos um compartilhamento
// ativo, para não ocupar espaço à toa.
export default function ScreenShareView({ media }) {
  const { user } = useAuth();
  const [pickerSources, setPickerSources] = useState(null);

  const remoteScreens = media.remoteStreams.filter((s) => s.appData?.source === 'screen');
  const hasAnyShare = media.sharingScreen || remoteScreens.length > 0;

  async function handleShareClick() {
    if (isElectron()) {
      const sources = await listScreenSources();
      setPickerSources(sources ?? []);
      return;
    }
    media.shareScreen();
  }

  function handlePickSource(sourceId) {
    setPickerSources(null);
    media.shareScreen(sourceId);
  }

  return (
    <div className="screen-share-bar">
      <div className="screen-share-controls">
        {!media.sharingScreen ? (
          <button onClick={handleShareClick} disabled={!media.connected}>
            Compartilhar tela
          </button>
        ) : (
          <button className="danger" onClick={media.stopScreenShare}>
            Parar compartilhamento
          </button>
        )}
        {!media.connected && <span className="hint">Entre na voz para compartilhar sua tela.</span>}
      </div>

      {hasAnyShare && (
        <div className="screen-share-grid">
          {media.sharingScreen && (
            <ParticipantTile username={`${user?.username} (sua tela)`} stream={media.localScreenStream} kind="video" isLocal />
          )}
          {remoteScreens.map((s) => (
            <ParticipantTile key={s.producerId} username={`${s.username} (tela)`} stream={s.stream} kind="video" />
          ))}
        </div>
      )}

      {pickerSources && (
        <ScreenSourcePicker
          sources={pickerSources}
          onSelect={handlePickSource}
          onCancel={() => setPickerSources(null)}
        />
      )}
    </div>
  );
}
