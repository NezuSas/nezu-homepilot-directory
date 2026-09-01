import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import { SqliteDirectoryDatabase } from '../infrastructure/SqliteDirectoryDatabase.js';
import type { FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const apps: FastifyInstance[] = [];
const databases = new WeakMap<FastifyInstance, SqliteDirectoryDatabase>();
const createApp = () => { const database = new SqliteDirectoryDatabase(':memory:'); const app = buildServer({ store: database, jwtSecret: 'test-secret-with-at-least-thirty-two-characters', serveWeb: false }); databases.set(app, database); apps.push(app); return app; };
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function request(app: FastifyInstance, method: HttpMethod, url: string, payload?: unknown, token?: string): Promise<InjectResponse> {
  return app.inject({ method, url, payload: payload === undefined ? undefined : JSON.stringify(payload), headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) } }) as Promise<InjectResponse>;
}
async function account(app: FastifyInstance, email: string, displayName: string) { const created = await request(app, 'POST', '/directory/accounts', { email, displayName, password: 'password123' }); expect(created.statusCode).toBe(201); const database = databases.get(app); if (database) database.db.prepare('UPDATE directory_accounts SET email_verified = 1 WHERE email = ?').run(email); const session = await request(app, 'POST', '/directory/session', { email, password: 'password123' }); return (session.json() as { token: string; account: { id: string } }); }

describe('Directory API', () => {
  it('requires DIRECTORY_JWT_SECRET outside explicitly configured tests', () => {
    const previous = process.env.DIRECTORY_JWT_SECRET;
    process.env.DIRECTORY_JWT_SECRET = '';
    expect(() => buildServer({ databasePath: ':memory:', serveWeb: false })).toThrow('DIRECTORY_JWT_SECRET is required');
    if (previous === undefined) delete process.env.DIRECTORY_JWT_SECRET;
    else process.env.DIRECTORY_JWT_SECRET = previous;
  });
  it('rate limits registration and session routes by IP', async () => {
    const app = createApp();
    let response;
    for (let attempt = 0; attempt < 11; attempt += 1) response = await request(app, 'POST', '/directory/session', { email: 'missing@example.com', password: 'password123' });
    expect(response?.statusCode).toBe(429);
  });
  it('AC1 registers a global account and authenticates it', async () => { const app=createApp(); const user=await account(app,'oscar@example.com','Oscar'); expect(user.token).toBeTruthy(); });
  it('AC2 registers a home and lists it for its owner', async () => { const app=createApp(); const owner=await account(app,'owner@example.com','Owner'); const created=await request(app,'POST','/directory/homes',{name:'Casa Oscar',edgeHostname:'https://oscar.example.com'},owner.token); expect(created.statusCode).toBe(201); const homes=await request(app,'GET','/directory/homes',undefined,owner.token); expect(homes.json()).toEqual([{id:created.json().id,name:'Casa Oscar',edgeHostname:'https://oscar.example.com',role:'owner'}]); });
  it('AC2 accepts a new home without exposing or requiring an Edge hostname', async () => { const app=createApp(); const owner=await account(app,'single-domain@example.com','Single Domain'); const created=await request(app,'POST','/directory/homes',{name:'Casa sin URL'},owner.token); expect(created.statusCode).toBe(201); expect(created.json()).toMatchObject({name:'Casa sin URL'}); });
  it('AC3 accepts an invitation idempotently and exposes the shared home', async () => { const app=createApp(); const owner=await account(app,'owner@example.com','Owner'); const member=await account(app,'member@example.com','Member'); const home=(await request(app,'POST','/directory/homes',{name:'Casa',edgeHostname:'https://casa.example.com'},owner.token)).json() as {id:string}; const invitation=(await request(app,'POST',`/directory/homes/${home.id}/invitations`,{email:'member@example.com'},owner.token)).json() as {token:string}; expect((await request(app,'POST',`/directory/invitations/${invitation.token}/accept`,undefined,member.token)).statusCode).toBe(200); expect((await request(app,'POST',`/directory/invitations/${invitation.token}/accept`,undefined,member.token)).statusCode).toBe(200); expect((await request(app,'GET','/directory/homes',undefined,member.token)).json()).toHaveLength(1); });
  it('AC4 isolates homes and prevents a non-member from reading one', async () => { const app=createApp(); const owner=await account(app,'owner@example.com','Owner'); const outsider=await account(app,'other@example.com','Other'); const home=(await request(app,'POST','/directory/homes',{name:'Privada',edgeHostname:'https://private.example.com'},owner.token)).json() as {id:string}; expect((await request(app,'GET',`/directory/homes/${home.id}`,undefined,outsider.token)).statusCode).toBe(403); expect((await request(app,'GET','/directory/homes',undefined,outsider.token)).json()).toEqual([]); });
  it('AC6 revokes access immediately and AC7/AC8 never contact an Edge', async () => { const app=createApp(); const owner=await account(app,'owner@example.com','Owner'); const member=await account(app,'member@example.com','Member'); const home=(await request(app,'POST','/directory/homes',{name:'Casa',edgeHostname:'https://casa.example.com'},owner.token)).json() as {id:string}; const invitation=(await request(app,'POST',`/directory/homes/${home.id}/invitations`,{email:'member@example.com'},owner.token)).json() as {token:string}; await request(app,'POST',`/directory/invitations/${invitation.token}/accept`,undefined,member.token); const fetchSpy=vi.spyOn(globalThis,'fetch'); expect((await request(app,'DELETE',`/directory/homes/${home.id}/memberships/${member.account.id}`,undefined,owner.token)).statusCode).toBe(204); expect((await request(app,'GET','/directory/homes',undefined,member.token)).json()).toEqual([]); expect((await request(app,'DELETE',`/directory/homes/${home.id}`,undefined,owner.token)).statusCode).toBe(204); expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore(); });
  it('AC8 records auditable home and membership changes without Edge data', async () => {
    const app = createApp();
    const owner = await account(app, 'owner@example.com', 'Owner');
    const member = await account(app, 'member@example.com', 'Member');
    const home = (await request(app, 'POST', '/directory/homes', { name: 'Casa', edgeHostname: 'https://casa.example.com' }, owner.token)).json() as { id: string };
    await request(app, 'POST', `/directory/homes/${home.id}/invitations`, { email: 'member@example.com' }, owner.token);
    const audit = (await request(app, 'GET', `/directory/homes/${home.id}/audit`, undefined, owner.token)).json() as Array<{ action: string }>;
    expect(audit.map(event => event.action)).toEqual(expect.arrayContaining(['home.created', 'membership.invited']));
  });  it('rejects an invitation without granting access', async () => { const app=createApp(); const owner=await account(app,'owner@example.com','Owner'); const member=await account(app,'member@example.com','Member'); const home=(await request(app,'POST','/directory/homes',{name:'Casa',edgeHostname:'https://casa.example.com'},owner.token)).json() as {id:string}; const invitation=(await request(app,'POST',`/directory/homes/${home.id}/invitations`,{email:'member@example.com'},owner.token)).json() as {token:string}; expect((await request(app,'POST',`/directory/invitations/${invitation.token}/reject`,undefined,member.token)).statusCode).toBe(200); expect((await request(app,'GET','/directory/homes',undefined,member.token)).json()).toEqual([]); });
});

it('sends verification, invitation and password reset links without exposing reset enumeration', async () => {
  const { InMemoryEmailSender } = await import('../application/EmailSender.js');
  const { SqliteDirectoryDatabase } = await import('../infrastructure/SqliteDirectoryDatabase.js');
  const sender = new InMemoryEmailSender();
  const database = new SqliteDirectoryDatabase(':memory:');
  const app = buildServer({ store: database, jwtSecret: 'test-secret-with-at-least-thirty-two-characters', serveWeb: false, emailSender: sender, publicAppUrl: 'https://directory.example' });
  apps.push(app);
  const user = await account(app, 'reset@example.com', 'Reset');
  expect(sender.sent[0]?.text).toMatch(/^https:\/\/directory\.example\/\?verify=/);
  const verificationToken = new URL(sender.sent[0]!.text).searchParams.get('verify')!;
  expect((await request(app, 'POST', `/directory/accounts/verify-email/${verificationToken}`)).statusCode).toBe(200);
  expect((await request(app, 'POST', `/directory/accounts/verify-email/${verificationToken}`)).statusCode).toBe(400);
  expect((await request(app, 'POST', '/directory/password-reset/request', { email: 'missing@example.com' })).statusCode).toBe(202);
  expect((await request(app, 'POST', '/directory/password-reset/request', { email: 'reset@example.com' })).statusCode).toBe(202);
  const resetToken = new URL(sender.sent.at(-1)!.text).searchParams.get('reset')!;
  expect((await request(app, 'POST', `/directory/password-reset/${resetToken}/confirm`, { password: 'new-password-123' })).statusCode).toBe(200);
  expect((await request(app, 'POST', '/directory/session', { email: 'reset@example.com', password: 'password123' })).statusCode).toBe(401);
  expect((await request(app, 'POST', '/directory/session', { email: 'reset@example.com', password: 'new-password-123' })).statusCode).toBe(200);
  expect((await request(app, 'POST', `/directory/password-reset/${resetToken}/confirm`, { password: 'another-password-123' })).statusCode).toBe(400);
  const home = (await request(app, 'POST', '/directory/homes', { name: 'Casa Reset', edgeHostname: 'https://reset.example.com' }, user.token)).json() as { id: string };
  const invitee = await account(app, 'invitee@example.com', 'Invitee');
  const invitation = (await request(app, 'POST', `/directory/homes/${home.id}/invitations`, { email: 'invitee@example.com' }, user.token)).json() as { token: string };
  expect(sender.sent.at(-1)?.text).toBe(`https://directory.example/?invite=${invitation.token}`);
  expect(invitee.token).toBeTruthy();
});

it('rejects an expired password reset token', async () => {
  const { InMemoryEmailSender } = await import('../application/EmailSender.js');
  const { SqliteDirectoryDatabase } = await import('../infrastructure/SqliteDirectoryDatabase.js');
  const sender = new InMemoryEmailSender();
  const database = new SqliteDirectoryDatabase(':memory:');
  const app = buildServer({ store: database, jwtSecret: 'test-secret-with-at-least-thirty-two-characters', serveWeb: false, emailSender: sender });
  apps.push(app);
  await account(app, 'expired@example.com', 'Expired');
  await request(app, 'POST', '/directory/password-reset/request', { email: 'expired@example.com' });
  const resetToken = new URL(sender.sent.at(-1)!.text).searchParams.get('reset')!;
  database.db.prepare("UPDATE directory_account_tokens SET expires_at = ? WHERE purpose = 'password_reset'").run(new Date(Date.now() - 1000).toISOString());
  const response = await request(app, 'POST', `/directory/password-reset/${resetToken}/confirm`, { password: 'new-password-123' });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: 'TOKEN_EXPIRED' });
});

it('requires email verification only before creating or accepting a home membership', async () => {
  const { InMemoryEmailSender } = await import('../application/EmailSender.js');
  const sender = new InMemoryEmailSender();
  const database = new SqliteDirectoryDatabase(':memory:');
  const app = buildServer({ store: database, jwtSecret: 'test-secret-with-at-least-thirty-two-characters', serveWeb: false, emailSender: sender, publicAppUrl: 'https://directory.example' });
  apps.push(app);
  const ownerRegistration = await request(app, 'POST', '/directory/accounts', { email: 'owner-unverified@example.com', displayName: 'Owner', password: 'password123' });
  expect(ownerRegistration.statusCode).toBe(201);
  const ownerSession = await request(app, 'POST', '/directory/session', { email: 'owner-unverified@example.com', password: 'password123' });
  const ownerToken = (ownerSession.json() as { token: string }).token;
  const blockedHome = await request(app, 'POST', '/directory/homes', { name: 'Casa', edgeHostname: 'https://casa.example.com' }, ownerToken); expect(blockedHome.statusCode).toBe(403); expect(blockedHome.json()).toEqual({ error: 'EMAIL_NOT_VERIFIED' });
  expect((await request(app, 'GET', '/directory/homes', undefined, ownerToken)).statusCode).toBe(200);
  const ownerVerification = new URL(sender.sent[0]!.text).searchParams.get('verify')!;
  expect((await request(app, 'POST', `/directory/accounts/verify-email/${ownerVerification}`)).statusCode).toBe(200);
  const home = (await request(app, 'POST', '/directory/homes', { name: 'Casa', edgeHostname: 'https://casa.example.com' }, ownerToken)).json() as { id: string };
  const memberRegistration = await request(app, 'POST', '/directory/accounts', { email: 'member-unverified@example.com', displayName: 'Member', password: 'password123' });
  expect(memberRegistration.statusCode).toBe(201);
  const memberSession = await request(app, 'POST', '/directory/session', { email: 'member-unverified@example.com', password: 'password123' });
  const memberToken = (memberSession.json() as { token: string }).token;
  const invitation = (await request(app, 'POST', `/directory/homes/${home.id}/invitations`, { email: 'member-unverified@example.com' }, ownerToken)).json() as { token: string };
  const denied = await request(app, 'POST', `/directory/invitations/${invitation.token}/accept`, undefined, memberToken);
  expect(denied.statusCode).toBe(403);
  expect(denied.json()).toEqual({ error: 'EMAIL_NOT_VERIFIED' });
  const memberVerification = new URL(sender.sent[1]!.text).searchParams.get('verify')!;
  expect((await request(app, 'POST', `/directory/accounts/verify-email/${memberVerification}`)).statusCode).toBe(200);
  expect((await request(app, 'POST', `/directory/invitations/${invitation.token}/accept`, undefined, memberToken)).statusCode).toBe(200);
});

it('issues distinct signed 60-second SSO tokens only for active home memberships', async () => {
  const { generateKeyPairSync, verify } = await import('node:crypto');
  const keys = generateKeyPairSync('ed25519');
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const previous = process.env.DIRECTORY_SSO_PRIVATE_KEY;
  process.env.DIRECTORY_SSO_PRIVATE_KEY = privateKey;
  try {
    const database = new SqliteDirectoryDatabase(':memory:');
    const app = buildServer({ store: database, jwtSecret: 'test-secret-with-at-least-thirty-two-characters', serveWeb: false });
    apps.push(app);
    const owner = await account(app, 'sso-owner@example.com', 'Owner');
    database.db.prepare('UPDATE directory_accounts SET email_verified = 1 WHERE email = ?').run('sso-owner@example.com');
    const home = (await request(app, 'POST', '/directory/homes', { name: 'SSO Home', edgeHostname: 'https://sso.example.com' }, owner.token)).json() as { id: string };
    const first = await request(app, 'POST', `/directory/homes/${home.id}/sso-token`, undefined, owner.token);
    const second = await request(app, 'POST', `/directory/homes/${home.id}/sso-token`, undefined, owner.token);
    expect(first.statusCode).toBe(200);
    const [firstPayload, firstSignature] = (first.json() as { token: string }).token.split('.');
    const payload = JSON.parse(Buffer.from(firstPayload, 'base64url').toString()) as { directoryAccountId: string; homeId: string; iat: number; exp: number; jti: string };
    expect(payload.directoryAccountId).toBe(owner.account.id);
    expect(payload.homeId).toBe(home.id);
    expect(payload.exp - payload.iat).toBe(60);
    expect(verify(null, Buffer.from(firstPayload), publicKey, Buffer.from(firstSignature, 'base64url'))).toBe(true);
    const secondPayload = JSON.parse(Buffer.from((second.json() as { token: string }).token.split('.')[0], 'base64url').toString()) as { jti: string };
    expect(secondPayload.jti).not.toBe(payload.jti);
    const outsider = await account(app, 'sso-outsider@example.com', 'Outsider');
    database.db.prepare('UPDATE directory_accounts SET email_verified = 1 WHERE email = ?').run('sso-outsider@example.com');
    expect((await request(app, 'POST', `/directory/homes/${home.id}/sso-token`, undefined, outsider.token)).statusCode).toBe(403);
    const publicKeyResponse = await request(app, 'GET', '/directory/sso/public-key');
    expect(publicKeyResponse.statusCode).toBe(200);
    expect((publicKeyResponse.json() as { publicKey: string }).publicKey).toBe(publicKey);
  } finally {
    if (previous === undefined) delete process.env.DIRECTORY_SSO_PRIVATE_KEY;
    else process.env.DIRECTORY_SSO_PRIVATE_KEY = previous;
  }
});

it('creates a pairing code over HTTP and rejects a reused claim', async () => {
  const app = createApp();
  const owner = await account(app, 'pairing-http@example.com', 'Pairing HTTP');
  const home = (await request(app, 'POST', '/directory/homes', { name: 'Casa pairing' }, owner.token)).json() as { id: string };
  const issued = await request(app, 'POST', `/directory/homes/${home.id}/edge-pairing-code`, {}, owner.token);
  expect(issued.statusCode).toBe(201);
  const code = (issued.json() as { code: string }).code;
  expect((await request(app, 'POST', '/directory/edge-pairing/claim', { code, edgeHostname: 'https://homepilot-pairing.nezuecuador.com' })).statusCode).toBe(201);
  expect((await request(app, 'POST', '/directory/edge-pairing/claim', { code, edgeHostname: 'https://homepilot-pairing.nezuecuador.com' })).statusCode).toBe(400);
});
