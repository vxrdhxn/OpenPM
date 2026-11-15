import { describe, expect, it } from 'vitest';
import { appUrl } from './appUrl';

describe('appUrl', () => {
  it('uses APP_URL without a trailing slash', () => {
    expect(appUrl({ APP_URL: 'https://pm.example.com//' } as NodeJS.ProcessEnv)).toBe('https://pm.example.com');
  });

  it('falls back to localhost outside production', () => {
    expect(appUrl({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe('http://localhost:3001');
  });

  it('refuses to build links in production without APP_URL', () => {
    expect(() => appUrl({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow('APP_URL');
  });
});
