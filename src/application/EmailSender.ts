export interface EmailSender { send(message: { to: string; subject: string; text: string }): Promise<void>; }
export class NoopEmailSender implements EmailSender { async send(): Promise<void> {} }
export class InMemoryEmailSender implements EmailSender { readonly sent: Array<{ to: string; subject: string; text: string }> = []; async send(message: { to: string; subject: string; text: string }): Promise<void> { this.sent.push(message); } }
export class SmtpEmailSender implements EmailSender {
  constructor(private readonly transport: { sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> }, private readonly from: string) {}
  async send(message: { to: string; subject: string; text: string }): Promise<void> { await this.transport.sendMail({ ...message, from: this.from }); }
}
