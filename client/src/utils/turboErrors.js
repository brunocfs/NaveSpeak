// Texto traduzido de um erro com `code` (REST: Error de apiRequest; socket: ack
// { error, code, max... }). Sem code conhecido, cai na mensagem do servidor.
export function turboErrorText(t, e) {
  const d = e?.data ?? e ?? {};
  const message = e?.message ?? e?.error;
  const code = e?.code ?? d.code;
  if (!code) return message;
  const max = d.max ?? (d.maxBytes ? `${Math.round(d.maxBytes / 1048576)} MB` : d.maxMs ? `${d.maxMs / 1000}s` : '');
  return t(`turbo.errors.${code}`, { defaultValue: message, max });
}
