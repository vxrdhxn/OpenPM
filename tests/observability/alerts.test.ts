import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';
import client from 'prom-client';

// Importing db/client constructs a pg Pool (which does not connect until used); stub it anyway so
// this test can never open a connection.
vi.mock('pg', () => ({ Pool: vi.fn().mockImplementation(function () { return { on: vi.fn(), query: vi.fn(), connect: vi.fn() }; }) }));

import '../../apps/api/src/metrics';
import '../../apps/api/src/db/client';
import { registerQueueMetrics } from '../../apps/worker/src/metrics';

/**
 * Guard against alert drift. An alert whose expression names a metric or label that no longer exists
 * never fires and never errors, which is the worst way for an alert to fail. This checks every rule in
 * helm/openpm/alerts against the metrics the code really registers. (The behaviour of the rules is
 * covered separately by promtool in alerts.promtool.yaml.)
 */

const RULES_FILE = path.join(__dirname, '../../helm/openpm/alerts/openpm.rules.yaml');

interface Rule {
  alert: string;
  expr: string;
  for?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}
const doc = parse(fs.readFileSync(RULES_FILE, 'utf8')) as { groups: Array<{ name: string; rules: Rule[] }> };
const rules = doc.groups.flatMap((g) => g.rules);

// Labels Prometheus/the Operator attach to every scraped series (`up` has only these).
const INFRA_LABELS = new Set(['namespace', 'job', 'pod', 'instance', 'service', 'container', 'endpoint']);
const OURS = /\b(?:http_|db_|auth_|websocket_|active_websocket|redis_|worker_|emails_|nodejs_|process_)[a-z0-9_]*/g;

let metricLabels: Map<string, string[]>;
let histograms: Set<string>;

beforeAll(() => {
  client.collectDefaultMetrics();
  registerQueueMetrics({ getJobCounts: async () => ({}), getWaiting: async () => [] });
  metricLabels = new Map();
  histograms = new Set();
  for (const m of client.register.getMetricsAsArray()) {
    const meta = m as unknown as { name: string; labelNames?: string[]; type?: string };
    metricLabels.set(meta.name, meta.labelNames ?? []);
    if (String(meta.type).toLowerCase() === 'histogram') histograms.add(meta.name);
  }
});

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

/** Every `metric{...}` selector in an expression, with the label names it filters on. */
function selectors(expr: string): Array<{ metric: string; labels: string[] }> {
  const out: Array<{ metric: string; labels: string[] }> = [];
  for (const m of expr.matchAll(/\b([a-zA-Z_:][a-zA-Z0-9_:]*)\s*\{([^}]*)\}/g)) {
    const labels = [...m[2].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=~|!~|!=|=)/g)].map((x) => x[1]);
    out.push({ metric: m[1], labels });
  }
  return out;
}

describe('alert rules', () => {
  it('defines rules, with unique alert names', () => {
    expect(rules.length).toBeGreaterThan(0);
    const names = rules.map((r) => r.alert);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(rules.map((r) => [r.alert, r] as const))('%s has a severity, summary and description', (_name, rule) => {
    expect(['warning', 'critical']).toContain(rule.labels?.severity);
    expect(rule.annotations?.summary, 'summary').toBeTruthy();
    expect(rule.annotations?.description, 'description').toBeTruthy();
    expect(rule.alert).toMatch(/^OpenPM[A-Za-z0-9]+$/);
  });

  it('queries only metrics that exist', () => {
    const unknown = rules.flatMap((r) =>
      (r.expr.match(OURS) ?? []).filter((t) => !resolveMetric(t).known).map((t) => `${t} (${r.alert})`)
    );
    expect(unknown).toEqual([]);
  });

  it('filters only on labels that exist on the metric (else the selector matches nothing, silently)', () => {
    const problems: string[] = [];
    for (const r of rules) {
      for (const sel of selectors(r.expr)) {
        const known = sel.metric === 'up'
          ? INFRA_LABELS
          : new Set([...INFRA_LABELS, ...(metricLabels.get(resolveMetric(sel.metric).base) ?? [])]);
        for (const label of sel.labels) {
          if (!known.has(label)) problems.push(`${r.alert}: ${sel.metric} has no label "${label}"`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('groups ("by") only by labels that exist on the queried metrics', () => {
    const problems: string[] = [];
    for (const r of rules) {
      const allowed = new Set<string>([...INFRA_LABELS, 'le']);
      for (const t of r.expr.match(OURS) ?? []) {
        for (const l of metricLabels.get(resolveMetric(t).base) ?? []) allowed.add(l);
      }
      for (const m of r.expr.matchAll(/\bby\s*\(([^)]*)\)/g)) {
        for (const label of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!allowed.has(label)) problems.push(`${r.alert}: groups by unknown label "${label}"`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('only uses annotation labels that the expression keeps ($labels.x must survive the aggregation)', () => {
    const problems: string[] = [];
    for (const r of rules) {
      const kept = new Set<string>();
      let aggregated = false;
      for (const m of r.expr.matchAll(/\bby\s*\(([^)]*)\)/g)) {
        aggregated = true;
        for (const l of m[1].split(',')) kept.add(l.trim());
      }
      if (!aggregated) continue; // raw series keep every label
      for (const text of Object.values(r.annotations ?? {})) {
        for (const m of text.matchAll(/\$labels\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
          if (!kept.has(m[1])) problems.push(`${r.alert}: annotation uses $labels.${m[1]} but the expression drops it`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
