import { useState } from 'react';

export default function MessageInput({ onSend, disabled }) {
  const [content, setContent] = useState('');
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;

    setError(null);
    const result = await onSend(trimmed);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setContent('');
  }

  return (
    <form className="message-input" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Escreva uma mensagem..."
        maxLength={2000}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !content.trim()}>
        Enviar
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}
