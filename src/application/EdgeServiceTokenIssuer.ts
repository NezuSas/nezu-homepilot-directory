import { createPrivateKey, createPublicKey, randomUUID, sign, type KeyObject } from 'node:crypto';
import { ValidationError } from '../domain/entities.js';

export const EDGE_SERVICE_TOKEN_TYPE = 'homepilot.edge-service-token.v1';
export const EDGE_SERVICE_TOKEN_KEY_ID = 'edge-service-v1';
export const EDGE_SERVICE_TOKEN_SCOPE = 'homepilot.manifest.read';
export const EDGE_SERVICE_COMMAND_SCOPE = 'homepilot.command.execute';
export const EDGE_SERVICE_TOKEN_TTL_SECONDS = 120;
export type EdgeServiceTokenScope = typeof EDGE_SERVICE_TOKEN_SCOPE | typeof EDGE_SERVICE_COMMAND_SCOPE;

export function parseEdgeServiceTokenScope(body: unknown): EdgeServiceTokenScope {
  if (body === undefined) return EDGE_SERVICE_TOKEN_SCOPE;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('EDGE_SERVICE_TOKEN_INVALID_REQUEST');
  const fields = Object.keys(body);
  if (fields.length === 0) return EDGE_SERVICE_TOKEN_SCOPE;
  if (fields.length !== 1 || fields[0] !== 'scope') throw new ValidationError('EDGE_SERVICE_TOKEN_INVALID_REQUEST');
  const scope = (body as { scope: unknown }).scope;
  if (scope !== EDGE_SERVICE_TOKEN_SCOPE && scope !== EDGE_SERVICE_COMMAND_SCOPE) throw new ValidationError('EDGE_SERVICE_TOKEN_INVALID_REQUEST');
  return scope;
}

export class EdgeServiceTokenIssuer {
  private constructor(private readonly privateKey: KeyObject) {}

  static fromEnvironment(): EdgeServiceTokenIssuer | null {
    const pem = process.env.DIRECTORY_EDGE_SERVICE_PRIVATE_KEY;
    if (!pem) return null;
    const key = createPrivateKey(pem.replace(/\\n/g, '\n'));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('DIRECTORY_EDGE_SERVICE_PRIVATE_KEY must be an Ed25519 private key.');
    return new EdgeServiceTokenIssuer(key);
  }

  publicKey(): string {
    return createPublicKey(this.privateKey).export({ type: 'spki', format: 'pem' }).toString();
  }

  issue(identity: { homeId: string; edgeId: string }, scope: EdgeServiceTokenScope = EDGE_SERVICE_TOKEN_SCOPE, now = Math.floor(Date.now() / 1000)): string {
    const payload = {
      type: EDGE_SERVICE_TOKEN_TYPE,
      issuer: 'homepilot-directory',
      audience: 'intentflow',
      keyId: EDGE_SERVICE_TOKEN_KEY_ID,
      scope,
      directoryHomeId: identity.homeId,
      directoryEdgeId: identity.edgeId,
      iat: now,
      exp: now + EDGE_SERVICE_TOKEN_TTL_SECONDS,
      jti: randomUUID(),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${sign(null, Buffer.from(encoded), this.privateKey).toString('base64url')}`;
  }
}
