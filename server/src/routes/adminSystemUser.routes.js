import { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { validateBody } from "../middleware/validate.js";
import { systemUserUpdateSchema, avatarUploadSchema } from "../validation/schemas.js";
import { findUserByPublicId, isTagTakenByAnotherUser, updateProfile, updateAvatarPath } from "../db/users.repo.js";
import { decodeImageDataUrl } from "../utils/imageUpload.js";
import { formatTag } from "../utils/discriminator.js";
import { SYSTEM_PUBLIC_ID } from "../config/systemUser.js";

// Mesma pasta/limite de avatar de users.routes.js (POST/DELETE /me/avatar) -
// duplicado de propósito aqui em vez de importado de lá: são rotas de
// "outro usuário" (o Zeno, não req.user), então nunca compartilham o mesmo
// path (/me/...) nem o mesmo req.user - juntar os dois exigiria um parâmetro
// "qual usuário" atravessando a rota inteira só pra usar isto uma vez.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
const AVATAR_DIR = path.join(UPLOADS_DIR, "avatars");
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB, mesmo limite de users.routes.js

function toSystemProfile(user) {
  return {
    id: user.publicId,
    username: user.username,
    tag: formatTag(user.username, user.discriminator),
    bio: user.bio ?? "",
    avatarPath: user.avatarPath,
    avatarUrl: user.avatarPath ? `/uploads/${user.avatarPath}` : null,
    nameStyle: user.nameStyle ?? {},
  };
}

// Painel "Perfil do Zeno" (AdminBroadcastsPage.jsx) - controle total do
// perfil da conta oficial (nome de exibição, bio, foto), sempre atrás de
// requireAdmin. Nenhum usuário comum tem como chegar aqui nem como virar
// is_system=true sozinho.
const router = Router();
router.use(requireAuth, requireAdmin);

async function loadSystemUser(res) {
  const user = await findUserByPublicId(SYSTEM_PUBLIC_ID);
  if (!user) {
    res.status(500).json({ error: "Conta do sistema não encontrada. Rode a migração." });
    return null;
  }
  return user;
}

router.get("/", async (req, res, next) => {
  try {
    const user = await loadSystemUser(res);
    if (!user) return;
    return res.json({ user: toSystemProfile(user) });
  } catch (err) {
    return next(err);
  }
});

router.patch("/", validateBody(systemUserUpdateSchema), async (req, res, next) => {
  try {
    const user = await loadSystemUser(res);
    if (!user) return;

    const { username, bio, nameStyle } = req.body;
    if (username !== undefined) {
      const taken = await isTagTakenByAnotherUser(username, user.discriminator, user.id);
      if (taken) {
        return res.status(409).json({ error: "Esse nome com a tag do Zeno já está em uso - tente outro." });
      }
    }

    const updated = await updateProfile(user.id, { username, bio, nameStyle });
    return res.json({ user: toSystemProfile(updated) });
  } catch (err) {
    return next(err);
  }
});

router.post("/avatar", validateBody(avatarUploadSchema), async (req, res, next) => {
  try {
    const user = await loadSystemUser(res);
    if (!user) return;

    const decoded = decodeImageDataUrl(req.body.image, { maxBytes: MAX_AVATAR_BYTES });
    if (decoded.error) return res.status(400).json({ error: decoded.error });
    const { buffer, ext } = decoded;

    const relativePath = `avatars/${user.publicId}.${ext}`;
    await fs.mkdir(AVATAR_DIR, { recursive: true });
    await fs.writeFile(path.join(UPLOADS_DIR, relativePath), buffer);
    if (user.avatarPath && user.avatarPath !== relativePath) {
      await fs.unlink(path.join(UPLOADS_DIR, user.avatarPath)).catch(() => {});
    }

    const updated = await updateAvatarPath(user.id, relativePath);
    return res.json({ user: toSystemProfile(updated) });
  } catch (err) {
    return next(err);
  }
});

router.delete("/avatar", async (req, res, next) => {
  try {
    const user = await loadSystemUser(res);
    if (!user) return;

    if (user.avatarPath) {
      await fs.unlink(path.join(UPLOADS_DIR, user.avatarPath)).catch(() => {});
    }
    const updated = await updateAvatarPath(user.id, null);
    return res.json({ user: toSystemProfile(updated) });
  } catch (err) {
    return next(err);
  }
});

export default router;
