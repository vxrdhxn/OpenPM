import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../cache/redis', () => ({ cache: { get: vi.fn(), getRaw: vi.fn(), set: vi.fn(), del: vi.fn(), publish: vi.fn(), subscribe: vi.fn(), ping: vi.fn() } }));
vi.mock('../queue', () => ({ getJobQueue: () => ({ add: vi.fn() }) }));

import { buildApp } from '../app';

/**
 * The OpenAPI spec is generated from the routes' own JSON Schemas, so it cannot drift from what the
 * API validates. This test (1) holds every route to the validation rules in docs/api.md and (2) keeps
 * docs/openapi.json, the committed copy, current: UPDATE_OPENAPI=1 npm test rewrites it.
 */
const SPEC_FILE = path.join(__dirname, '../../../../docs/openapi.json');

type Op = { requestBody?: { content?: Record<string, { schema?: Record<string, unknown> }> }; parameters?: Array<{ in: string; name: string }> };

describe('OpenAPI spec', () => {
  let spec: { paths: Record<string, Record<string, Op>> };
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    app = buildApp({ logger: false });
    await app.ready();
    spec = JSON.parse(JSON.stringify(app.swagger())) as typeof spec;
  });

  afterAll(async () => {
    await app.close();
  });

  const operations = () =>
    Object.entries(spec.paths).flatMap(([route, methods]) => Object.entries(methods).map(([method, op]) => ({ route, method, op })));

  it('validates the body of every route that takes one, and refuses unknown keys', () => {
    const problems: string[] = [];
    for (const { route, method, op } of operations()) {
      if (!['post', 'put', 'patch'].includes(method)) continue;
      const schema = op.requestBody?.content?.['application/json']?.schema;
      // A few actions take no body at all (mark read, leave, logout, ...).
      if (!schema) continue;
      if (schema.additionalProperties !== false) problems.push(`${method.toUpperCase()} ${route}: body accepts unknown keys`);
    }
    expect(problems).toEqual([]);
  });

  it('declares every path parameter', () => {
    const problems: string[] = [];
    for (const { route, method, op } of operations()) {
      for (const name of [...route.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])) {
        if (!op.parameters?.some((p) => p.in === 'path' && p.name === name)) problems.push(`${method.toUpperCase()} ${route}: {${name}} undeclared`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('is committed as docs/openapi.json, current', () => {
    const text = JSON.stringify(spec, null, 2) + '\n';
    if (process.env.UPDATE_OPENAPI) fs.writeFileSync(SPEC_FILE, text);
    const committed = fs.existsSync(SPEC_FILE) ? fs.readFileSync(SPEC_FILE, 'utf8').replace(/\r\n/g, '\n') : '';
    expect(committed, 'docs/openapi.json is stale: run UPDATE_OPENAPI=1 npm test in apps/api').toBe(text);
  });
});
