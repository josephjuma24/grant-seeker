import nodemailer, { type Transporter } from 'nodemailer';

import { env, isProduction } from '../config/env.ts';

// Outgoing email. With SMTP_URL set, mail goes out over SMTP. Without it,
// development prints each message (links included) to the API log so the
// flows can be used locally; production refuses to log message bodies,
// since they carry one-time links that work like passwords.

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type MailOutcome = 'sent' | 'logged' | 'dropped';

let transport: Transporter | null | undefined;
function getTransport(): Transporter | null {
  if (transport === undefined) transport = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : null;
  return transport;
}

/** Tests only: route mail to a stub transport (null restores the env setting). */
export function setMailTransportForTests(t: Transporter | null | undefined) {
  transport = t;
}

export async function sendMail(mail: Mail): Promise<MailOutcome> {
  const t = getTransport();
  if (t) {
    await t.sendMail({ from: env.MAIL_FROM, ...mail });
    return 'sent';
  }
  if (!isProduction) {
    console.log(
      ['', '──── email (dev: SMTP_URL not set, so it is printed here instead of sent) ────',
        `To: ${mail.to}`, `Subject: ${mail.subject}`, '', mail.text, '─'.repeat(78), ''].join('\n'),
    );
    return 'logged';
  }
  console.error(`[mail] SMTP_URL is not set; an email to ${mail.to.replace(/^(.).*(@.*)$/, '$1…$2')} ("${mail.subject}") was not sent`);
  return 'dropped';
}

/** Text that is safe inside HTML. */
export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
