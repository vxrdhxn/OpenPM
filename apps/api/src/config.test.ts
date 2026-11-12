import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// config.ts parses process.env at import time (and exits on failure), so each case sets the
// environment first and re-imports a fresh copy of the module.
async function loadConfig(env: Record<string, string>) {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('S3_') || key === 'ATTACHMENT_MAX_BYTES') delete process.env[key];
  }
  Object.assign(process.env, env);
  return (await import('./config')).config;
}

describe('config: attachment storage settings', () => {
  const saved = { ...process.env };
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('treats everything as unset by default (attachments disabled)', async () => {
    const config = await loadConfig({});

    expect(config.S3_BUCKET).toBeUndefined();
    expect(config.S3_ACCESS_KEY_ID).toBeUndefined();
    expect(config.S3_REGION).toBe('us-east-1');
    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
    expect(config.ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('accepts the blank values from a freshly copied .env.example', async () => {
    const config = await loadConfig({
      S3_ENDPOINT: '',
      S3_PUBLIC_ENDPOINT: '',
      S3_REGION: '',
      S3_BUCKET: '',
      S3_ACCESS_KEY_ID: '',
      S3_SECRET_ACCESS_KEY: '',
      S3_FORCE_PATH_STYLE: '',
      ATTACHMENT_MAX_BYTES: '',
    });

    expect(exit).not.toHaveBeenCalled();
    expect(config.S3_ENDPOINT).toBeUndefined();
    expect(config.S3_BUCKET).toBeUndefined();
    expect(config.S3_REGION).toBe('us-east-1');
    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
    expect(config.ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('parses real values', async () => {
    const config = await loadConfig({
      S3_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'openpm-attachments',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_FORCE_PATH_STYLE: 'true',
      ATTACHMENT_MAX_BYTES: '2048',
    });

    expect(config.S3_ENDPOINT).toBe('http://minio:9000');
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
    expect(config.ATTACHMENT_MAX_BYTES).toBe(2048);
  });

  it('still rejects genuinely invalid values', async () => {
    await expect(loadConfig({ S3_ENDPOINT: 'not a url' })).rejects.toThrow('process.exit');
    await expect(loadConfig({ ATTACHMENT_MAX_BYTES: '-5' })).rejects.toThrow('process.exit');
    await expect(loadConfig({ S3_FORCE_PATH_STYLE: 'yes' })).rejects.toThrow('process.exit');
  });
});
