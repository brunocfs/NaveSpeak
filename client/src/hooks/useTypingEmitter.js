import { useCallback, useEffect, useRef } from "react";

const TYPING_EMIT_INTERVAL_MS = 2000; // no máximo 1 "digitando" por 2s, não a cada tecla
const TYPING_STOP_DELAY_MS = 3000; // silêncio de 3s = avisa "parou" sozinho

// Controla o EMISSOR do indicador de "está digitando" (client -> servidor).
// notifyTyping(hasContent) é chamado a cada tecla (ver MessageInput.jsx):
// entra em modo "digitando" na primeira, reforça no máximo 1x a cada
// TYPING_EMIT_INTERVAL_MS enquanto a pessoa continua digitando (evita
// inundar o socket a cada tecla) e avisa "parou" sozinho depois de
// TYPING_STOP_DELAY_MS sem nova tecla - cobre fechar aba/perder conexão sem
// nunca mandar o "parou" explícito. `stop()` é exposto à parte pra chamar
// direto ao enviar a mensagem ou trocar de canal/conversa.
export function useTypingEmitter(emitFn) {
  const typingRef = useRef(false);
  const lastEmitRef = useRef(0);
  const stopTimerRef = useRef(null);

  const clearStopTimer = () => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  };

  const stop = useCallback(() => {
    clearStopTimer();
    if (typingRef.current) {
      typingRef.current = false;
      emitFn(false);
    }
  }, [emitFn]);

  const notifyTyping = useCallback(
    (hasContent) => {
      clearStopTimer();
      if (!hasContent) {
        stop();
        return;
      }
      const now = Date.now();
      if (!typingRef.current || now - lastEmitRef.current > TYPING_EMIT_INTERVAL_MS) {
        typingRef.current = true;
        lastEmitRef.current = now;
        emitFn(true);
      }
      stopTimerRef.current = setTimeout(stop, TYPING_STOP_DELAY_MS);
    },
    [emitFn, stop],
  );

  // Desmontar (fechar painel) ou trocar de canal/conversa (emitFn muda de
  // identidade) sempre avisa "parou" antes de sumir - senão o indicador fica
  // preso do lado de quem estava vendo.
  useEffect(() => stop, [stop]);

  return { notifyTyping, stop };
}
