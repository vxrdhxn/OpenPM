import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// config.ts parses process.env at import time (and exits on failure), so each case sets the
// environment first and re-imports a fresh copy of the module.
async function loadConfig(env: Record<string, string>) {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('S3_') || key === 'ATTACHMENT_MAX_BYTES') delete process.env[key];
  }
  Object.assign(process.env, env);
  return (await import('./config.js')).config;
}

describe('config: attachment storage settings', () => {
  const saved = { ...process.env };
  let exit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never) as unknown as ReturnType<typeof vi.fn>;
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

describe('config: JWT secret', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.doUnmock('dotenv');
  });

  async function secretWith(env: Record<string, string | undefined>) {
    vi.resetModules();
    // config.ts loads the repository's .env, which would put a developer's JWT_SECRET back.
    vi.doMock('dotenv', () => ({ default: { config: () => ({}) } }));
    delete process.env.JWT_SECRET;
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    const { getJwtSecret } = await import('./config.js');
    return getJwtSecret;
  }

  it('uses the development key outside production', async () => {
    expect((await secretWith({ NODE_ENV: 'development' }))()).toHaveLength(50);
  });

  it('requires a secret in production', async () => {
    expect(await secretWith({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET is required/);
  });

  it.each([
    'super_secret_development_key_change_me_in_prod_123',
    'some_super_secret_jwt_key_that_is_long_enough',
    'change_me_to_something_super_secret_and_long_enough_32_chars',
  ])('refuses the published example secret %s in production', async (published) => {
    expect(await secretWith({ NODE_ENV: 'production', JWT_SECRET: published })).toThrow(/published in the OpenPM repository/);
  });

  it('accepts a real secret in production', async () => {
    const real = 'only-for-this-test-a-real-one-comes-from-openssl-rand';
    expect((await secretWith({ NODE_ENV: 'production', JWT_SECRET: real }))()).toBe(real);
  });
});

describe('config: TRUST_PROXY', () => {
  it('is off unless set, so clients reaching the API directly cannot pick their address', async () => {
    const { trustProxySetting } = await import('./config.js');
    expect(trustProxySetting(undefined)).toBe(false);
    const oneHop = trustProxySetting('1') as (a: string, hop: number) => boolean;
    expect([oneHop('10.0.0.5', 0), oneHop('10.0.0.6', 1)]).toEqual([true, false]);
    expect(trustProxySetting('10.0.0.0/8, 192.168.1.4')).toEqual(['10.0.0.0/8', '192.168.1.4']);
  });
});

describe('signupNeedsVerification', () => {
  it('verifies in auto mode exactly when an email provider is configured', async () => {
    const { signupNeedsVerification } = await import('./config.js');
    expect(signupNeedsVerification({ SIGNUP_VERIFICATION: 'auto', RESEND_API_KEY: undefined })).toBe(false);
    expect(signupNeedsVerification({ SIGNUP_VERIFICATION: 'auto', RESEND_API_KEY: 're_123' })).toBe(true);
    expect(signupNeedsVerification({ SIGNUP_VERIFICATION: 'required', RESEND_API_KEY: undefined })).toBe(true);
    expect(signupNeedsVerification({ SIGNUP_VERIFICATION: 'off', RESEND_API_KEY: 're_123' })).toBe(false);
  });
});
