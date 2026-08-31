import { describe, expect, it, vi } from 'vitest';
import { CloudGatewayRegistry } from '../application/CloudGatewayRegistry.js';

const owner = { accountId: 'owner-a', role: 'owner' as const };
const member = { accountId: 'member-a', role: 'member' as const };
const homeA = { homeId: 'home-a', edgeId: 'edge-a' };
const future = '2030-01-01T00:00:00.000Z';

describe('Cloud-to-Edge integration contract', () => {
  it('routes an owner request only to its paired Edge and resolves its response', async () => {
    const registry = new CloudGatewayRegistry(); const channel = { send: vi.fn() };
    registry.connect(homeA, channel);
    const pending = registry.request(homeA, owner, 'request-owner', 'devices.read', future);
    expect(channel.send).toHaveBeenCalledOnce();
    registry.receive('edge-a', { protocolVersion: 1, type: 'edge.response', ...homeA, requestId: 'request-owner', status: 200, payload: { devices: [] } });
    await expect(pending).resolves.toMatchObject({ status: 200 });
  });

  it('rejects a member physical command, cross-home routing, replay and offline Edge', async () => {
    const registry = new CloudGatewayRegistry(); registry.connect(homeA, { send: vi.fn() });
    await expect(registry.request(homeA, member, 'member-command', 'device.command', future)).rejects.toMatchObject({ code: 'GATEWAY_OPERATION_FORBIDDEN' });
    await expect(registry.request({ homeId: 'home-b', edgeId: 'edge-a' }, owner, 'cross-home', 'devices.read', future)).rejects.toMatchObject({ code: 'EDGE_OFFLINE' });
    await expect(registry.request({ homeId: 'home-a', edgeId: 'missing' }, owner, 'offline', 'devices.read', future)).rejects.toMatchObject({ code: 'EDGE_OFFLINE' });
  });
});
