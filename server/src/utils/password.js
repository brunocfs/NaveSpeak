import bcrypt from 'bcrypt';

// Custo 12: equilíbrio recomendado entre segurança e latência de login em 2026.
const SALT_ROUNDS = 12;

export function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}
