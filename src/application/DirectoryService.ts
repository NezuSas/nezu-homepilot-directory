import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { NoopEmailSender, type EmailSender } from './EmailSender.js';
import type { AccountTokenPurpose, DirectoryAccount, DirectoryAccountToken, DirectoryEdgeConnection, DirectoryHome, DirectoryHomeMembership } from '../domain/entities.js';
import { AuthenticationError, ConflictError, ForbiddenError, NotFoundError, ValidationError, clockNow, createHome, createMembership, normalizeEmail, normalizeName, normalizeEdgeHostname } from '../domain/entities.js';

export interface DirectoryStore {
  createAccount(account: DirectoryAccount): Promise<void>; findAccountByEmail(email: string): Promise<DirectoryAccount | null>; findAccountById(id: string): Promise<DirectoryAccount | null>;
  createHome(home: DirectoryHome): Promise<void>; findHomeById(id: string): Promise<DirectoryHome | null>; updateHome(home: DirectoryHome): Promise<void>; deleteById(id: string): Promise<void>;
  createMembership(membership: DirectoryHomeMembership): Promise<void>; findByHomeAndAccount(homeId: string, accountId: string): Promise<DirectoryHomeMembership | null>; findByInvitationTokenHash(hash: string): Promise<DirectoryHomeMembership | null>; listByHome(homeId: string): Promise<DirectoryHomeMembership[]>; listActiveHomesForAccount(accountId: string): Promise<Array<{ home: DirectoryHome; membership: DirectoryHomeMembership }>>; updateMembership(membership: DirectoryHomeMembership): Promise<void>;
  createAccountToken(token: DirectoryAccountToken): Promise<void>; findAccountTokenByHash(hash: string): Promise<DirectoryAccountToken | null>; consumeAccountToken(id: string, now: string): Promise<boolean>; updateAccount(account: DirectoryAccount): Promise<void>;
  append(event: { id: string; actorAccountId: string; homeId: string | null; membershipId: string | null; action: string; createdAt: string }): Promise<void>; listForHome(homeId: string): Promise<Array<{ id: string; actorAccountId: string; homeId: string | null; membershipId: string | null; action: string; createdAt: string }> >;
  createEdgeConnection(connection: DirectoryEdgeConnection): Promise<void>; findActiveByHomeId(homeId: string): Promise<DirectoryEdgeConnection | null>; findActiveByEdgeId(edgeId: string): Promise<DirectoryEdgeConnection | null>; revoke(id: string, revokedAt: string): Promise<boolean>;
}

export class DirectoryService {
  constructor(private readonly store: DirectoryStore, private readonly invitationTtlMs = 7 * 24 * 60 * 60 * 1000, private readonly emailSender: EmailSender = new NoopEmailSender(), private readonly publicAppUrl = 'http://localhost:3100') {}
  async registerAccount(input: { email: string; displayName: string; password: string }): Promise<DirectoryAccount> {
    const email = normalizeEmail(input.email); const displayName = normalizeName(input.displayName, 'DISPLAY_NAME_INVALID');
    if (input.password.length < 8) throw new ValidationError('PASSWORD_TOO_SHORT');
    if (await this.store.findAccountByEmail(email)) throw new ConflictError('EMAIL_ALREADY_REGISTERED');
    const account: DirectoryAccount = { id: randomUUID(), email, displayName, passwordHash: await bcrypt.hash(input.password, 12), emailVerified: false, createdAt: clockNow() };
    await this.store.createAccount(account); await this.sendToken(account, 'email_verify', 60 * 60 * 1000); return account;
  }
  async authenticate(input: { email: string; password: string }): Promise<DirectoryAccount> {
    const account = await this.store.findAccountByEmail(normalizeEmail(input.email));
    if (!account || !await bcrypt.compare(input.password, account.passwordHash)) throw new AuthenticationError('INVALID_CREDENTIALS');
    return account;
  }
  async requestPasswordReset(emailInput: string): Promise<void> { const account = await this.store.findAccountByEmail(normalizeEmail(emailInput)); if (account) await this.sendToken(account, 'password_reset', 60 * 60 * 1000); }
  async confirmPasswordReset(token: string, password: string): Promise<void> { if (password.length < 8) throw new ValidationError('PASSWORD_TOO_SHORT'); const value = await this.validToken(token, 'password_reset'); const account = await this.requireAccountValue(value.accountId); const consumed = await this.store.consumeAccountToken(value.id, clockNow()); if (!consumed) throw new ValidationError('TOKEN_ALREADY_USED'); await this.store.updateAccount({ ...account, passwordHash: await bcrypt.hash(password, 12) }); }
  async verifyEmail(token: string): Promise<void> { const value = await this.validToken(token, 'email_verify'); const account = await this.requireAccountValue(value.accountId); const consumed = await this.store.consumeAccountToken(value.id, clockNow()); if (!consumed) throw new ValidationError('TOKEN_ALREADY_USED'); await this.store.updateAccount({ ...account, emailVerified: true }); }  async registerHome(actorId: string, input: { name: string; edgeHostname?: string }): Promise<DirectoryHome> {
    const account = await this.requireAccountValue(actorId); if (!account.emailVerified) throw new ForbiddenError("EMAIL_NOT_VERIFIED"); const home = createHome(input.name, input.edgeHostname, actorId); const owner = createMembership({homeId:home.id,accountId:actorId,invitedByAccountId:null,role:"owner"});
    await this.store.createHome(home); await this.store.createMembership(owner); await this.audit(actorId, home.id, owner.id, 'home.created'); return home;
  }
  async listHomes(accountId: string): Promise<Array<{ id: string; name: string; edgeHostname: string; role: 'owner'|'member' }>> {
    await this.requireAccount(accountId); return (await this.store.listActiveHomesForAccount(accountId)).map(({home,membership}) => ({id:home.id,name:home.name,edgeHostname:home.edgeHostname,role:membership.role}));
  }
  async getHome(accountId: string, homeId: string): Promise<DirectoryHome> { await this.requireActiveMembership(accountId, homeId); const home=await this.store.findHomeById(homeId); if (!home) throw new NotFoundError('HOME_NOT_FOUND'); return home; }
  async updateHome(actorId: string, homeId: string, input: { name?: string; edgeHostname?: string }): Promise<DirectoryHome> {
    const home=await this.requireOwner(actorId,homeId); const next={...home,name:input.name===undefined?home.name:normalizeName(input.name,'HOME_NAME_INVALID'),edgeHostname:input.edgeHostname===undefined?home.edgeHostname:normalizeEdgeHostname(input.edgeHostname),updatedAt:clockNow()};
    await this.store.updateHome(next); await this.audit(actorId,homeId,null,'home.updated'); return next;
  }
  async deleteHome(actorId: string, homeId: string): Promise<void> { await this.requireOwner(actorId,homeId); await this.store.deleteById(homeId); await this.audit(actorId,homeId,null,'home.deleted'); }
  async invite(actorId: string, homeId: string, inviteeEmail: string): Promise<{ token: string; expiresAt: string }> {
    await this.requireOwner(actorId,homeId); const account=await this.store.findAccountByEmail(normalizeEmail(inviteeEmail)); if (!account) throw new NotFoundError('INVITEE_NOT_FOUND');
    const existing=await this.store.findByHomeAndAccount(homeId,account.id); if (existing?.status==='active') throw new ConflictError('MEMBERSHIP_ALREADY_ACTIVE');
    const token=randomBytes(32).toString('base64url'); const expiresAt=new Date(Date.now()+this.invitationTtlMs).toISOString(); const hash=hashInvitation(token); const now=clockNow();
    const membership=existing ? {...existing,role:'member' as const,status:'pending' as const,invitedByAccountId:actorId,invitationTokenHash:hash,invitationExpiresAt:expiresAt,updatedAt:now} : createMembership({homeId,accountId:account.id,invitedByAccountId:actorId,role:'member',invitationTokenHash:hash,invitationExpiresAt:expiresAt},now);
    if (existing) await this.store.updateMembership(membership); else await this.store.createMembership(membership); await this.audit(actorId, homeId, membership.id, "membership.invited"); try { await this.emailSender.send({ to: account.email, subject: "Invitacion a una casa HomePilot", text: this.publicAppUrl + "/?invite=" + encodeURIComponent(token) }); } catch { } return { token, expiresAt };
  }
  async acceptInvitation(accountId: string, token: string): Promise<DirectoryHomeMembership> {
    const member=await this.store.findByInvitationTokenHash(hashInvitation(token)); if(!member) throw new NotFoundError('INVITATION_NOT_FOUND'); if(member.accountId!==accountId) throw new ForbiddenError('INVITATION_NOT_FOR_ACCOUNT');
    if(member.status==="active") return member; const account = await this.requireAccountValue(accountId); if (!account.emailVerified) throw new ForbiddenError("EMAIL_NOT_VERIFIED"); if(member.status!=="pending" || !member.invitationExpiresAt || Date.parse(member.invitationExpiresAt)<=Date.now()) throw new ValidationError("INVITATION_EXPIRED");
    const accepted={...member,status:'active' as const,updatedAt:clockNow()}; await this.store.updateMembership(accepted); await this.audit(accountId,member.homeId,member.id,'membership.accepted'); return accepted;
  }
  async rejectInvitation(accountId: string, token: string): Promise<DirectoryHomeMembership> {
    const membership = await this.store.findByInvitationTokenHash(hashInvitation(token));
    if (!membership) throw new NotFoundError('INVITATION_NOT_FOUND');
    if (membership.accountId !== accountId) throw new ForbiddenError('INVITATION_NOT_FOR_ACCOUNT');
    if (membership.status === 'revoked') return membership;
    if (membership.status !== 'pending') throw new ConflictError('INVITATION_NOT_PENDING');
    const rejected = {...membership, status: 'revoked' as const, updatedAt: clockNow()};
    await this.store.updateMembership(rejected);
    await this.audit(accountId, membership.homeId, membership.id, 'membership.rejected');
    return rejected;
  }
  async revokeMembership(actorId: string, homeId: string, accountId: string): Promise<void> { await this.requireOwner(actorId,homeId); const membership=await this.store.findByHomeAndAccount(homeId,accountId); if(!membership) throw new NotFoundError('MEMBERSHIP_NOT_FOUND'); if(membership.role==='owner') throw new ForbiddenError('OWNER_MEMBERSHIP_CANNOT_BE_REVOKED'); if(membership.status==='revoked') return; await this.store.updateMembership({...membership,status:'revoked',updatedAt:clockNow()}); await this.audit(actorId,homeId,membership.id,'membership.revoked'); }
  async listMembers(actorId: string, homeId: string): Promise<Array<{ accountId:string; email:string; displayName:string; role:string; status:string }>> { await this.requireOwner(actorId,homeId); const members=await this.store.listByHome(homeId); return Promise.all(members.map(async member=>{const account=await this.store.findAccountById(member.accountId); if(!account) throw new NotFoundError('ACCOUNT_NOT_FOUND'); return {accountId:account.id,email:account.email,displayName:account.displayName,role:member.role,status:member.status};})); }
  async listAudit(actorId:string,homeId:string) { await this.requireOwner(actorId,homeId); return this.store.listForHome(homeId); }
  async provisionEdge(actorId: string, homeId: string): Promise<{ homeId: string; edgeId: string; token: string }> {
    await this.requireOwner(actorId, homeId);
    const previous = await this.store.findActiveByHomeId(homeId);
    if (previous) await this.store.revoke(previous.id, clockNow());
    const edgeId = randomUUID();
    const token = `${edgeId}.${randomBytes(32).toString('base64url')}`;
    await this.store.createEdgeConnection({ id: randomUUID(), homeId, edgeId, credentialHash: hashEdgeCredential(token), createdAt: clockNow(), revokedAt: null });
    await this.audit(actorId, homeId, null, 'edge.connection.provisioned');
    return { homeId, edgeId, token };
  }
  async authenticateEdgeCredential(token: string): Promise<{ homeId: string; edgeId: string } | null> {
    const edgeId = token.split('.', 1)[0];
    if (!edgeId) return null;
    const connection = await this.store.findActiveByEdgeId(edgeId);
    if (!connection || !safeCredentialMatch(connection.credentialHash, token)) return null;
    return { homeId: connection.homeId, edgeId: connection.edgeId };
  }
  private async sendToken(account: DirectoryAccount, purpose: AccountTokenPurpose, ttlMs: number): Promise<void> { const token = randomBytes(32).toString("base64url"); const entity: DirectoryAccountToken = { id: randomUUID(), accountId: account.id, purpose, tokenHash: hashInvitation(token), expiresAt: new Date(Date.now() + ttlMs).toISOString(), usedAt: null, createdAt: clockNow() }; await this.store.createAccountToken(entity); const parameter = purpose === "email_verify" ? "verify" : "reset"; const subject = purpose === "email_verify" ? "Verifica tu correo de HomePilot" : "Restablece tu contrasena de HomePilot"; try { await this.emailSender.send({ to: account.email, subject, text: this.publicAppUrl + "/?" + parameter + "=" + encodeURIComponent(token) }); } catch { } }
  private async validToken(token: string, purpose: AccountTokenPurpose): Promise<DirectoryAccountToken> { const value = await this.store.findAccountTokenByHash(hashInvitation(token)); if (!value || value.purpose !== purpose) throw new NotFoundError('TOKEN_NOT_FOUND'); if (value.usedAt) throw new ValidationError('TOKEN_ALREADY_USED'); if (Date.parse(value.expiresAt) <= Date.now()) throw new ValidationError('TOKEN_EXPIRED'); return value; }
  private async requireAccountValue(id: string): Promise<DirectoryAccount> { const account = await this.store.findAccountById(id); if (!account) throw new NotFoundError('ACCOUNT_NOT_FOUND'); return account; }  private async requireAccount(id:string):Promise<void>{if(!await this.store.findAccountById(id)) throw new AuthenticationError('ACCOUNT_NOT_FOUND');}
  private async requireActiveMembership(accountId:string,homeId:string):Promise<DirectoryHomeMembership>{const membership=await this.store.findByHomeAndAccount(homeId,accountId);if(!membership||membership.status!=='active')throw new ForbiddenError('HOME_ACCESS_FORBIDDEN');return membership;}
  private async requireOwner(accountId:string,homeId:string):Promise<DirectoryHome>{const membership=await this.requireActiveMembership(accountId,homeId);if(membership.role!=='owner')throw new ForbiddenError('OWNER_REQUIRED');const home=await this.store.findHomeById(homeId);if(!home)throw new NotFoundError('HOME_NOT_FOUND');return home;}
  private async audit(actorAccountId:string,homeId:string,membershipId:string|null,action:string):Promise<void>{await this.store.append({id:randomUUID(),actorAccountId,homeId,membershipId,action,createdAt:clockNow()});}
}
export const hashInvitation=(token:string):string=>createHash('sha256').update(token).digest('hex');

export const hashEdgeCredential=(token:string):string=>createHash('sha256').update(token).digest('hex');
function safeCredentialMatch(expectedHash:string, token:string):boolean { const expected=Buffer.from(expectedHash,'hex'); const actual=Buffer.from(hashEdgeCredential(token),'hex'); return expected.length===actual.length && timingSafeEqual(expected,actual); }
