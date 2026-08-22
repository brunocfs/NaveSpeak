import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// --- Access token (JWT curto, enviado no header Authorization, NUNCA em localStorage) ---

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  });
}

export function verifyAccessToken(token) {
  // Lança se inválido/expirado - o chamador (middleware) deve tratar.
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

// --- Refresh token (opaco, guardado em cookie httpOnly; só o HASH fica no banco) ---
// Guardar o hash em vez do token em texto puro significa que um vazamento do
// banco de dados sozinho não é suficiente para forjar uma sessão válida.

export function generateRefreshToken() {
  const token = crypto.randomBytes(48).toString('hex');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiryDate() {
  const ttl = env.JWT_REFRESH_TTL; // ex.: "7d"
  const match = /^(\d+)([smhd])$/.exec(ttl);
  const amount = match ? Number(match[1]) : 7;
  const unit = match ? match[2] : 'd';
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return new Date(Date.now() + amount * unitMs);
}
