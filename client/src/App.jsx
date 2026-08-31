import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { PreferencesProvider } from './context/PreferencesContext.jsx';
import { PresenceProvider } from './context/PresenceContext.jsx';
import { MediaSessionProvider } from './context/MediaSessionContext.jsx';
import { CallProvider } from './context/CallContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import VoiceStatusBar from './components/VoiceStatusBar.jsx';
import VoicePanel from './components/VoicePanel.jsx';
import CallInviteBanner from './components/CallInviteBanner.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import RoomsPage from './pages/RoomsPage.jsx';
import RoomPage from './pages/RoomPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import AdminInvitesPage from './pages/AdminInvitesPage.jsx';
import InviteRedirectPage from './pages/InviteRedirectPage.jsx';

export default function App() {
  return (
    // PreferencesProvider fica no topo de tudo, acima até de AuthProvider:
    // tema precisa se aplicar em qualquer tela, autenticada ou não (Login,
    // Register), e não pode esperar login pra existir - ver
    // PreferencesContext.jsx.
    <PreferencesProvider>
    <AuthProvider>
      {/* PresenceProvider fica ACIMA de <Routes> pelo mesmo motivo de
          MediaSessionProvider logo abaixo: a detecção de inatividade (15min
          -> "Ausente" automático) precisa rodar não importa qual tela está
          montada, não só quando o seletor de status (RoomsPage.jsx) está
          visível - ver PresenceContext.jsx. */}
      <PresenceProvider>
      {/* MediaSessionProvider fica ACIMA de <Routes> de propósito: a sessão
          de voz/vídeo não pode depender de qual tela está montada no
          momento, senão navegar de volta para a tela inicial desconecta o
          usuário da chamada (ver MediaSessionContext.jsx). VoiceStatusBar e
          VoicePanel também são montados aqui, fora das rotas, para
          continuar visíveis/ativos em qualquer tela enquanto a chamada
          seguir ativa - inclui a janela de popout do VoicePanel, que antes
          fechava sozinha ao sair da tela da sala porque vivia dentro dela. */}
      <MediaSessionProvider>
        {/* CallProvider fica DENTRO de MediaSessionProvider (usa
            useMediaSession internamente) e ACIMA de <Routes> pelo mesmo
            motivo de VoiceStatusBar/VoicePanel: uma chamada (convite
            recebido, ou já em andamento) não pode depender de qual tela
            está montada. NotificationProvider pelo mesmo motivo - mensagem
            nova pode chegar em qualquer tela (usa useNavigate, por isso
            precisa estar dentro do <BrowserRouter> de main.jsx, que já
            envolve <App/> inteiro). */}
        <CallProvider>
          <NotificationProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              {/* Link curto de convite (/invite/:code) - redireciona pra
                  /register?invite=:code, ver InviteRedirectPage.jsx. Fora de
                  ProtectedRoute: precisa funcionar deslogado, é assim que
                  gente nova entra no app. */}
              <Route path="/invite/:code" element={<InviteRedirectPage />} />
              <Route
                path="/rooms"
                element={
                  <ProtectedRoute>
                    <RoomsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/rooms/:roomId"
                element={
                  <ProtectedRoute>
                    <RoomPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <ProfilePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/reports"
                element={
                  <ProtectedRoute>
                    <ReportsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/invites"
                element={
                  <ProtectedRoute requireAdmin>
                    <AdminInvitesPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/rooms" replace />} />
            </Routes>
            <VoiceStatusBar />
            <VoicePanel />
            <CallInviteBanner />
          </NotificationProvider>
        </CallProvider>
      </MediaSessionProvider>
      </PresenceProvider>
    </AuthProvider>
    </PreferencesProvider>
  );
}
