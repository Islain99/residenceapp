// Envoi des courriels (invitations, mot de passe oublié).
//
// Trois façons, choisies par la configuration (mailerFromConfig) :
//   * RESEND_API_KEY : API HTTPS de Resend ;
//   * BREVO_API_KEY  : API HTTPS de Brevo ;
//   * sinon SMTP_URL (développement : Mailpit).
// Les API HTTPS fonctionnent partout ; Railway bloque le SMTP sortant sauf
// sur le plan Pro.
import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

// SMTP (production : fournisseur de courriel ; développement : Mailpit)
export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return {
    async send(mail) {
      await transport.sendMail({ from, ...mail });
    },
  };
}

// « Journal de bord <no-reply@exemple.ca> » → nom et adresse
export function parseFrom(from: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!match) return { email: from.trim() };
  return match[1] ? { name: match[1].replace(/^"|"$/g, ''), email: match[2]!.trim() } : { email: match[2]!.trim() };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Envoi refusé par le fournisseur (${res.status}) : ${detail}`);
  }
}

// Resend : https://resend.com/docs/api-reference/emails/send-email
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(mail) {
      await postJson('https://api.resend.com/emails', { authorization: `Bearer ${apiKey}` },
        { from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html });
    },
  };
}

// Brevo : https://developers.brevo.com/reference/sendtransacemail
export function brevoMailer(apiKey: string, from: string): Mailer {
  const sender = parseFrom(from);
  return {
    async send(mail) {
      await postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': apiKey },
        { sender, to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text, htmlContent: mail.html });
    },
  };
}

export function mailerFromConfig(config: Config): Mailer {
  if (config.RESEND_API_KEY) return resendMailer(config.RESEND_API_KEY, config.MAIL_FROM);
  if (config.BREVO_API_KEY) return brevoMailer(config.BREVO_API_KEY, config.MAIL_FROM);
  return smtpMailer(config.SMTP_URL, config.MAIL_FROM);
}

export const mailerKind = (config: Config) =>
  config.RESEND_API_KEY ? 'resend' : config.BREVO_API_KEY ? 'brevo' : 'smtp';

// Tests : courriels gardés en mémoire
export class MemoryMailer implements Mailer {
  readonly outbox: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.outbox.push(mail);
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Courriel simple : paragraphes + un bouton vers un lien
export function linkMail(to: string, subject: string, paragraphs: string[], link: { label: string; url: string }, footer: string): Mail {
  const text = [...paragraphs, '', `${link.label} : ${link.url}`, '', footer].join('\n');
  const html = `<!doctype html><html lang="fr"><body style="font-family:system-ui,sans-serif;color:#17201f;line-height:1.5">
${paragraphs.map((p) => `<p>${escape(p)}</p>`).join('\n')}
<p><a href="${escape(link.url)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escape(link.label)}</a></p>
<p style="font-size:13px;color:#5b6766">Si le bouton ne fonctionne pas, copier ce lien : ${escape(link.url)}</p>
<p style="font-size:13px;color:#5b6766">${escape(footer)}</p>
</body></html>`;
  return { to, subject, text, html };
}
