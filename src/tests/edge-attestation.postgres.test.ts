import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PostgresDirectoryDatabase } from '../infrastructure/PostgresDirectoryDatabase.js';
import { DirectoryService, hashEdgeCredential } from '../application/DirectoryService.js';

const testDatabaseUrl = process.env.DIRECTORY_TEST_DATABASE_URL;

(testDatabaseUrl ? it : it.skip)('PostgreSQL enforces one active Edge and preserves revoked history across re-pairing', async () => {
  const db = new PostgresDirectoryDatabase(testDatabaseUrl!);
  let homeId: string | undefined;
  try {
    await db.migrate();
    const service = new DirectoryService(db);
    const now = new Date().toISOString();
    const owner = randomUUID();
    homeId = randomUUID();
    await db.createAccount({ id: owner, email: `${owner}@example.test`, displayName: 'Owner', passwordHash: 'unused', emailVerified: true, createdAt: now });
    await db.createHome({ id: homeId, name: 'Postgres attestation test', edgeHostname: 'https://edge-unpaired.homepilot.invalid', ownerAccountId: owner, createdAt: now, updatedAt: now });
    await db.createMembership({ id: randomUUID(), homeId, accountId: owner, role: 'owner', status: 'active', invitedByAccountId: null, invitationTokenHash: null, invitationExpiresAt: null, createdAt: now, updatedAt: now });
    const firstCode = await service.createPairingCode(owner, homeId);
    const first = await service.claimPairingCode(firstCode.code, 'https://casa.nezuecuador.com');
    await expect(db.createEdgeConnection({ id: randomUUID(), homeId, edgeId: randomUUID(), credentialHash: hashEdgeCredential('duplicate'), createdAt: now, revokedAt: null })).rejects.toThrow();
    const secondCode = await service.createPairingCode(owner, homeId);
    const second = await service.claimPairingCode(secondCode.code, 'https://casa.nezuecuador.com');
    expect(await service.authenticateEdgeCredential(first.token)).toBeNull();
    expect(await service.authenticateEdgeCredential(second.token)).toEqual({ homeId, edgeId: second.edgeId });
    expect(await db.findActiveByHomeId(homeId)).toMatchObject({ edgeId: second.edgeId });
  } finally {
    if (homeId) await db.deleteById(homeId);
    await db.close();
  }
});
