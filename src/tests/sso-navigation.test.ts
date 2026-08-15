import { describe, expect, it, vi } from 'vitest';
import { ssoTokenRequestPath, ssoRedirectUrl, enterHome } from '../web/navigation.js';

describe('sso navigation', () => {
  it('builds the exact sso-token request path for a home id', () => {
    expect(ssoTokenRequestPath('home/with space')).toBe('/directory/homes/home%2Fwith%20space/sso-token');
  });

  it('builds the exact redirect url with the signed token attached', () => {
    expect(ssoRedirectUrl('https://homepilot-oscar.nezuecuador.com', 'abc.def')).toBe(
      'https://homepilot-oscar.nezuecuador.com/sso/directory?token=abc.def',
    );
  });

  it('navigates only to the built redirect url without any authenticated network request', () => {
    const assign = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    enterHome(ssoRedirectUrl('https://homepilot-oscar.nezuecuador.com', 'abc.def'), { assign });
    expect(assign).toHaveBeenCalledWith('https://homepilot-oscar.nezuecuador.com/sso/directory?token=abc.def');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
