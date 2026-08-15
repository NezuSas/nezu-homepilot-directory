import nodemailer from 'nodemailer';
import { SmtpEmailSender, type EmailSender, NoopEmailSender } from '../application/EmailSender.js';
export function createEmailSenderFromEnvironment(): EmailSender {
  const host = process.env.SMTP_HOST; const port = process.env.SMTP_PORT; const user = process.env.SMTP_USER; const password = process.env.SMTP_PASSWORD; const from = process.env.SMTP_FROM;
  if (!host && !port && !user && !password && !from) return new NoopEmailSender();
  if (!host || !port || !from) throw new Error('SMTP_HOST, SMTP_PORT and SMTP_FROM are required when SMTP is configured.');
  return new SmtpEmailSender(nodemailer.createTransport({ host, port: Number(port), secure: Number(port) === 465, auth: user ? { user, pass: password } : undefined }), from);
}
