import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// `requireAdmin` gate a rota atrás de user.isAdmin (users.is_admin no
// servidor, ver painel de convites - AdminInvitesPage.jsx) além do login já
// exigido por padrão. Quem está logado mas não é admin volta pra /rooms em
// vez de ver uma tela de "sem permissão" - a rota nem aparece na navegação
// pra quem não é admin (ver RoomsPage.jsx), então chegar aqui sem ser admin
// só acontece digitando a URL na mão.
export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { user, loading } = useAuth();

  if (loading) return <p className="centered">Carregando...</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (requireAdmin && !user.isAdmin) return <Navigate to="/rooms" replace />;

  return children;
}
