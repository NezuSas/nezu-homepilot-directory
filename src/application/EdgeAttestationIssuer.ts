import { createPrivateKey, createPublicKey, randomUUID, sign, type KeyObject } from 'node:crypto';
import { ValidationError } from '../domain/entities.js';

export const EDGE_ATTESTATION_TYPE = 'homepilot.edge-attestation.v1';
export const EDGE_ATTESTATION_KEY_ID = 'edge-attestation-v1';
export const EDGE_ATTESTATION_TTL_SECONDS = 90;

export interface EdgeAttestationChallenge {
  installationId: string;
  challengeId: string;
  nonce: string;
}

export function validateEdgeAttestationChallenge(value: unknown): EdgeAttestationChallenge {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('EDGE_ATTESTATION_INVALID_CHALLENGE');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 3 ||
      !isUuid(body.installationId) || !isUuid(body.challengeId) ||
      typeof body.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.nonce) ||
      Buffer.from(body.nonce, 'base64url').length !== 32 ||
      Buffer.from(body.nonce, 'base64url').toString('base64url') !== body.nonce) {
    throw new ValidationError('EDGE_ATTESTATION_INVALID_CHALLENGE');
  }
  return { installationId: body.installationId, challengeId: body.challengeId, nonce: body.nonce };
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export class EdgeAttestationIssuer {
  private constructor(private readonly privateKey: KeyObject) {}

  static fromEnvironment(): EdgeAttestationIssuer | null {
    const pem = process.env.DIRECTORY_EDGE_ATTESTATION_PRIVATE_KEY;
    if (!pem) return null;
    const key = createPrivateKey(pem.replace(/\\n/g, '\n'));
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('DIRECTORY_EDGE_ATTESTATION_PRIVATE_KEY must be an Ed25519 private key.');
    return new EdgeAttestationIssuer(key);
  }

  publicKey(): string {
    return createPublicKey(this.privateKey).export({ type: 'spki', format: 'pem' }).toString();
  }

  issue(challenge: EdgeAttestationChallenge, identity: { homeId: string; edgeId: string }, now = Math.floor(Date.now() / 1000)): string {
    const payload = {
      type: EDGE_ATTESTATION_TYPE,
      issuer: 'homepilot-directory',
      audience: 'intentflow',
      keyId: EDGE_ATTESTATION_KEY_ID,
      installationId: challenge.installationId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      directoryHomeId: identity.homeId,
      directoryEdgeId: identity.edgeId,
      iat: now,
      exp: now + EDGE_ATTESTATION_TTL_SECONDS,
      jti: randomUUID(),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${sign(null, Buffer.from(encoded), this.privateKey).toString('base64url')}`;
  }
}
