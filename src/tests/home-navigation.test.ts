import { describe, expect, it, vi } from 'vitest';
import { enterHome } from '../web/navigation.js';

describe('home selector navigation', () => {
  it('AC5 navigates only to the exact Edge hostname without any authenticated network request', () => {
    const assign = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    enterHome('https://oscar.homepilot.example', { assign });
    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('https://oscar.homepilot.example');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
