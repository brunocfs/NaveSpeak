// Discriminador de 5 dígitos que, junto do username, forma o identificador
// público único "username#12345" (ver uq_users_username_discriminator no
// schema). Só sorteia o valor - a checagem de unicidade (e o retry em
// colisão) acontece em db/users.repo.js#createUser, contra o índice único do
// banco.
export function randomDiscriminator() {
  return String(Math.floor(Math.random() * 99999) + 1).padStart(5, '0');
}

// Formata o identificador público exibido ao usuário/no email de convite.
export function formatTag(username, discriminator) {
  return `${username}#${discriminator}`;
}

// Inverso de formatTag: "usuario#12345" -> { username, discriminator }, ou
// null se não bater no formato. Usado no login por tag (auth.routes.js) e em
// pedido de amizade/bloqueio por tag (friends.routes.js) - username sozinho
// deixou de ser um identificador único (ver createUser em db/users.repo.js).
export function parseTag(tag) {
  const match = /^(.{3,32})#(\d{5})$/.exec(tag);
  if (!match) return null;
  return { username: match[1], discriminator: match[2] };
}
