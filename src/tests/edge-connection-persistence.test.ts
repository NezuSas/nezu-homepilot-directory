import { describe, expect, it } from 'vitest';
import { SqliteDirectoryDatabase } from '../infrastructure/SqliteDirectoryDatabase.js';

const account = { id: 'account-1', email: 'owner@example.test', passwordHash: 'hash', displayName: 'Owner', emailVerified: true, createdAt: '2030-01-01T00:00:00.000Z' };
const home = { id: 'home-1', name: 'Casa', edgeHostname: 'https://legacy-edge.example.test', ownerAccountId: account.id, createdAt: account.createdAt, updatedAt: account.createdAt };

describe('edge connection persistence', () => {
  it('stores only a credential verifier and excludes revoked connections from authentication lookups', async () => {
    const database = new SqliteDirectoryDatabase(':memory:');
    await database.createAccount(account);
    await database.createHome(home);
    await database.createEdgeConnection({ id: 'connection-1', homeId: home.id, edgeId: 'edge-1', credentialHash: 'sha256-verifier-only', createdAt: account.createdAt, revokedAt: null });

    expect(await database.findActiveByHomeId(home.id)).toMatchObject({ edgeId: 'edge-1', credentialHash: 'sha256-verifier-only' });
    expect(await database.revoke('connection-1', '2030-01-02T00:00:00.000Z')).toBe(true);
    expect(await database.findActiveByEdgeId('edge-1')).toBeNull();
    database.close();
  });
});