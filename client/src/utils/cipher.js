const CIPHER_GLYPHS = "!@#$%&01¥ΞΨΩ§<>{}[]?";

export function randomGlyph() {
  return CIPHER_GLYPHS[Math.floor(Math.random() * CIPHER_GLYPHS.length)];
}

// Texto "criptografado" (glifos aleatórios) - botão-mistério do DmSidebar e CipherPanel.
export function randomCipher(length) {
  return Array.from({ length }, randomGlyph).join("");
}
