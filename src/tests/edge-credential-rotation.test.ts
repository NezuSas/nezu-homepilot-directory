import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Response as InjectResponse } from 'light-my-request';
import { buildServer } from '../server.js';
import { DirectoryService, hashEdgeCredential } from '../application/DirectoryService.js';
import { SqliteDirectoryDatabase } from '../infrastructure/SqliteDirectoryDatabase.js';

const apps: FastifyInstance[] = [];

function setup(db = new SqliteDirectoryDatabase(':memory:')) {
  const app = buildServer({ store: db, jwtSecret: 'test-secret-with-at-least-thirty-two-characters', serveWeb: false });
  apps.push(app);
  return { app, db, service: new DirectoryService(db) };
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

function rotate(app: FastifyInstance, credential?: string, body?: unknown): Promise<InjectResponse> {
  return app.inject({
    method: 'POST', url: '/directory/edge-credential/rotate',
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  }) as Promise<InjectResponse>;
}

afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

describe('Edge Credential Rotation v1', () => {
  it('replaces only the hash, preserves stable identity and returns the new credential once', async () => {
    const { app, db, service } = setup();
    const edge = await pair(db, service);
    const before = await db.findActiveByEdgeId(edge.edgeId);
    const homeBefore = await db.findHomeById(edge.homeId);
    const response = await rotate(app, edge.token);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(Object.keys(response.json())).toEqual(['token', 'homeId', 'edgeId']);
    const next = response.json() as { token: string; homeId: string; edgeId: string };
    expect(next.homeId).toBe(edge.homeId);
    expect(next.edgeId).toBe(edge.edgeId);
    expect(next.token).not.toBe(edge.token);
    expect(next.token).toMatch(new RegExp(`^${edge.edgeId}\\.[A-Za-z0-9_-]{43}$`));
    expect(await service.authenticateEdgeCredential(edge.token)).toBeNull();
    expect(await service.authenticateEdgeCredential(next.token)).toEqual({ homeId: edge.homeId, edgeId: edge.edgeId });
    const after = await db.findActiveByEdgeId(edge.edgeId);
    expect(after).toMatchObject({ id: before!.id, homeId: before!.homeId, edgeId: before!.edgeId, createdAt: before!.createdAt, revokedAt: null, credentialHash: hashEdgeCredential(next.token) });
    expect(after!.credentialHash).not.toBe(before!.credentialHash);
    expect(await db.findHomeById(edge.homeId)).toEqual(homeBefore);
    const rows = db.db.prepare('SELECT id FROM directory_edge_connections WHERE home_id = ?').all(edge.homeId);
    expect(rows).toHaveLength(1);
    const audit = await db.listForHome(edge.homeId);
    expect(audit.filter(event => event.action === 'edge.credential.rotated')).toEqual([expect.objectContaining({ actorAccountId: `edge:${edge.edgeId}`, homeId: edge.homeId })]);
    expect(JSON.stringify(audit)).not.toContain(edge.token);
    expect(JSON.stringify(audit)).not.toContain(next.token);
    expect(JSON.stringify(audit)).not.toContain(before!.credentialHash);
    expect(JSON.stringify(audit)).not.toContain(after!.credentialHash);
  });

  it('rejects missing, invalid and revoked credentials with no-store', async () => {
    const { app, db, service } = setup();
    const edge = await pair(db, service);
    for (const credential of [undefined, 'invalid']) {
      const response = await rotate(app, credential);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'EDGE_CREDENTIAL_INVALID' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const connection = await db.findActiveByEdgeId(edge.edgeId);
    await db.revoke(connection!.id, new Date().toISOString());
    const revoked = await rotate(app, edge.token);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json()).toEqual({ error: 'EDGE_CREDENTIAL_INVALID' });
  });

  it('rejects any request body and ignores caller-supplied identity', async () => {
    const { app, db, service } = setup();
    const edge = await pair(db, service);
    for (const body of [{}, [], null, { homeId: 'other' }, { edgeId: 'other' }]) {
      const response = await rotate(app, edge.token, body);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'EDGE_CREDENTIAL_ROTATION_BODY_NOT_ALLOWED' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(await service.authenticateEdgeCredential(edge.token)).toEqual({ homeId: edge.homeId, edgeId: edge.edgeId });
    const malformed = await app.inject({ method: 'POST', url: '/directory/edge-credential/rotate', payload: '{', headers: { authorization: `Bearer ${edge.token}`, 'content-type': 'application/json' } });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ error: 'EDGE_CREDENTIAL_ROTATION_BODY_NOT_ALLOWED' });
    expect(malformed.headers['cache-control']).toBe('no-store');
  });

  it('uses compare-and-swap so one concurrent rotation succeeds and the other conflicts', async () => {
    class RacingStore extends SqliteDirectoryDatabase {
      private arrived = 0;
      private release!: () => void;
      private readonly gate = new Promise<void>(resolve => { this.release = resolve; });
      override async rotateEdgeCredential(edgeId: string, expectedHash: string, nextHash: string, auditEvent: import('../domain/entities.js').AuditEvent): Promise<boolean> {
        this.arrived += 1;
        if (this.arrived === 2) this.release();
        await this.gate;
        return super.rotateEdgeCredential(edgeId, expectedHash, nextHash, auditEvent);
      }
    }
    const { app, db, service } = setup(new RacingStore(':memory:'));
    const edge = await pair(db, service);
    const authenticate = vi.spyOn(DirectoryService.prototype, 'authenticateEdgeCredential');
    try {
      const results = await Promise.all([rotate(app, edge.token), rotate(app, edge.token)]);
      expect(authenticate).toHaveBeenCalledTimes(2);
      expect(results.map(response => response.statusCode).sort()).toEqual([200, 409]);
      const winner = results.find(response => response.statusCode === 200)!;
      const loser = results.find(response => response.statusCode === 409)!;
      expect(loser.json()).toEqual({ error: 'EDGE_CREDENTIAL_ROTATION_CONFLICT' });
      expect(loser.headers['cache-control']).toBe('no-store');
      expect(await service.authenticateEdgeCredential(edge.token)).toBeNull();
      expect(await service.authenticateEdgeCredential((winner.json() as { token: string }).token)).toEqual({ homeId: edge.homeId, edgeId: edge.edgeId });
      expect((await db.listForHome(edge.homeId)).filter(event => event.action === 'edge.credential.rotated')).toHaveLength(1);
    } finally {
      authenticate.mockRestore();
    }
  });

  it('limits rotations to ten per minute per Edge', async () => {
    const { app, db, service } = setup();
    const first = await pair(db, service);
    const second = await pair(db, service);
    let credential = first.token;
    for (let count = 0; count < 10; count++) {
      const response = await rotate(app, credential);
      expect(response.statusCode).toBe(200);
      credential = (response.json() as { token: string }).token;
    }
    const limited = await rotate(app, credential);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'RATE_LIMIT_EXCEEDED' });
    expect(limited.headers['cache-control']).toBe('no-store');
    expect((await rotate(app, second.token)).statusCode).toBe(200);
  });
});
