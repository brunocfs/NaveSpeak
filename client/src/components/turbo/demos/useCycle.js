import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '../useReveal.js';

// Índice que avança a cada `ms` (loop das demos). Com movimento reduzido fica
// parado no 0 - por isso o estado 0 de cada demo é o "resultado TURBO".
export function useCycle(length, ms = 1800) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const id = setInterval(() => setI((v) => (v + 1) % length), ms);
    return () => clearInterval(id);
  }, [length, ms]);
  return i;
}
