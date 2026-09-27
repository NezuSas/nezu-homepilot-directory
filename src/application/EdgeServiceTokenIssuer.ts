import { createPrivateKey, createPublicKey, randomUUID, sign, type KeyObject } from 'node:crypto';

export const EDGE_SERVICE_TOKEN_TYPE = 'homepilot.edge-service-token.v1';
export const EDGE_SERVICE_TOKEN_KEY_ID = 'edge-service-v1';
export const EDGE_SERVICE_TOKEN_SCOPE = 'homepilot.manifest.read';
export const EDGE_SERVICE_TOKEN_TTL_SECONDS = 120;

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

  issue(identity: { homeId: string; edgeId: string }, now = Math.floor(Date.now() / 1000)): string {
    const payload = {
      type: EDGE_SERVICE_TOKEN_TYPE,
      issuer: 'homepilot-directory',
      audience: 'intentflow',
      keyId: EDGE_SERVICE_TOKEN_KEY_ID,
      scope: EDGE_SERVICE_TOKEN_SCOPE,
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
