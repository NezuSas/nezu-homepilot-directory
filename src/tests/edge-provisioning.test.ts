import { describe, expect, it } from 'vitest';
import { DirectoryService } from '../application/DirectoryService.js';
import { createMembership } from '../domain/entities.js';
import { SqliteDirectoryDatabase } from '../infrastructure/SqliteDirectoryDatabase.js';

const now = '2030-01-01T00:00:00.000Z';

describe('DirectoryService Edge provisioning', () => {
  it('returns a credential once, persists only a verifier, and invalidates the previous credential on rotation', async () => {
    const database = new SqliteDirectoryDatabase(':memory:');
    const owner = { id: 'owner-1', email: 'owner@example.test', passwordHash: 'hash', displayName: 'Owner', emailVerified: true, createdAt: now };
    const home = { id: 'home-1', name: 'Casa', edgeHostname: 'https://legacy-edge.example.test', ownerAccountId: owner.id, createdAt: now, updatedAt: now };
    await database.createAccount(owner);
    await database.createHome(home);
    await database.createMembership(createMembership({ homeId: home.id, accountId: owner.id, invitedByAccountId: null, role: 'owner' }, now));
    const directory = new DirectoryService(database);

    const firstCode = await directory.createPairingCode(owner.id, home.id); const first = await directory.claimPairingCode(firstCode.code);
    expect(await directory.authenticateEdgeCredential(first.token)).toEqual({ homeId: home.id, edgeId: first.edgeId });
    const secondCode = await directory.createPairingCode(owner.id, home.id); const second = await directory.claimPairingCode(secondCode.code);
    expect(await directory.authenticateEdgeCredential(first.token)).toBeNull();
    expect(await directory.authenticateEdgeCredential(second.token)).toEqual({ homeId: home.id, edgeId: second.edgeId });
    expect(second.token).not.toContain((await database.findActiveByHomeId(home.id))!.credentialHash);
    database.close();
  });
});