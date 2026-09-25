import { useSyncExternalStore } from "react";

// Acompanha uma media query CSS (ex.: layout de celular abaixo do breakpoint
// `lg` do Tailwind) - re-renderiza ao girar a tela/redimensionar a janela.
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
