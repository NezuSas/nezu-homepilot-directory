import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { DirectoryService } from '../application/DirectoryService.js';
import { canonicalDeviceProofPayload } from '../application/EdgeDeviceBinding.js';
import { SqliteDirectoryDatabase } from '../infrastructure/SqliteDirectoryDatabase.js';

const issuerKeys = generateKeyPairSync('ed25519');
const issuerPrivate = issuerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const apps: FastifyInstance[] = [];

function setup() {
  const previous = process.env.DIRECTORY_EDGE_SERVICE_PRIVATE_KEY;
  process.env.DIRECTORY_EDGE_SERVICE_PRIVATE_KEY = issuerPrivate;
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
  return service.claimPairingCode(code.code, 'https://casa.nezuecuador.com');
}

function keys() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKey: pair.privateKey, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

function post(app: FastifyInstance, url: string, credential: string, body?: unknown) {
  return app.inject({ method: 'POST', url, ...(body === undefined ? {} : { payload: JSON.stringify(body) }), headers: { authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) } });
}

async function enroll(app: FastifyInstance, token: string, publicKey: string, keyId = 'device-key-1') {
  return post(app, '/directory/edge-device/enroll', token, { keyId, algorithm: 'ES256', publicKey });
}

async function challenge(app: FastifyInstance, token: string, scope = 'homepilot.manifest.read') {
  const response = await post(app, '/directory/edge-device/challenge', token, { scope });
  expect(response.statusCode).toBe(200);
  return response.json() as { challengeId: string; nonce: string; scope: 'homepilot.manifest.read' | 'homepilot.command.execute'; expiresIn: number };
}

function proof(edge: { homeId: string; edgeId: string }, issued: Awaited<ReturnType<typeof challenge>>, privateKey: ReturnType<typeof keys>['privateKey'], keyId = 'device-key-1') {
  const payload = canonicalDeviceProofPayload({ homeId: edge.homeId, edgeId: edge.edgeId, challengeId: issued.challengeId, nonce: issued.nonce, scopes: [issued.scope] });
  return { challengeId: issued.challengeId, keyId, signature: sign('sha256', payload, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
}

afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

describe('Edge device binding', () => {
  it('migrates an existing SQLite Edge to unbound without changing its identity', async () => {
    const location = mkdtempSync(join(tmpdir(), 'directory-device-migration-'));
    const path = join(location, 'legacy.db');
    try {
      const legacy = new Database(path);
      const edgeId = randomUUID();
      legacy.exec('CREATE TABLE directory_edge_connections (id TEXT PRIMARY KEY, home_id TEXT NOT NULL, edge_id TEXT NOT NULL UNIQUE, credential_hash TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT)');
      legacy.prepare('INSERT INTO directory_edge_connections VALUES (?,?,?,?,?,?)').run(randomUUID(), randomUUID(), edgeId, 'legacy-hash', new Date().toISOString(), null);
      legacy.close();
      const db = new SqliteDirectoryDatabase(path);
      try {
        expect(await db.findActiveByEdgeId(edgeId)).toMatchObject({ edgeId, credentialHash: 'legacy-hash', deviceBindingState: 'unbound', devicePublicKey: null });
      } finally { db.close(); }
    } finally { rmSync(location, { recursive: true, force: true }); }
  });

  it('preserves legacy service token emission for an unbound Edge', async () => {
    const { app, db, service } = setup();
    const edge = await pair(db, service);
    const response = await post(app, '/directory/edge-service-token', edge.token);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ expiresIn: 120 });
    const [encoded, signature] = (response.json() as { token: string }).token.split('.');
    const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    expect(claims).toMatchObject({ type: 'homepilot.edge-service-token.v1', scope: 'homepilot.manifest.read', directoryHomeId: edge.homeId, directoryEdgeId: edge.edgeId });
    expect(claims.exp - claims.iat).toBe(120);
    expect(verify(null, Buffer.from(encoded), issuerKeys.publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect((await db.findActiveByEdgeId(edge.edgeId))?.deviceBindingState).toBe('unbound');
  });

  it('enrolls once, stores only the public key, and never falls back to legacy', async () => {
    const { app, db, service } = setup();
    const edge = await pair(db, service);
    const device = keys();
    const first = await enroll(app, edge.token, device.publicKey);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ edgeId: edge.edgeId, keyId: 'device-key-1', algorithm: 'ES256' });
    const stored = await db.findActiveByEdgeId(edge.edgeId);
    expect(stored).toMatchObject({ deviceBindingState: 'bound', deviceKeyId: 'device-key-1', deviceKeyAlgorithm: 'ES256', devicePublicKey: device.publicKey });
    const second = await enroll(app, edge.token, keys().publicKey, 'device-key-2');
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'DEVICE_ALREADY_BOUND' });
    const legacy = await post(app, '/directory/edge-service-token', edge.token);
    expect(legacy.statusCode).toBe(400);
    expect(legacy.json()).toEqual({ error: 'DEVICE_PROOF_REQUIRED' });
  });

  it('accepts a valid P-256 proof and preserves the existing token claims, scopes and TTL', async () => {
    const { app, db, service } = setup();
    const edge = await pair(db, service);
    const device = keys();
    expect((await enroll(app, edge.token, device.publicKey)).statusCode).toBe(201);
    for (const scope of ['homepilot.manifest.read', 'homepilot.command.execute'] as const) {
      const issued = await challenge(app, edge.token, scope);
      expect(issued.expiresIn).toBe(60);
      const response = await post(app, '/directory/edge-service-token', edge.token, { scope, deviceProof: proof(edge, issued, device.privateKey) });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const { token, expiresIn } = response.json() as { token: string; expiresIn: number };
      expect(expiresIn).toBe(120);
      const [encoded, signature] = token.split('.');
      const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      expect(Object.keys(claims)).toEqual(['type', 'issuer', 'audience', 'keyId', 'scope', 'directoryHomeId', 'directoryEdgeId', 'iat', 'exp', 'jti']);
      expect(claims).toMatchObject({ type: 'homepilot.edge-service-token.v1', issuer: 'homepilot-directory', audience: 'intentflow', keyId: 'edge-service-v1', scope, directoryHomeId: edge.homeId, directoryEdgeId: edge.edgeId });
      expect(claims.exp - claims.iat).toBe(120);
      expect(verify(null, Buffer.from(encoded), issuerKeys.publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    }
  });

  it('rejects wrong key, key id, Edge, Home and modified scope', async () => {
    const { app, db, service } = setup();
    const edge = await pair(db, service);
    const other = await pair(db, service);
    const device = keys();
    const otherDevice = keys();
    await enroll(app, edge.token, device.publicKey);
    await enroll(app, other.token, otherDevice.publicKey);
    const issued = await challenge(app, edge.token);
    const validProof = proof(edge, issued, device.privateKey);
    for (const [token, body] of [
      [edge.token, { scope: issued.scope, deviceProof: proof(edge, issued, otherDevice.privateKey) }],
      [edge.token, { scope: issued.scope, deviceProof: { ...validProof, keyId: 'wrong-key' } }],
      [other.token, { scope: issued.scope, deviceProof: validProof }],
      [edge.token, { scope: 'homepilot.command.execute', deviceProof: validProof }],
    ] as const) {
      const response = await post(app, '/directory/edge-service-token', token, body);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'DEVICE_PROOF_INVALID' });
    }
  });

  it('rejects expired and consumed challenges', async () => {
    const { app, db, service } = setup();
    const edge = await pair(db, service);
    const device = keys();
    await enroll(app, edge.token, device.publicKey);
    const missing = await post(app, '/directory/edge-service-token', edge.token, { scope: 'homepilot.manifest.read', deviceProof: { challengeId: randomUUID(), keyId: 'device-key-1', signature: 'A'.repeat(86) } });
    expect(missing.json()).toEqual({ error: 'DEVICE_PROOF_INVALID' });
    const expired = await challenge(app, edge.token);
    db.db.prepare('UPDATE directory_edge_device_challenges SET expires_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), expired.challengeId);
    const expiredResponse = await post(app, '/directory/edge-service-token', edge.token, { scope: expired.scope, deviceProof: proof(edge, expired, device.privateKey) });
    expect(expiredResponse.json()).toEqual({ error: 'DEVICE_CHALLENGE_EXPIRED' });
    const issued = await challenge(app, edge.token);
    const body = { scope: issued.scope, deviceProof: proof(edge, issued, device.privateKey) };
    expect((await post(app, '/directory/edge-service-token', edge.token, body)).statusCode).toBe(200);
    const replay = await post(app, '/directory/edge-service-token', edge.token, body);
    expect(replay.json()).toEqual({ error: 'DEVICE_CHALLENGE_CONSUMED' });
  });

  it('allows only one concurrent consumption of a challenge', async () => {
    const { app, db, service } = setup();
    const edge = await pair(db, service);
    const device = keys();
    await enroll(app, edge.token, device.publicKey);
    const issued = await challenge(app, edge.token);
    const body = { scope: issued.scope, deviceProof: proof(edge, issued, device.privateKey) };
    const responses = await Promise.all([post(app, '/directory/edge-service-token', edge.token, body), post(app, '/directory/edge-service-token', edge.token, body)]);
    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 400]);
    expect(responses.filter(response => response.statusCode === 200)).toHaveLength(1);
    expect(responses.find(response => response.statusCode === 400)?.json()).toEqual({ error: 'DEVICE_CHALLENGE_CONSUMED' });
  });

  it('canonicalizes the six LF-terminated lines exactly', () => {
    const payload = canonicalDeviceProofPayload({ homeId: 'home-a', edgeId: 'edge-a', challengeId: 'challenge-a', nonce: 'nonce-a', scopes: ['homepilot.command.execute'] });
    expect(payload.toString('utf8')).toBe('homepilot.edge-device-proof.v1\nhome-a\nedge-a\nchallenge-a\nnonce-a\nhomepilot.command.execute\n');
  });
});
