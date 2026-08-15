import { describe, expect, it } from 'vitest';
import { invitationDecisionPath } from '../web/invitations.js';

describe('invitation decision path', () => {
  it('builds the exact accept and reject endpoints for the invitation token', () => {
    expect(invitationDecisionPath('token/with space', 'accept')).toBe('/directory/invitations/token%2Fwith%20space/accept');
    expect(invitationDecisionPath('token/with space', 'reject')).toBe('/directory/invitations/token%2Fwith%20space/reject');
  });
});
