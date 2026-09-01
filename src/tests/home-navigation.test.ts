import { describe, expect, it } from 'vitest';
import { enterHome, homePath } from '../web/navigation.js';

describe('home selector navigation', () => {
  it('posts the one-use SSO token to the selected Edge without putting it in the URL', () => {
    const input = { type: '', name: '', value: '' };
    const form = { method: '', action: '', hidden: false, append: () => undefined, submit: () => undefined };
    const documentRef = { createElement: (name: string) => name === 'form' ? form : input, body: { append: () => undefined } };
    enterHome({ edgeHostname: 'https://casa.example.com' }, 'short-lived token', documentRef as never);
    expect(homePath('https://casa.example.com')).toBe('https://casa.example.com/api/v1/auth/sso/directory/browser');
    expect(form.method).toBe('POST');
    expect(form.action).toBe('https://casa.example.com/api/v1/auth/sso/directory/browser');
    expect(input).toMatchObject({ name: 'token', value: 'short-lived token' });
  });
});