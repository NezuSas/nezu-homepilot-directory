import { describe, expect, it } from 'vitest';
import { bearerToken } from '../infrastructure/CloudGatewaySocketServer.js';

describe('CloudGatewaySocketServer authorization header parsing', () => {
  it('accepts only a bounded Bearer token and does not accept alternate schemes', () => {
    expect(bearerToken('Bearer edge-token')).toBe('edge-token');
    expect(bearerToken('Basic edge-token')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
  });
});
