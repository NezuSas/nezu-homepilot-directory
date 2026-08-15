import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import type { FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const apps: FastifyInstance[] = [];
const createApp = () => { const app = buildServer({ databasePath: ':memory:', jwtSecret: 'test-secret-with-at-least-thirty-two-characters', serveWeb: false }); apps.push(app); return app; };
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
async function request(app: FastifyInstance, method: HttpMethod, url: string, payload?: unknown, token?: string): Promise<InjectResponse> {
  return app.inject({ method, url, payload: payload === undefined ? undefined : JSON.stringify(payload), headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) } }) as Promise<InjectResponse>;
}
async function account(app: FastifyInstance, email: string, displayName: string) { const created = await request(app, 'POST', '/directory/accounts', { email, displayName, password: 'password123' }); expect(created.statusCode).toBe(201); const session = await request(app, 'POST', '/directory/session', { email, password: 'password123' }); return (session.json() as { token: string; account: { id: string } }); }

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
