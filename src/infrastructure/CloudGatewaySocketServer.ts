import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { RelayIdentity } from '../application/CloudGatewayProtocol.js';
import { CloudGatewayRegistry } from '../application/CloudGatewayRegistry.js';

export interface EdgeConnectionAuthenticator {
  authenticate(token: string): Promise<RelayIdentity | null>;
}

export class CloudGatewaySocketServer {
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  constructor(private readonly registry: CloudGatewayRegistry, private readonly authenticator: EdgeConnectionAuthenticator) {}

  install(server: Server): void {
    server.on('upgrade', (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    });
  }

  private async handleUpgrade(request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): Promise<void> {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/gateway/edge') return;
    const token = bearerToken(request.headers.authorization);
    const identity = token ? await this.authenticator.authenticate(token) : null;
    if (!identity) { socket.destroy(); return; }
    this.sockets.handleUpgrade(request, socket, head, (websocket) => this.attach(websocket, identity));
  }

  private attach(socket: WebSocket, identity: RelayIdentity): void {
    const channel = { send: (message: string) => socket.send(message), close: () => socket.close() };
    this.registry.connect(identity, channel);
    socket.on('message', (data) => {
      try { this.registry.receive(identity.edgeId, JSON.parse(data.toString()) as unknown); }
      catch { socket.close(1008, 'Invalid gateway message'); }
    });
    socket.on('close', () => this.registry.disconnect(identity.edgeId, channel));
  }
}

export function bearerToken(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
  const token = value.slice(7).trim();
  return token && token.length <= 4096 ? token : null;
}

