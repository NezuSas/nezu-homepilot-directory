import { describe, expect, it, vi } from 'vitest';
import { CloudGatewayRegistry, CloudGatewayRegistryError } from '../application/CloudGatewayRegistry.js';

const identity = { homeId: 'home-a', edgeId: 'edge-a' };
const expiry = '2030-01-01T00:00:00.000Z';

describe('CloudGatewayRegistry', () => {
  it('sends an allowlisted request only to the exact connected Edge and resolves its correlated response', async () => {
    const registry = new CloudGatewayRegistry(); const channel = { send: vi.fn() };
    registry.connect(identity, channel);
    const pending = registry.request(identity, { accountId: 'account-a', role: 'owner' }, 'request-a', 'devices.read', expiry);
    expect(channel.send).toHaveBeenCalledTimes(1);
    registry.receive('edge-a', { protocolVersion: 1, type: 'edge.response', ...identity, principal: { accountId: 'account-a', role: 'owner' }, requestId: 'request-a', status: 200 });
    await expect(pending).resolves.toEqual({ requestId: 'request-a', status: 200 });
  });

  it('preserves the allowlisted command payload for the paired Edge', () => {
    const registry = new CloudGatewayRegistry(); const channel = { send: vi.fn() };
    registry.connect(identity, channel);
    void registry.request(identity, { accountId: 'account-a', role: 'owner' }, 'command-a', 'device.command', expiry, { deviceId: 'light-a', command: 'turn_on', params: {} });
    const message = JSON.parse(channel.send.mock.calls[0][0]) as { input: unknown };
    expect(message.input).toEqual({ deviceId: 'light-a', command: 'turn_on', params: {} });
  });
  it('never routes another home to an Edge sharing an identifier and does not queue an offline command', async () => {
    const registry = new CloudGatewayRegistry(); registry.connect(identity, { send: vi.fn() });
    await expect(registry.request({ homeId: 'home-b', edgeId: 'edge-a' }, { accountId: 'account-a', role: 'owner' }, 'request-b', 'devices.read', expiry)).rejects.toMatchObject({ code: 'EDGE_OFFLINE' } satisfies Partial<CloudGatewayRegistryError>);
    await expect(registry.request({ homeId: 'home-a', edgeId: 'edge-missing' }, { accountId: 'account-a', role: 'owner' }, 'request-c', 'devices.read', expiry)).rejects.toMatchObject({ code: 'EDGE_OFFLINE' } satisfies Partial<CloudGatewayRegistryError>);
  });

  it('replaces a stale connection and closes it before accepting a new one', () => {
    const registry = new CloudGatewayRegistry(); const oldChannel = { send: vi.fn(), close: vi.fn() };
    registry.connect(identity, oldChannel); registry.connect(identity, { send: vi.fn() });
    expect(oldChannel.close).toHaveBeenCalledOnce();
  });
});
