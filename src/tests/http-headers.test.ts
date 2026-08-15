import { describe, expect, it } from 'vitest';
import { buildApiHeaders } from '../web/httpHeaders.js';

describe('buildApiHeaders', () => {
  it('omits content-type when the request has no body, avoiding an empty-JSON-body 400', () => {
    expect(buildApiHeaders(false, null)).toEqual({});
  });

  it('sets content-type only when a body is present', () => {
    expect(buildApiHeaders(true, null)).toEqual({ 'content-type': 'application/json' });
  });

  it('attaches the bearer token when present, regardless of body', () => {
    expect(buildApiHeaders(false, 'abc')).toEqual({ authorization: 'Bearer abc' });
    expect(buildApiHeaders(true, 'abc')).toEqual({ 'content-type': 'application/json', authorization: 'Bearer abc' });
  });
});
