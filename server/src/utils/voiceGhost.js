// Lógica pura do ghostVoice (contrato TURBO, seção 0).

// Fantasma efetivo = benefício AND preferência do usuário AND status
// preferido 'invisible'. Só em canal de servidor (chamada privada fica fora).
export const isEffectiveGhost = ({ hasBenefit, ghostPref, status }) =>
  Boolean(hasBenefit && ghostPref && status === 'invisible');

// Cada participante vira { ..., ghost: true } na lista completa (mods e quem
// está na voz); a filtrada (resto do servidor) nem lista os fantasmas.
export function splitRoster(participants, ghostIds) {
  const ghosts = new Set(ghostIds);
  const full = participants.map((p) => (ghosts.has(p.userId) ? { ...p, ghost: true } : p));
  const filtered = participants.filter((p) => !ghosts.has(p.userId));
  return { full, filtered, hasGhosts: filtered.length !== participants.length };
}
