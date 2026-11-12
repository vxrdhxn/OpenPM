import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import client from 'prom-client';

// Importing db/client constructs a pg Pool (which does not connect until used); stub it anyway so
// this test can never open a connection.
vi.mock('pg', () => ({ Pool: vi.fn().mockImplementation(() => ({ on: vi.fn(), query: vi.fn(), connect: vi.fn() })) }));

import '../../apps/api/src/metrics';
import '../../apps/api/src/db/client';
// The worker's metrics live in another package; its names must be known to the dashboards too.
import { registerQueueMetrics } from '../../apps/worker/src/metrics';

/**
 * Guard against dashboard drift. Grafana shows an empty panel, with no error, when a query names a
 * metric or label that does not exist, so typos and renames go unnoticed. This checks every query
 * in helm/openpm/dashboards against the metrics the code really registers.
 *
 * It lives at the repo root (not inside a package) because it spans the API, the worker and the
 * Helm chart, and importing another package's source would break that package's tsc rootDir.
 */

const DASHBOARD_DIR = path.join(__dirname, '../../helm/openpm/dashboards');

interface Panel {
  id: number;
  type: string;
  title: string;
  gridPos: { h: number; w: number; x: number; y: number };
  targets?: Array<{ expr: string; legendFormat?: string; refId: string }>;
}
interface Dashboard {
  uid: string;
  title: string;
  panels: Panel[];
  templating: { list: Array<{ name: string; type: string }> };
}

const files = fs.readdirSync(DASHBOARD_DIR).filter((f) => f.endsWith('.json'));
const load = (file: string): Dashboard => JSON.parse(fs.readFileSync(path.join(DASHBOARD_DIR, file), 'utf8'));

// Labels Prometheus/the Operator attach to every scraped series.
const INFRA_LABELS = new Set(['namespace', 'job', 'pod', 'instance', 'service', 'container', 'endpoint']);
const OURS = /\b(?:http_|db_|auth_|websocket_|active_websocket|redis_|worker_|emails_|nodejs_|process_)[a-z0-9_]*/g;

let metricLabels: Map<string, string[]>; // base metric name -> its label names
let histograms: Set<string>;

beforeAll(() => {
  client.collectDefaultMetrics(); // nodejs_* and process_*
  registerQueueMetrics({ getJobCounts: async () => ({}), getWaiting: async () => [] });

  metricLabels = new Map();
  histograms = new Set();
  for (const m of client.register.getMetricsAsArray()) {
    const meta = m as unknown as { name: string; labelNames?: string[]; type?: string };
    metricLabels.set(meta.name, meta.labelNames ?? []);
    if (String(meta.type).toLowerCase() === 'histogram') histograms.add(meta.name);
  }
});

/** "http_request_duration_seconds_bucket" -> { base: "http_request_duration_seconds", ok: true } */
function resolveMetric(token: string): { base: string; known: boolean } {
  if (metricLabels.has(token)) return { base: token, known: true };
  for (const suffix of ['_bucket', '_sum', '_count']) {
    if (token.endsWith(suffix)) {
      const base = token.slice(0, -suffix.length);
      if (histograms.has(base)) return { base, known: true };
    }
  }
  return { base: token, known: false };
}

const labelsIn = (list: string) => list.split(',').map((s) => s.trim()).filter(Boolean);

describe.each(files)('dashboard %s', (file) => {
  const dash = load(file);
  const queries = dash.panels.flatMap((p) => (p.targets ?? []).map((t) => ({ panel: p, ...t })));
  const where = (q: { panel: Panel }) => `panel "${q.panel.title}"`;

  it('has a stable uid, a title and the standard variables', () => {
    expect(dash.uid).toMatch(/^[a-z0-9-]+$/);
    expect(dash.title).not.toBe('');
    expect(dash.templating.list.map((v) => v.name)).toEqual(['datasource', 'namespace', 'job']);
  });

  it('has unique panel ids', () => {
    const ids = dash.panels.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every panel inside the 24-column grid without overlaps', () => {
    const cells = new Set<string>();
    for (const p of dash.panels) {
      const { x, y, w, h } = p.gridPos;
      expect(x, p.title).toBeGreaterThanOrEqual(0);
      expect(x + w, p.title).toBeLessThanOrEqual(24);
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          const cell = `${x + dx},${y + dy}`;
          expect(cells.has(cell), `${p.title} overlaps another panel at ${cell}`).toBe(false);
          cells.add(cell);
        }
      }
    }
  });

  it('has variable queries that name real metrics and labels (else the dropdowns are silently empty)', () => {
    const problems: string[] = [];
    for (const v of dash.templating.list.filter((x) => x.type === 'query')) {
      const query = (v as unknown as { definition: string }).definition;
      const metric = (query.match(OURS) ?? [])[0];
      if (!metric || !resolveMetric(metric).known) {
        problems.push(`variable "${v.name}" queries unknown metric: ${query}`);
        continue;
      }
      // label_values(metric, label): the label must exist on that metric
      const label = query.match(/label_values\([^,]+,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/)?.[1];
      const allowed = new Set([...INFRA_LABELS, ...(metricLabels.get(resolveMetric(metric).base) ?? [])]);
      if (!label || !allowed.has(label)) problems.push(`variable "${v.name}" uses unknown label "${label}": ${query}`);
    }
    expect(problems).toEqual([]);
  });

  it('gives every data panel at least one query with distinct refIds', () => {
    for (const p of dash.panels.filter((x) => x.type !== 'row')) {
      expect(p.targets?.length, p.title).toBeGreaterThan(0);
      const refs = p.targets!.map((t) => t.refId);
      expect(new Set(refs).size, p.title).toBe(refs.length);
    }
  });

  it('queries only metrics that exist', () => {
    const unknown = queries.flatMap((q) =>
      (q.expr.match(OURS) ?? []).filter((t) => !resolveMetric(t).known).map((t) => `${t} (${where(q)})`)
    );
    expect(unknown).toEqual([]);
  });

  it('uses only labels that exist on the metrics it queries', () => {
    const problems: string[] = [];
    for (const q of queries) {
      const bases = (q.expr.match(OURS) ?? []).map((t) => resolveMetric(t).base);
      const allowed = new Set<string>([...INFRA_LABELS, 'le']);
      for (const b of bases) metricLabels.get(b)?.forEach((l) => allowed.add(l));

      // label names in selectors: metric{label="x", other=~"y"}
      for (const sel of q.expr.matchAll(/\{([^}]*)\}/g)) {
        for (const m of sel[1]!.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=~|!=|!~|=)/g)) {
          if (!allowed.has(m[1]!)) problems.push(`selector label "${m[1]}" (${where(q)})`);
        }
      }
      // label names in `by (...)`
      for (const by of q.expr.matchAll(/\bby\s*\(([^)]*)\)/g)) {
        for (const l of labelsIn(by[1]!)) if (!allowed.has(l)) problems.push(`by-label "${l}" (${where(q)})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('only references legend labels that survive the query', () => {
    const problems: string[] = [];
    for (const q of queries) {
      const bases = (q.expr.match(OURS) ?? []).map((t) => resolveMetric(t).base);
      const byLabels = [...q.expr.matchAll(/\bby\s*\(([^)]*)\)/g)].flatMap((m) => labelsIn(m[1]!));
      const survives = new Set<string>(byLabels);
      // Without any `by`, the raw series keep their own labels.
      if (byLabels.length === 0 && !/\b(?:sum|max|min|avg)\s*\(/.test(q.expr)) {
        for (const b of bases) metricLabels.get(b)?.forEach((l) => survives.add(l));
        INFRA_LABELS.forEach((l) => survives.add(l));
      }
      for (const m of (q.legendFormat ?? '').matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)) {
        if (!survives.has(m[1]!)) problems.push(`legend {{${m[1]}}} is dropped by the query (${where(q)})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('has balanced brackets and only defined $variables in every query', () => {
    const defined = new Set([...dash.templating.list.map((v) => v.name), '__rate_interval']);
    for (const q of queries) {
      for (const [open, close] of [['(', ')'], ['{', '}'], ['[', ']']] as const) {
        const count = (c: string) => q.expr.split(c).length - 1;
        expect(count(open), `${open}${close} in ${where(q)}: ${q.expr}`).toBe(count(close));
      }
      for (const v of q.expr.matchAll(/\$([A-Za-z_]+)/g)) {
        expect(defined.has(v[1]!), `unknown $${v[1]} in ${where(q)}`).toBe(true);
      }
    }
  });

  it('uses $__rate_interval for every rate(), never a hard-coded window', () => {
    for (const q of queries) {
      for (const m of q.expr.matchAll(/rate\([^)]*\[([^\]]+)\]\)/g)) {
        expect(m[1], where(q)).toBe('$__rate_interval');
      }
    }
  });
});

it('ships at least the API and worker dashboards', () => {
  expect(files).toEqual(expect.arrayContaining(['openpm-api.json', 'openpm-worker.json']));
});

it('gives each dashboard a different uid', () => {
  const uids = files.map((f) => load(f).uid);
  expect(new Set(uids).size).toBe(uids.length);
});
