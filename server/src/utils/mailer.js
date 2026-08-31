// Envio de email para convites (routes/invites.routes.js). Usa SMTP via
// nodemailer quando configurado (SMTP_HOST no .env); sem isso, cai em
// fallback (loga o link no console) em vez de falhar - o convite continua
// criado e válido pelo link, só o envio automático fica indisponível até o
// operador configurar SMTP_* (ver .env.example).
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;

function getTransporter() {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

// Nunca lança - quem chama (invites.routes.js) trata `sent: false` como "o
// convite foi criado, mas o email não foi enviado" e devolve o link mesmo
// assim, nunca derruba a criação do convite por causa de um SMTP fora do ar.
export async function sendInviteEmail({ to, inviteLink, invitedBy }) {
  const client = getTransporter();
  if (!client) {
    console.log(`[convite] SMTP não configurado - link para ${to}: ${inviteLink}`);
    return { sent: false, reason: 'SMTP não configurado no servidor.' };
  }

  try {
    await client.sendMail({
      from: env.SMTP_FROM || env.SMTP_USER,
      to,
      subject: 'Convite para o NaveSpeak',
      text:
        `${invitedBy} te convidou para o NaveSpeak.\n\n` +
        `Cadastre-se pelo link: ${inviteLink}\n\n` +
        `Se você não esperava este convite, pode ignorar este email.`,
      html:
        `<p>${invitedBy} te convidou para o <strong>NaveSpeak</strong>.</p>` +
        `<p><a href="${inviteLink}">Clique aqui para se cadastrar</a></p>` +
        `<p style="color:#888;font-size:12px">Se você não esperava este convite, pode ignorar este email.</p>`,
    });
    return { sent: true };
  } catch (err) {
    console.error('Falha ao enviar email de convite:', err.message);
    return { sent: false, reason: 'Não foi possível enviar o email (confira as credenciais SMTP).' };
  }
}
