import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { serviceUnavailable } from './errors.js';

let transport: Transporter | null = null;

export function isMailConfigured(): boolean {
  return config.smtp.host.length > 0;
}

/** Built on first use so a server without SMTP never pays for a connection pool. */
function getTransport(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transport;
}

export interface PasswordResetMail {
  to: string;
  name: string;
  resetUrl: string;
  expiresMinutes: number;
}

export async function sendPasswordResetEmail(mail: PasswordResetMail): Promise<void> {
  if (!isMailConfigured()) {
    throw serviceUnavailable(
      'Password reset email is not configured on this server yet. Set SMTP_HOST in server/.env.',
    );
  }

  const minutes = mail.expiresMinutes;
  const expiry = `${minutes} minutes`;

  const text = [
    `Hi ${mail.name},`,
    '',
    'Someone asked to reset the password for your account in Our Little Space.',
    '',
    `Open this link to choose a new one: ${mail.resetUrl}`,
    '',
    `The link works once and expires in ${expiry}.`,
    '',
    'If this was not you, you can ignore this email — nothing has changed.',
  ].join('\n');

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:32rem;margin:0 auto;padding:2rem 1.25rem;color:#2f2723">
      <p style="font-size:1.125rem;margin:0 0 .25rem">❤️</p>
      <h1 style="font-size:1.25rem;margin:0 0 1rem;font-weight:600">Reset your password</h1>
      <p style="font-size:.9375rem;line-height:1.6;margin:0 0 1.5rem">
        Hi ${escapeHtml(mail.name)}, someone asked to reset the password for your account in Our Little Space.
      </p>
      <p style="margin:0 0 1.5rem">
        <a href="${escapeHtml(mail.resetUrl)}"
           style="display:inline-block;background:#c86e5d;color:#ffffff;text-decoration:none;padding:.75rem 1.5rem;border-radius:9999px;font-size:.9375rem">
          Choose a new password
        </a>
      </p>
      <p style="font-size:.8125rem;line-height:1.6;color:#7c6f66;margin:0 0 .5rem">
        Or paste this into your browser:<br/>
        <span style="word-break:break-all">${escapeHtml(mail.resetUrl)}</span>
      </p>
      <p style="font-size:.8125rem;line-height:1.6;color:#7c6f66;margin:0 0 .5rem">
        The link works once and expires in ${expiry}.
      </p>
      <p style="font-size:.8125rem;line-height:1.6;color:#7c6f66;margin:0">
        If this was not you, you can ignore this email — nothing has changed.
      </p>
    </div>
  `;

  try {
    await getTransport().sendMail({
      from: config.smtp.from,
      to: mail.to,
      subject: 'Reset your password — Our Little Space',
      text,
      html,
    });
  } catch (error) {
    // The SMTP reason is worth seeing in the logs, but never in the response.
    console.error('[mailer] password reset email failed:', error);
    throw serviceUnavailable('We could not send the reset email right now. Please try again in a moment.');
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
