import { Navigate, useParams } from "react-router-dom";

// Rota curta pra distribuir convite (/invite/:code) - existe só para dar um
// link "bonito" e fácil de compartilhar; a validação de verdade (e o
// formulário) ficam em RegisterPage.jsx, que já checa o código contra
// GET /invites/check/:code (ver useEffect lá) e mostra se é válido, expirado
// ou já esgotado. Um convite VÁLIDO cai direto no formulário de cadastro já
// com o código preenchido.
export default function InviteRedirectPage() {
  const { code } = useParams();
  return <Navigate to={`/register?invite=${encodeURIComponent(code ?? "")}`} replace />;
}
