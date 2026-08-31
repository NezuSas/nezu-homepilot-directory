import { describe, expect, it } from 'vitest';
import { CLOUD_GATEWAY_PROTOCOL_VERSION, CloudGatewayProtocolError, parseRelayMessage } from '../application/CloudGatewayProtocol.js';

const identity = { homeId: 'home-a', edgeId: 'edge-a' };
const expiresAt = '2030-01-01T00:00:00.000Z';

function expectCode(run: () => unknown, code: CloudGatewayProtocolError['code']): void {
  try { run(); throw new Error('Expected protocol rejection.'); }
  catch (error) { expect(error).toBeInstanceOf(CloudGatewayProtocolError); expect(error).toMatchObject({ code }); }
}

describe('Cloud Gateway protocol', () => {
  it('accepts only a heartbeat bound to the connected Edge identity', () => {
    expect(parseRelayMessage({ protocolVersion: CLOUD_GATEWAY_PROTOCOL_VERSION, type: 'edge.heartbeat', ...identity }, identity)).toEqual({ protocolVersion: 1, type: 'edge.heartbeat', ...identity });
  });

  it('rejects a message for another home before accepting its operation or request id', () => {
    expectCode(() => parseRelayMessage({ protocolVersion: 1, type: 'cloud.request', homeId: 'home-b', edgeId: 'edge-a', requestId: 'request-a', expiresAt, operation: 'devices.read' }, identity), 'GATEWAY_IDENTITY_MISMATCH');
  });

  it('rejects unsupported versions, stale requests and operations outside the explicit allowlist', () => {
    expectCode(() => parseRelayMessage({ protocolVersion: 2, type: 'edge.heartbeat', ...identity }, identity), 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED');
    expectCode(() => parseRelayMessage({ protocolVersion: 1, type: 'cloud.request', ...identity, principal: { accountId: 'account-a', role: 'owner' }, requestId: 'request-a', expiresAt: '2020-01-01T00:00:00.000Z', operation: 'devices.read' }, identity), 'GATEWAY_REQUEST_EXPIRED');
    expectCode(() => parseRelayMessage({ protocolVersion: 1, type: 'cloud.request', ...identity, principal: { accountId: 'account-a', role: 'owner' }, requestId: 'request-a', expiresAt, operation: 'camera.stream' }, identity), 'GATEWAY_PROTOCOL_INVALID');
  });

  it('accepts a bounded relay response without accepting its payload into the protocol layer', () => {
    expect(parseRelayMessage({ protocolVersion: 1, type: 'edge.response', ...identity, requestId: 'request-a', status: 204, body: { ignored: true } }, identity)).toEqual({ protocolVersion: 1, type: 'edge.response', ...identity, requestId: 'request-a', status: 204 });
  });
});