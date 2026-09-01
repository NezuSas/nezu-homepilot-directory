export const CLOUD_GATEWAY_PROTOCOL_VERSION = 1;

export const relayOperations = ['dashboard.read', 'devices.read', 'device.command'] as const;
export type RelayOperation = typeof relayOperations[number];
export type RelayMessageType = 'edge.heartbeat' | 'edge.response' | 'cloud.request';
export type RelayMembershipRole = 'owner' | 'member';

export interface RelayIdentity { homeId: string; edgeId: string; }
export interface RelayPrincipal { accountId: string; role: RelayMembershipRole; }
export interface RelayMessage extends RelayIdentity {
  protocolVersion: typeof CLOUD_GATEWAY_PROTOCOL_VERSION;
  type: RelayMessageType;
  requestId?: string;
  expiresAt?: string;
  operation?: RelayOperation;
  principal?: RelayPrincipal;
  status?: number;
  payload?: unknown;
  input?: unknown;
}

export class CloudGatewayProtocolError extends Error {
  constructor(public readonly code: 'GATEWAY_PROTOCOL_INVALID' | 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED' | 'GATEWAY_IDENTITY_MISMATCH' | 'GATEWAY_REQUEST_EXPIRED' | 'GATEWAY_OPERATION_FORBIDDEN') { super(code); }
}

export function parseRelayMessage(value: unknown, expected: RelayIdentity, now = new Date()): RelayMessage {
  if (!isRecord(value) || value.protocolVersion !== CLOUD_GATEWAY_PROTOCOL_VERSION) throw new CloudGatewayProtocolError(value && isRecord(value) && value.protocolVersion !== CLOUD_GATEWAY_PROTOCOL_VERSION ? 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED' : 'GATEWAY_PROTOCOL_INVALID');
  if (!isText(value.homeId) || !isText(value.edgeId) || value.homeId !== expected.homeId || value.edgeId !== expected.edgeId) throw new CloudGatewayProtocolError('GATEWAY_IDENTITY_MISMATCH');
  if (value.type === 'edge.heartbeat') return { protocolVersion: CLOUD_GATEWAY_PROTOCOL_VERSION, type: value.type, homeId: value.homeId, edgeId: value.edgeId };
  if (!isText(value.requestId)) throw new CloudGatewayProtocolError('GATEWAY_PROTOCOL_INVALID');
  if (value.type === 'edge.response') {
    if (typeof value.status !== 'number' || !Number.isInteger(value.status) || value.status < 100 || value.status > 599) throw new CloudGatewayProtocolError('GATEWAY_PROTOCOL_INVALID');
    return { protocolVersion: CLOUD_GATEWAY_PROTOCOL_VERSION, type: value.type, homeId: value.homeId, edgeId: value.edgeId, requestId: value.requestId, status: value.status, payload: value.payload }; 
  }
  if (value.type !== 'cloud.request' || !isText(value.expiresAt) || !isRelayOperation(value.operation) || !isPrincipal(value.principal)) throw new CloudGatewayProtocolError('GATEWAY_PROTOCOL_INVALID');
  if (Date.parse(value.expiresAt) <= now.getTime()) throw new CloudGatewayProtocolError('GATEWAY_REQUEST_EXPIRED');
  if (value.operation === 'device.command' && value.principal.role !== 'owner') throw new CloudGatewayProtocolError('GATEWAY_OPERATION_FORBIDDEN');
  return { protocolVersion: CLOUD_GATEWAY_PROTOCOL_VERSION, type: value.type, homeId: value.homeId, edgeId: value.edgeId, requestId: value.requestId, expiresAt: value.expiresAt, operation: value.operation, principal: value.principal, input: value.input };
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 160; }
function isRelayOperation(value: unknown): value is RelayOperation { return typeof value === 'string' && (relayOperations as readonly string[]).includes(value); }
function isPrincipal(value: unknown): value is RelayPrincipal { return isRecord(value) && isText(value.accountId) && (value.role === 'owner' || value.role === 'member'); }