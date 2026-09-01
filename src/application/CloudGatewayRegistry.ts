import { CLOUD_GATEWAY_PROTOCOL_VERSION, type RelayIdentity, type RelayOperation, type RelayPrincipal, parseRelayMessage } from './CloudGatewayProtocol.js';

const MAX_TIMER_MS = 2 ** 31 - 1;

export interface EdgeChannel { send(message: string): void; close?(): void; }
export interface GatewayResponse { requestId: string; status: number; payload?: unknown; }

interface PendingGatewayRequest {
  resolve: (response: GatewayResponse) => void;
  reject: (error: CloudGatewayRegistryError) => void;
  timeout: NodeJS.Timeout;
}
interface ConnectedEdge { identity: RelayIdentity; channel: EdgeChannel; pending: Map<string, PendingGatewayRequest>; }

export class CloudGatewayRegistry {
  private readonly edges = new Map<string, ConnectedEdge>();

  connect(identity: RelayIdentity, channel: EdgeChannel): void {
    const current = this.edges.get(identity.edgeId);
    current?.channel.close?.();
    this.edges.set(identity.edgeId, { identity, channel, pending: new Map() });
  }

  disconnect(edgeId: string, channel: EdgeChannel): void {
    const current = this.edges.get(edgeId);
    if (current?.channel !== channel) return;
    this.edges.delete(edgeId);
    for (const pending of current.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new CloudGatewayRegistryError('EDGE_OFFLINE'));
    }
    current.pending.clear();
  }

  async request(identity: RelayIdentity, principal: RelayPrincipal, requestId: string, operation: RelayOperation, expiresAt: string): Promise<GatewayResponse> {
    const edge = this.edges.get(identity.edgeId);
    if (!edge || edge.identity.homeId !== identity.homeId) throw new CloudGatewayRegistryError('EDGE_OFFLINE');
    if (edge.pending.has(requestId)) throw new CloudGatewayRegistryError('GATEWAY_REQUEST_DUPLICATED');
    const message = parseRelayMessage({ protocolVersion: CLOUD_GATEWAY_PROTOCOL_VERSION, type: 'cloud.request', ...identity, principal, requestId, operation, expiresAt }, identity);
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) throw new CloudGatewayRegistryError('GATEWAY_REQUEST_EXPIRED');

    return new Promise<GatewayResponse>((resolve, reject) => {
      const scheduleExpiry = (): NodeJS.Timeout => {
        const timeout = setTimeout(() => {
          if (Date.now() < expiresAtMs) {
            const pending = edge.pending.get(requestId);
            if (pending) pending.timeout = scheduleExpiry();
            return;
          }
          edge.pending.delete(requestId);
          reject(new CloudGatewayRegistryError('GATEWAY_REQUEST_EXPIRED'));
        }, Math.min(expiresAtMs - Date.now(), MAX_TIMER_MS));
        timeout.unref();
        return timeout;
      };
      const timeout = scheduleExpiry();
      edge.pending.set(requestId, { resolve, reject, timeout });
      try { edge.channel.send(JSON.stringify(message)); }
      catch {
        clearTimeout(timeout);
        edge.pending.delete(requestId);
        reject(new CloudGatewayRegistryError('EDGE_OFFLINE'));
      }
    });
  }

  async poll(identity: RelayIdentity, timeoutMs = 25_000): Promise<unknown> {
    return new Promise((resolve) => {
      let delivered = false;
      const channel: EdgeChannel = {
        send: (message) => {
          if (delivered) return;
          delivered = true;
          clearTimeout(timeout);
          resolve(JSON.parse(message) as unknown);
        },
      };
      const timeout = setTimeout(() => {
        if (delivered) return;
        delivered = true;
        this.disconnect(identity.edgeId, channel);
        resolve({ protocolVersion: CLOUD_GATEWAY_PROTOCOL_VERSION, type: 'edge.heartbeat', ...identity });
      }, timeoutMs);
      timeout.unref();
      this.connect(identity, channel);
    });
  }
  receive(edgeId: string, rawMessage: unknown): void {
    const edge = this.edges.get(edgeId);
    if (!edge) throw new CloudGatewayRegistryError('EDGE_OFFLINE');
    const message = parseRelayMessage(rawMessage, edge.identity);
    if (message.type !== 'edge.response' || !message.requestId || message.status === undefined) return;
    const pending = edge.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    edge.pending.delete(message.requestId);
    pending.resolve({ requestId: message.requestId, status: message.status, payload: message.payload });
  }
}

export class CloudGatewayRegistryError extends Error {
  constructor(public readonly code: 'EDGE_OFFLINE' | 'GATEWAY_REQUEST_DUPLICATED' | 'GATEWAY_REQUEST_EXPIRED') { super(code); }
}