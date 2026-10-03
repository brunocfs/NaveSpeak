import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { closePreferences } from '../utils/preferencesEvents.js';

// Cadeado de benefício TURBO -> abre o TurboPanel (RoomsPage lê state.openPanel).
// Fecha as Preferências antes (o modal ficaria por cima da landing).
export function useOpenTurbo() {
  const navigate = useNavigate();
  return useCallback(() => {
    closePreferences();
    navigate('/rooms', { state: { openPanel: 'turbo' } });
  }, [navigate]);
}
