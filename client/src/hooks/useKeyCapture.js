import { useEffect } from "react";

const MODIFIER = /^(Control|Shift|Alt|Meta)(Left|Right)$/;

// Enquanto alguma captura está ativa, os atalhos globais (GlobalShortcuts)
// ficam pausados - senão gravar "Ctrl+Shift+A" dispararia a ação dele.
let capturing = false;
export const isCapturingKey = () => capturing;

// Captura UMA combinação de teclas enquanto `active`. Acumula teclas na
// ordem em que são apertadas e fecha ao apertar uma tecla não-modificadora,
// ou ao soltar qualquer tecla (cobre combinações só de modificadores).
// `onDone(combo)` recebe os `KeyboardEvent.code` unidos por "+" (ex.:
// "ControlLeft+ShiftLeft+KeyA"), ou `null` se cancelado com Esc.
// `capture: true` + preventDefault/stopPropagation pra a tecla capturada não
// ter o efeito normal dela (Tab tirando o foco, Espaço re-clicando).
export function useKeyCapture(active, onDone) {
  useEffect(() => {
    if (!active) return;
    capturing = true;
    const combo = [];
    function handleKeyDown(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") return onDone(null);
      if (!combo.includes(e.code)) combo.push(e.code);
      if (!MODIFIER.test(e.code)) onDone(combo.join("+"));
    }
    function handleKeyUp(e) {
      e.preventDefault();
      e.stopPropagation();
      if (combo.length) onDone(combo.join("+"));
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    return () => {
      capturing = false;
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
