// Envoi des courriels (invitations, mot de passe oublié).
import nodemailer from 'nodemailer';

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
