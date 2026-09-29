import { expect, it } from 'vitest';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { Pool } from 'pg';
import { DirectoryService } from '../application/DirectoryService.js';
import { canonicalDeviceProofPayload } from '../application/EdgeDeviceBinding.js';
import { PostgresDirectoryDatabase } from '../infrastructure/PostgresDirectoryDatabase.js';

const testDatabaseUrl = process.env.DIRECTORY_TEST_DATABASE_URL;

(testDatabaseUrl ? it : it.skip)('PostgreSQL migrates legacy Edges and consumes device challenges atomically', async () => {
  const db = new PostgresDirectoryDatabase(testDatabaseUrl!);
  const cleanup = new Pool({ connectionString: testDatabaseUrl });
  const ownerId = randomUUID();
  const homeId = randomUUID();
  let accountCreated = false;
  let homeCreated = false;
  try {
    await db.migrate();
    await db.migrate();
    const service = new DirectoryService(db);
    const now = new Date().toISOString();
    await db.createAccount({ id: ownerId, email: `${ownerId}@example.test`, displayName: 'Owner', passwordHash: 'unused', emailVerified: true, createdAt: now });
    accountCreated = true;
    await db.createHome({ id: homeId, name: 'Binding test', edgeHostname: 'https://edge-unpaired.homepilot.invalid', ownerAccountId: ownerId, createdAt: now, updatedAt: now });
    homeCreated = true;
    await db.createMembership({ id: randomUUID(), homeId, accountId: ownerId, role: 'owner', status: 'active', invitedByAccountId: null, invitationTokenHash: null, invitationExpiresAt: null, createdAt: now, updatedAt: now });
    const pairing = await service.createPairingCode(ownerId, homeId);
    const edge = await service.claimPairingCode(pairing.code, 'https://casa.nezuecuador.com');
    expect((await db.findActiveByEdgeId(edge.edgeId))?.deviceBindingState).toBe('unbound');
    const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = device.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await service.enrollEdgeDevice(edge.token, edge, { keyId: 'pg-device-1', algorithm: 'ES256', publicKey });
    expect((await db.findActiveByEdgeId(edge.edgeId))?.deviceBindingState).toBe('bound');
    await expect(service.enrollEdgeDevice(edge.token, edge, { keyId: 'pg-device-2', algorithm: 'ES256', publicKey })).rejects.toMatchObject({ code: 'DEVICE_ALREADY_BOUND' });
    const challenge = await service.createEdgeDeviceChallenge(edge, 'homepilot.command.execute');
    const payload = canonicalDeviceProofPayload({ homeId, edgeId: edge.edgeId, challengeId: challenge.challengeId, nonce: challenge.nonce, scopes: ['homepilot.command.execute'] });
    const proof = { challengeId: challenge.challengeId, keyId: 'pg-device-1', signature: sign('sha256', payload, { key: device.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') };
    const results = await Promise.allSettled([
      service.verifyAndConsumeEdgeDeviceProof(edge, 'homepilot.command.execute', proof),
      service.verifyAndConsumeEdgeDeviceProof(edge, 'homepilot.command.execute', proof),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await db.findDeviceChallenge(challenge.challengeId))?.consumedAt).not.toBeNull();
  } finally {
    if (homeCreated) await db.deleteById(homeId);
    if (accountCreated) await cleanup.query('DELETE FROM directory_accounts WHERE id=$1', [ownerId]);
    await cleanup.end();
    await db.close();
  }
});
