import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

const parse = (env: Record<string, string>) => parseConfig(env as NodeJS.ProcessEnv);

function config(env: Record<string, string>) {
  const result = parse(env);
  if (!result.ok) throw new Error(`expected a valid config: ${JSON.stringify(result.errors)}`);
  return result.config;
}

function errors(env: Record<string, string>) {
  const result = parse(env);
  if (result.ok) throw new Error('expected the environment to be rejected');
  return result.errors;
}

describe('worker config', () => {
  it('runs out of the box in development', () => {
    expect(config({})).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://openpm:openpm@localhost:5432/openpm',
      REDIS_URL: 'redis://localhost:6379',
      LOG_LEVEL: 'info',
      WORKER_CONCURRENCY: 5,
      METRICS_PORT: 9100,
      DUE_REMINDER_INTERVAL_MINUTES: 15,
      NOTIFICATION_RETENTION_DAYS: 90,
      APP_URL: 'http://localhost:3001',
      EMAIL_FROM_ADDRESS: 'notifications@openpm.local',
    });
  });

  it('accepts the blank values from a freshly copied .env.example', () => {
    const c = config({ RESEND_API_KEY: '', LOG_LEVEL: '', WORKER_CONCURRENCY: '', APP_URL: '', EMAIL_FROM_ADDRESS: '' });
    expect(c.RESEND_API_KEY).toBeUndefined();
    expect(c.LOG_LEVEL).toBe('info');
    expect(c.WORKER_CONCURRENCY).toBe(5);
  });

  it('reads every setting', () => {
    const c = config({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://openpm:openpm@localhost:5433/openpm',
      REDIS_URL: 'redis://:openpm@localhost:6380/0',
      LOG_LEVEL: 'warn',
      WORKER_CONCURRENCY: '12',
      METRICS_PORT: '9200',
      APP_URL: ' https://pm.example.com// ',
      RESEND_API_KEY: 're_123',
      EMAIL_FROM_ADDRESS: 'pm@example.com',
    });
    expect(c).toMatchObject({ WORKER_CONCURRENCY: 12, METRICS_PORT: 9200, LOG_LEVEL: 'warn', RESEND_API_KEY: 're_123' });
    expect(c.APP_URL).toBe('https://pm.example.com');
  });

  it('requires APP_URL in production, so emails never carry localhost links', () => {
    expect(errors({ NODE_ENV: 'production' }).APP_URL).toEqual(['APP_URL is required when NODE_ENV=production']);
    expect(errors({ NODE_ENV: 'production', APP_URL: '' }).APP_URL).toBeDefined();
  });

  it.each([
    ['LOG_LEVEL', 'verbose'],
    ['WORKER_CONCURRENCY', '0'],
    ['WORKER_CONCURRENCY', 'lots'],
    ['METRICS_PORT', '70000'],
    ['METRICS_PORT', 'x'],
    ['DUE_REMINDER_INTERVAL_MINUTES', '0'],
    ['NOTIFICATION_RETENTION_DAYS', '-1'],
    ['APP_URL', 'pm.example.com'],
    ['DATABASE_URL', 'not a url'],
    ['REDIS_URL', 'not a url'],
    ['EMAIL_FROM_ADDRESS', 'nobody'],
    ['NODE_ENV', 'staging'],
  ])('refuses %s=%j instead of falling back silently', (key, value) => {
    expect(errors({ [key]: value })[key]).toBeDefined();
  });

  it('does not treat a blank DATABASE_URL as unset', () => {
    expect(errors({ DATABASE_URL: '' }).DATABASE_URL).toBeDefined();
  });
});
