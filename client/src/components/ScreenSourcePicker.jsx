// Modal simples para escolher qual tela/janela compartilhar quando rodando
// dentro do Electron (no navegador comum, o próprio getDisplayMedia já
// mostra esse seletor nativamente, então este componente nem é usado lá).
export default function ScreenSourcePicker({ sources, onSelect, onCancel }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h3>Escolha o que compartilhar</h3>
        <div className="source-grid">
          {sources.map((source) => (
            <button key={source.id} className="source-option" onClick={() => onSelect(source.id)}>
              {source.thumbnail && <img src={source.thumbnail} alt="" />}
              <span>{source.name}</span>
            </button>
          ))}
        </div>
        <button className="modal-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
