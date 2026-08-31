import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RelayIdentity } from './CloudGatewayProtocol.js';

export interface EdgePairingChallenge extends RelayIdentity {
  codeHash: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface IssuedPairingChallenge {
  code: string;
  challenge: EdgePairingChallenge;
}

export class EdgePairingError extends Error {
  constructor(public readonly code: 'EDGE_PAIRING_EXPIRED' | 'EDGE_PAIRING_INVALID' | 'EDGE_PAIRING_USED') { super(code); }
}

export function issuePairingChallenge(identity: RelayIdentity, now = new Date(), ttlMs = 10 * 60 * 1000): IssuedPairingChallenge {
  const code = randomBytes(24).toString('base64url');
  return { code, challenge: { ...identity, codeHash: hashCode(code), expiresAt: new Date(now.getTime() + ttlMs).toISOString(), consumedAt: null } };
}

export function consumePairingChallenge(challenge: EdgePairingChallenge, code: string, now = new Date()): EdgePairingChallenge {
  if (challenge.consumedAt) throw new EdgePairingError('EDGE_PAIRING_USED');
  if (Date.parse(challenge.expiresAt) <= now.getTime()) throw new EdgePairingError('EDGE_PAIRING_EXPIRED');
  const expected = Buffer.from(challenge.codeHash, 'hex'); const actual = Buffer.from(hashCode(code), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new EdgePairingError('EDGE_PAIRING_INVALID');
  return { ...challenge, consumedAt: now.toISOString() };
}

function hashCode(code: string): string { return createHash('sha256').update(code).digest('hex'); }
