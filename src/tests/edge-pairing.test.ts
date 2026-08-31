import { describe, expect, it } from 'vitest';
import { EdgePairingError, consumePairingChallenge, issuePairingChallenge } from '../application/EdgePairing.js';

const identity = { homeId: 'home-a', edgeId: 'edge-a' };
const now = new Date('2030-01-01T00:00:00.000Z');

function expectCode(run: () => unknown, code: EdgePairingError['code']): void {
  try { run(); throw new Error('Expected pairing rejection.'); }
  catch (error) { expect(error).toBeInstanceOf(EdgePairingError); expect(error).toMatchObject({ code }); }
}

describe('Edge pairing', () => {
  it('issues a high-entropy code while persisting only its hash', () => {
    const issued = issuePairingChallenge(identity, now);
    expect(issued.code).not.toContain(issued.challenge.codeHash);
    expect(issued.challenge).toMatchObject({ ...identity, consumedAt: null });
  });

  it('consumes the code once and preserves the exact bound Edge identity', () => {
    const issued = issuePairingChallenge(identity, now);
    const consumed = consumePairingChallenge(issued.challenge, issued.code, now);
    expect(consumed).toMatchObject({ ...identity, consumedAt: now.toISOString() });
    expectCode(() => consumePairingChallenge(consumed, issued.code, now), 'EDGE_PAIRING_USED');
  });

  it('rejects incorrect and expired codes without consuming the record', () => {
    const issued = issuePairingChallenge(identity, now, 1_000);
    expectCode(() => consumePairingChallenge(issued.challenge, 'other', now), 'EDGE_PAIRING_INVALID');
    expectCode(() => consumePairingChallenge(issued.challenge, issued.code, new Date(now.getTime() + 1_001)), 'EDGE_PAIRING_EXPIRED');
  });
});
