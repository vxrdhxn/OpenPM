import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBaseUrl, websocketUrl } from './endpoints';

describe('endpoints', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const production = () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');
  };

  describe('a production build with nothing configured (one image for every domain)', () => {
    it('calls the API on the same origin', () => {
      production();
      expect(apiBaseUrl()).toBe('/api');
    });

    it('opens the socket on the same host, upgrading to wss behind https', () => {
      production();
      expect(websocketUrl({ protocol: 'https:', host: 'pm.example.com' })).toBe('wss://pm.example.com/ws');
      expect(websocketUrl({ protocol: 'http:', host: 'openpm.local:8080' })).toBe('ws://openpm.local:8080/ws');
    });
  });

  it('uses build-time URLs when they are set (e.g. Docker Compose)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:3000/api');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', 'ws://localhost:3000/ws');

    expect(apiBaseUrl()).toBe('http://localhost:3000/api');
    expect(websocketUrl({ protocol: 'http:', host: 'localhost:3001' })).toBe('ws://localhost:3000/ws');
  });

  it('points the dev server at the local API', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    vi.stubEnv('NEXT_PUBLIC_WS_URL', '');

    expect(apiBaseUrl()).toBe('http://localhost:3000/api');
    expect(websocketUrl({ protocol: 'http:', host: 'localhost:3001' })).toBe('ws://localhost:3000/ws');
  });
});
