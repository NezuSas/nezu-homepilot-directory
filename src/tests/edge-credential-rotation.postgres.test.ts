import { expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DirectoryService, hashEdgeCredential } from '../application/DirectoryService.js';
import { PostgresDirectoryDatabase } from '../infrastructure/PostgresDirectoryDatabase.js';

const testDatabaseUrl = process.env.DIRECTORY_TEST_DATABASE_URL;

(testDatabaseUrl ? it : it.skip)('PostgreSQL rotates the active Edge hash with the same compare-and-swap semantics', async () => {
  const db = new PostgresDirectoryDatabase(testDatabaseUrl!);
  const cleanupPool = new Pool({ connectionString: testDatabaseUrl });
  const ownerId = randomUUID();
  const homeId = randomUUID();
  let accountCreated = false;
  let homeCreated = false;
  try {
    await db.migrate();
    const now = new Date().toISOString();
    await db.createAccount({ id: ownerId, email: `${ownerId}@example.test`, displayName: 'Owner', passwordHash: 'unused', emailVerified: true, createdAt: now });
    accountCreated = true;
    await db.createHome({ id: homeId, name: 'Rotation test', edgeHostname: 'https://casa.nezuecuador.com', ownerAccountId: ownerId, createdAt: now, updatedAt: now });
    homeCreated = true;
    const edgeId = randomUUID();
    const connectionId = randomUUID();
    const oldCredential = `${edgeId}.${randomBytes(32).toString('base64url')}`;
    await db.createEdgeConnection({ id: connectionId, homeId, edgeId, credentialHash: hashEdgeCredential(oldCredential), createdAt: now, revokedAt: null });
    const service = new DirectoryService(db);
    const auditEvent = () => ({ id: randomUUID(), actorAccountId: `edge:${edgeId}`, homeId, membershipId: null, action: 'edge.credential.rotated', createdAt: new Date().toISOString() });
    const first = `${edgeId}.${randomBytes(32).toString('base64url')}`;
    const second = `${edgeId}.${randomBytes(32).toString('base64url')}`;
    const results = await Promise.all([
      db.rotateEdgeCredential(edgeId, hashEdgeCredential(oldCredential), hashEdgeCredential(first), auditEvent()),
      db.rotateEdgeCredential(edgeId, hashEdgeCredential(oldCredential), hashEdgeCredential(second), auditEvent()),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results[0] ? first : second;
    expect(await service.authenticateEdgeCredential(oldCredential)).toBeNull();
    expect(await service.authenticateEdgeCredential(winner)).toEqual({ homeId, edgeId });
    const authenticatedIdentity = await service.authenticateEdgeCredential(winner);
    expect(authenticatedIdentity).toEqual({ homeId, edgeId });
    const rotated = await service.rotateEdgeCredential(winner, authenticatedIdentity!);
    expect(rotated).toMatchObject({ homeId, edgeId });
    expect(await service.authenticateEdgeCredential(winner)).toBeNull();
    expect(await service.authenticateEdgeCredential(rotated.token)).toEqual({ homeId, edgeId });
    expect(await db.findActiveByEdgeId(edgeId)).toMatchObject({ id: connectionId, homeId, edgeId, createdAt: now, revokedAt: null, credentialHash: hashEdgeCredential(rotated.token) });
    expect((await db.listForHome(homeId)).filter(event => event.action === 'edge.credential.rotated')).toEqual([
      expect.objectContaining({ actorAccountId: `edge:${edgeId}`, homeId }),
      expect.objectContaining({ actorAccountId: `edge:${edgeId}`, homeId }),
    ]);
    expect(await db.rotateEdgeCredential(edgeId, hashEdgeCredential(winner), hashEdgeCredential(first), auditEvent())).toBe(false);
    expect(await db.revoke(connectionId, new Date().toISOString())).toBe(true);
    expect(await db.rotateEdgeCredential(edgeId, hashEdgeCredential(rotated.token), hashEdgeCredential(second), auditEvent())).toBe(false);
  } finally {
    if (homeCreated) await db.deleteById(homeId);
    if (accountCreated) await cleanupPool.query('DELETE FROM directory_accounts WHERE id=$1', [ownerId]);
    await cleanupPool.end();
    await db.close();
  }
});
