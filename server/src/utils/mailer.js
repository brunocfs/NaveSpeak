// Envio de email para convites (routes/invites.routes.js). Usa SMTP via
// nodemailer quando configurado (SMTP_HOST no .env); sem isso, o convite
// continua criado e o link volta pro admin na resposta da API - só o envio
// automático fica indisponível até o operador configurar SMTP_* (ver
// .env.example). O link e o email NUNCA vão pro log: o link é uma credencial
// de cadastro e o email é dado pessoal.
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger, serializeError } from '../observability/logger.js';

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
    logger.warn({ event: 'invite_email_skipped', reason_code: 'smtp_not_configured' }, 'Invite email not sent: SMTP is not configured');
    return { sent: false, reason: 'SMTP não configurado no servidor.' };
  }

  const startedAt = performance.now();
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
    logger.info({ event: 'invite_email_sent', duration_ms: Math.round(performance.now() - startedAt) }, 'Invite email sent');
    return { sent: true };
  } catch (err) {
    logger.error(
      {
        event: 'invite_email_failed',
        error_code: err?.code === 'ETIMEDOUT' ? 'SMTP_TIMEOUT' : 'SMTP_SEND_FAILED',
        retryable: true,
        duration_ms: Math.round(performance.now() - startedAt),
        error: serializeError(err, { stack: false }),
      },
      'Invite email could not be sent'
    );
    return { sent: false, reason: 'Não foi possível enviar o email (confira as credenciais SMTP).' };
  }
}
