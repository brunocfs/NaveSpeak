import { useState } from "react";

// Modal simples para escolher qual tela/janela compartilhar quando rodando
// dentro do Electron (no navegador comum, o próprio getDisplayMedia já
// mostra esse seletor nativamente, então este componente nem é usado lá).
//
// Checkbox de áudio: só faz sentido aqui (Electron) porque o navegador
// comum já mostra a opção "Compartilhar áudio" dentro do seletor NATIVO dele
// (getDisplayMedia({ audio: true }) só pede pra essa opção aparecer, quem
// decide de verdade é o usuário ali - ver requestScreenStream em
// api/media.js). No Electron não existe esse seletor nativo, então
// precisamos da nossa própria opção. `title`/`confirmLabel` mudam o texto
// pra reaproveitar o mesmo modal tanto pra COMEÇAR quanto pra TROCAR a fonte
// compartilhada.
export default function ScreenSourcePicker({
  sources,
  onSelect,
  onCancel,
  title = "Escolha o que compartilhar",
  defaultWithAudio = false,
}) {
  const [selected, setSelected] = useState(null);
  const [withAudio, setWithAudio] = useState(defaultWithAudio);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h3>{title}</h3>
        <div className="source-grid">
          {sources.map((source) => (
            <button
              key={source.id}
              className="source-option"
              aria-pressed={selected === source.id}
              onClick={() => setSelected(source.id)}
              onDoubleClick={() => onSelect(source.id, withAudio)}
            >
              {source.thumbnail && <img src={source.thumbnail} alt="" />}
              <span>{source.name}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={withAudio}
            onChange={(e) => setWithAudio(e.target.checked)}
          />
          Compartilhar áudio do sistema (quando suportado)
        </label>
        <div className="flex gap-2">
          <button className="modal-cancel" onClick={onCancel}>Cancelar</button>
          <button
            className="modal-confirm"
            disabled={!selected}
            onClick={() => onSelect(selected, withAudio)}
          >
            Compartilhar
          </button>
        </div>
      </div>
    </div>
  );
}
