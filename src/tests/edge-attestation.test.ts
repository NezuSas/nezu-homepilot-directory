import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomBytes, randomUUID, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
import { buildServer } from '../server.js';
import { SqliteDirectoryDatabase } from '../infrastructure/SqliteDirectoryDatabase.js';
import { DirectoryService } from '../application/DirectoryService.js';
import { hashEdgeCredential } from '../application/DirectoryService.js';

const keys = generateKeyPairSync('ed25519');
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const apps: FastifyInstance[] = [];
const challenge = () => ({ installationId: randomUUID(), challengeId: randomUUID(), nonce: randomBytes(32).toString('base64url') });

function createApp(configured = true) {
  const prior = process.env.DIRECTORY_EDGE_ATTESTATION_PRIVATE_KEY;
  if (configured) process.env.DIRECTORY_EDGE_ATTESTATION_PRIVATE_KEY = privateKey;
  else delete process.env.DIRECTORY_EDGE_ATTESTATION_PRIVATE_KEY;
  try {
    const db = new SqliteDirectoryDatabase(':memory:');
    const app = buildServer({ store: db, jwtSecret: 'test-secret-with-at-least-thirty-two-characters', serveWeb: false });
    apps.push(app);
    return { app, db, service: new DirectoryService(db) };
  } finally {
    if (prior === undefined) delete process.env.DIRECTORY_EDGE_ATTESTATION_PRIVATE_KEY;
    else process.env.DIRECTORY_EDGE_ATTESTATION_PRIVATE_KEY = prior;
  }
}

async function paired(db: SqliteDirectoryDatabase, service: DirectoryService) {
  const now = new Date().toISOString();
  const owner = randomUUID();
  const homeId = randomUUID();
  await db.createAccount({ id: owner, email: `${owner}@example.test`, displayName: 'Owner', passwordHash: 'unused', emailVerified: true, createdAt: now });
  await db.createHome({ id: homeId, name: 'Casa', edgeHostname: 'https://edge-unpaired.homepilot.invalid', ownerAccountId: owner, createdAt: now, updatedAt: now });
  await db.createMembership({ id: randomUUID(), homeId, accountId: owner, role: 'owner', status: 'active', invitedByAccountId: null, invitationTokenHash: null, invitationExpiresAt: null, createdAt: now, updatedAt: now });
  const code = await service.createPairingCode(owner, homeId);
  const edge = await service.claimPairingCode(code.code, 'https://casa.nezuecuador.com');
  return { owner, ...edge };
}

function post(app: FastifyInstance, body: unknown, token?: string): Promise<InjectResponse> {
  return app.inject({ method: 'POST', url: '/directory/edge-attestation', payload: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } }) as Promise<InjectResponse>;
}

afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

describe('Edge Attestation v1', () => {
  it('signs the exact challenge and credential-derived identity with a distinct Ed25519 key', async () => {
    const { app, db, service } = createApp();
    const edge = await paired(db, service);
    const input = challenge();
    const before = Math.floor(Date.now() / 1000);
    const response = await post(app, input, edge.token);
    const after = Math.floor(Date.now() / 1000);
    expect(response.statusCode).toBe(200);
    const { attestation, expiresIn } = response.json() as { attestation: string; expiresIn: number };
    expect(expiresIn).toBe(90);
    const [encoded, signature] = attestation.split('.');
    expect(attestation.split('.')).toHaveLength(2);
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as Record<string, unknown>;
    expect(payload).toEqual({ type: 'homepilot.edge-attestation.v1', issuer: 'homepilot-directory', audience: 'intentflow', keyId: 'edge-attestation-v1', ...input, directoryHomeId: edge.homeId, directoryEdgeId: edge.edgeId, iat: expect.any(Number), exp: expect.any(Number), jti: expect.any(String) });
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after);
    expect(payload.exp).toBe((payload.iat as number) + 90);
    expect(payload.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(verify(null, Buffer.from(encoded), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(verify(null, Buffer.from(encoded), generateKeyPairSync('ed25519').publicKey, Buffer.from(signature, 'base64url'))).toBe(false);
    expect(verify(null, Buffer.from(encoded + 'x'), publicKey, Buffer.from(signature, 'base64url'))).toBe(false);
    const audit = await db.listForHome(edge.homeId);
    expect(audit.some(event => event.action === 'edge.attestation.issued' && event.homeId === edge.homeId)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(input.nonce);
  });

  it('rejects absent, invalid and revoked credentials, then accepts the replacement Edge', async () => {
    const { app, db, service } = createApp();
    const first = await paired(db, service);
    expect((await post(app, challenge())).statusCode).toBe(401);
    expect((await post(app, challenge(), 'invalid')).statusCode).toBe(401);
    const code = await service.createPairingCode(first.owner, first.homeId);
    const second = await service.claimPairingCode(code.code, 'https://casa.nezuecuador.com');
    expect((await post(app, challenge(), first.token)).statusCode).toBe(401);
    expect((await post(app, challenge(), second.token)).statusCode).toBe(200);
    const rows = db.db.prepare('SELECT revoked_at FROM directory_edge_connections WHERE home_id = ?').all(first.homeId) as Array<{ revoked_at: string | null }>;
    expect(rows).toHaveLength(2);
    expect(rows.filter(row => row.revoked_at === null)).toHaveLength(1);
  });

  it('rejects malformed and caller-supplied identity fields', async () => {
    const { app, db, service } = createApp();
    const edge = await paired(db, service);
    const invalid = [
      { ...challenge(), installationId: 'no' }, { ...challenge(), challengeId: 'no' },
      ...['', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '=', 'a'.repeat(42) + ' ', 'a'.repeat(42) + '+', 'A'.repeat(42) + 'B'].map(nonce => ({ ...challenge(), nonce })),
      { ...challenge(), homeId: edge.homeId }, { ...challenge(), edgeId: edge.edgeId },
      { ...challenge(), directoryHomeId: edge.homeId }, { ...challenge(), issuer: 'attacker' },
    ];
    for (const body of invalid) expect((await post(app, body, edge.token)).statusCode).toBe(400);
  });

  it('publishes the public key and returns 503 when attestation is unconfigured', async () => {
    const configured = createApp();
    const key = await configured.app.inject('/directory/edge-attestation/public-key');
    expect(key.json()).toEqual({ type: 'homepilot.edge-attestation.v1', algorithm: 'Ed25519', keyId: 'edge-attestation-v1', publicKey });
    const absent = createApp(false);
    const edge = await paired(absent.db, absent.service);
    expect((await absent.app.inject('/directory/edge-attestation/public-key')).json()).toEqual({ error: 'EDGE_ATTESTATION_NOT_CONFIGURED' });
    const response = await post(absent.app, challenge(), edge.token);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'EDGE_ATTESTATION_NOT_CONFIGURED' });
  });

  it('limits emission to ten attestations per Edge per minute', async () => {
    const { app, db, service } = createApp();
    const edge = await paired(db, service);
    for (let i = 0; i < 10; i++) expect((await post(app, challenge(), edge.token)).statusCode).toBe(200);
    expect((await post(app, challenge(), edge.token)).statusCode).toBe(429);
  });

  it('enforces one active Edge while retaining revoked history and rejects duplicate migration data', async () => {
    const location = mkdtempSync(join(tmpdir(), 'edge-attestation-'));
    const path = join(location, 'directory.db');
    try {
      const db = new SqliteDirectoryDatabase(path);
      const service = new DirectoryService(db);
      const edge = await paired(db, service);
      const now = new Date().toISOString();
      await expect(db.createEdgeConnection({ id: randomUUID(), homeId: edge.homeId, edgeId: randomUUID(), credentialHash: hashEdgeCredential('another'), createdAt: now, revokedAt: null })).rejects.toThrow();
      await db.createEdgeConnection({ id: randomUUID(), homeId: edge.homeId, edgeId: randomUUID(), credentialHash: hashEdgeCredential('historic'), createdAt: now, revokedAt: now });
      db.db.exec('DROP INDEX ux_edge_connections_active_home');
      await db.createEdgeConnection({ id: randomUUID(), homeId: edge.homeId, edgeId: randomUUID(), credentialHash: hashEdgeCredential('duplicate'), createdAt: now, revokedAt: null });
      await db.close();
      expect(() => new SqliteDirectoryDatabase(path)).toThrow(`Multiple active Edges for home ${edge.homeId}`);
    } finally { rmSync(location, { recursive: true, force: true }); }
  });
});
