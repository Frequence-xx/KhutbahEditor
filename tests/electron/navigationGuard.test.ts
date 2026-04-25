import { describe, it, expect } from 'vitest';

/**
 * Pure-logic tests for the navigation guard. We don't actually launch
 * Electron; we test the URL-parsing/origin-comparison logic directly.
 */
describe('Electron navigation guard origin check', () => {
  function isAllowedDev(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.origin === 'http://localhost:5173';
    } catch {
      return false;
    }
  }

  it('allows the exact dev origin', () => {
    expect(isAllowedDev('http://localhost:5173/')).toBe(true);
    expect(isAllowedDev('http://localhost:5173/some/path')).toBe(true);
  });

  it('denies subdomain trick', () => {
    expect(isAllowedDev('http://localhost:5173.evil.test/foo')).toBe(false);
  });

  it('denies userinfo trick', () => {
    expect(isAllowedDev('http://localhost:5173@evil.test/foo')).toBe(false);
  });

  it('denies unrelated hosts', () => {
    expect(isAllowedDev('https://evil.test/')).toBe(false);
  });

  it('denies different ports', () => {
    expect(isAllowedDev('http://localhost:5174/')).toBe(false);
  });

  it('denies invalid URL strings', () => {
    expect(isAllowedDev('not-a-url')).toBe(false);
    expect(isAllowedDev('')).toBe(false);
  });
});
