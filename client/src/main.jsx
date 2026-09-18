import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { reportClientEvent } from './observability/telemetry.js';
import './styles/index.css';

// Reserva o espaço da barra de título custom (TitleBar.jsx, 36px) em toda
// classe de altura de tela (h-screen/min-h-screen) usada pelas páginas -
// feito ANTES do render (sem useEffect) pra não piscar o layout sem o
// espaço reservado por um frame. window.naveSpeak só existe dentro do
// Electron (ver preload.js/api/media.js).
if (window.naveSpeak?.getScreenSources) {
  document.documentElement.classList.add('electron-app');
}

// Erros fora da árvore React (callbacks, promises soltas) - só nome +
// mensagem, com amostragem em telemetry.js.
window.addEventListener('error', (event) => {
  reportClientEvent('client_unhandled_error', {
    error_code: 'WINDOW_ERROR',
    message: `${event.error?.name ?? 'Error'}: ${event.message ?? ''}`,
  });
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  reportClientEvent('client_unhandled_error', {
    error_code: 'UNHANDLED_REJECTION',
    message: reason instanceof Error ? `${reason.name}: ${reason.message}` : 'Non-error promise rejection',
  });
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
