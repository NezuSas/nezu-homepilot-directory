import { describe, expect, it, vi } from 'vitest';
import { enterHome, homePath } from '../web/navigation.js';

describe('home selector navigation', () => {
  it('AC1 keeps an authorized selection on the same public domain route without any network request', () => {
    const assign = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    enterHome('home/with space', { assign });
    expect(homePath('home/with space')).toBe('/homes/home%2Fwith%20space');
    expect(assign).toHaveBeenCalledWith('/homes/home%2Fwith%20space');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});