import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
import { buildServer } from '../server.js';
import { SqliteDirectoryDatabase } from '../infrastructure/SqliteDirectoryDatabase.js';
import { DirectoryService } from '../application/DirectoryService.js';

const keys = generateKeyPairSync('ed25519');
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const apps: FastifyInstance[] = [];

function createApp(configured = true) {
  const previous = process.env.DIRECTORY_EDGE_SERVICE_PRIVATE_KEY;
  if (configured) process.env.DIRECTORY_EDGE_SERVICE_PRIVATE_KEY = privateKey;
  else delete process.env.DIRECTORY_EDGE_SERVICE_PRIVATE_KEY;
  try {
    const db = new SqliteDirectoryDatabase(':memory:');
    const app = buildServer({ store: db, jwtSecret: 'test-secret-with-at-least-thirty-two-characters', serveWeb: false });
    apps.push(app);
    return { app, db, service: new DirectoryService(db) };
  } finally {
    if (previous === undefined) delete process.env.DIRECTORY_EDGE_SERVICE_PRIVATE_KEY;
    else process.env.DIRECTORY_EDGE_SERVICE_PRIVATE_KEY = previous;
  }
}

async function pair(db: SqliteDirectoryDatabase, service: DirectoryService) {
  const now = new Date().toISOString();
  const ownerId = randomUUID();
  const homeId = randomUUID();
  await db.createAccount({ id: ownerId, email: `${ownerId}@example.test`, displayName: 'Owner', passwordHash: 'unused', emailVerified: true, createdAt: now });
  await db.createHome({ id: homeId, name: 'Casa', edgeHostname: 'https://edge-unpaired.homepilot.invalid', ownerAccountId: ownerId, createdAt: now, updatedAt: now });
  await db.createMembership({ id: randomUUID(), homeId, accountId: ownerId, role: 'owner', status: 'active', invitedByAccountId: null, invitationTokenHash: null, invitationExpiresAt: null, createdAt: now, updatedAt: now });
  const code = await service.createPairingCode(ownerId, homeId);
  return { ownerId, ...await service.claimPairingCode(code.code, 'https://casa.nezuecuador.com') };
}

function post(app: FastifyInstance, credential?: string, body?: unknown): Promise<InjectResponse> {
  return app.inject({
    method: 'POST', url: '/directory/edge-service-token',
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  }) as Promise<InjectResponse>;
}

afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

describe('Edge Service Token v1', () => {
  it('issues only the exact 120-second claims from an authenticated Edge and signs their encoded bytes', async () => {
    const { app, db, service } = createApp();
    const edge = await pair(db, service);
    const before = Math.floor(Date.now() / 1000);
    const response = await post(app, edge.token);
    const after = Math.floor(Date.now() / 1000);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(Object.keys(response.json())).toEqual(['token', 'expiresIn']);
    const { token, expiresIn } = response.json() as { token: string; expiresIn: number };
    expect(expiresIn).toBe(120);
    const [encoded, signature] = token.split('.');
    expect(token.split('.')).toHaveLength(2);
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['type', 'issuer', 'audience', 'keyId', 'scope', 'directoryHomeId', 'directoryEdgeId', 'iat', 'exp', 'jti']);
    expect(payload).toEqual({
      type: 'homepilot.edge-service-token.v1', issuer: 'homepilot-directory', audience: 'intentflow',
      keyId: 'edge-service-v1', scope: 'homepilot.manifest.read',
      directoryHomeId: edge.homeId, directoryEdgeId: edge.edgeId,
      iat: expect.any(Number), exp: expect.any(Number), jti: expect.any(String),
    });
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after);
    expect(payload.exp).toBe((payload.iat as number) + 120);
    expect(payload.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(verify(null, Buffer.from(encoded), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(verify(null, Buffer.from(encoded), generateKeyPairSync('ed25519').publicKey, Buffer.from(signature, 'base64url'))).toBe(false);
    expect(verify(null, Buffer.from(encoded + 'x'), publicKey, Buffer.from(signature, 'base64url'))).toBe(false);
    const again = await post(app, edge.token);
    const againPayload = JSON.parse(Buffer.from((again.json() as { token: string }).token.split('.')[0], 'base64url').toString()) as { jti: string };
    expect(againPayload.jti).not.toBe(payload.jti);
    expect(response.body).not.toContain(edge.token);
    expect(response.body).not.toContain(privateKey);
    expect(JSON.stringify(payload)).not.toContain(edge.token);
    const audit = await db.listForHome(edge.homeId);
    expect(audit.some(event => event.action === 'edge.service_token.issued' && event.homeId === edge.homeId && event.actorAccountId === `edge:${edge.edgeId}`)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('rejects missing, invalid and revoked Edge credentials', async () => {
    const { app, db, service } = createApp();
    const edge = await pair(db, service);
    for (const credential of [undefined, 'invalid']) {
      const response = await post(app, credential);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'EDGE_CREDENTIAL_INVALID' });
    }
    const nextCode = await service.createPairingCode(edge.ownerId, edge.homeId);
    const replacement = await service.claimPairingCode(nextCode.code, 'https://casa.nezuecuador.com');
    expect((await post(app, edge.token)).statusCode).toBe(401);
    expect((await post(app, replacement.token)).statusCode).toBe(200);
  });

  it('rejects caller-supplied claims or any request body', async () => {
    const { app, db, service } = createApp();
    const edge = await pair(db, service);
    for (const body of [{}, { homeId: edge.homeId }, { edgeId: edge.edgeId }, { scope: 'other' }, { audience: 'other' }]) {
      const response = await post(app, edge.token, body);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'EDGE_SERVICE_TOKEN_BODY_NOT_ALLOWED' });
    }
  });

  it('returns 503 without an issuer and publishes only its public key when configured', async () => {
    const configured = createApp();
    const publicResponse = await configured.app.inject('/directory/edge-service-token/public-key');
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.json()).toEqual({ type: 'homepilot.edge-service-token.v1', algorithm: 'Ed25519', keyId: 'edge-service-v1', publicKey });
    expect(publicResponse.body).not.toContain(privateKey);
    const absent = createApp(false);
    const edge = await pair(absent.db, absent.service);
    const keyResponse = await absent.app.inject('/directory/edge-service-token/public-key');
    expect(keyResponse.statusCode).toBe(503);
    expect(keyResponse.json()).toEqual({ error: 'EDGE_SERVICE_TOKEN_NOT_CONFIGURED' });
    const tokenResponse = await post(absent.app, edge.token);
    expect(tokenResponse.statusCode).toBe(503);
    expect(tokenResponse.json()).toEqual({ error: 'EDGE_SERVICE_TOKEN_NOT_CONFIGURED' });
    expect(tokenResponse.headers['cache-control']).toBe('no-store');
  });

  it('limits each Edge independently to ten emissions per minute', async () => {
    const { app, db, service } = createApp();
    const first = await pair(db, service);
    const second = await pair(db, service);
    for (let count = 0; count < 10; count++) expect((await post(app, first.token)).statusCode).toBe(200);
    expect((await post(app, first.token)).statusCode).toBe(429);
    expect((await post(app, second.token)).statusCode).toBe(200);
  });
});
