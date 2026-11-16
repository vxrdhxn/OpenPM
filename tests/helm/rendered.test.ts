import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';

/**
 * Renders the chart and checks what `helm lint` / `helm template` don't: every object is valid enough
 * for the API server, and the properties a real install depends on (found by installing on kind, G.4).
 *
 * Needs `helm` on PATH (CI installs it). Locally the suite is skipped without helm; in CI a missing
 * helm fails instead of skipping.
 */
const CHART = path.join(__dirname, '../../helm/openpm');

function helmAvailable(): boolean {
  try {
    execFileSync('helm', ['version', '--short'], { stdio: 'ignore' });
    return true;
  } catch {
    if (process.env.CI) throw new Error('helm is required in CI for tests/helm');
    return false;
  }
}

type K8sObject = {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string };
  spec?: any;
};

function render(...args: string[]): K8sObject[] {
  const out = execFileSync('helm', ['template', 'openpm', CHART, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return parseAllDocuments(out)
    .map((d) => d.toJS() as K8sObject | null)
    .filter((o): o is K8sObject => o !== null);
}

const VARIANTS: Record<string, string[]> = {
  defaults: [],
  production: ['-f', path.join(CHART, 'values.prod.yaml')],
  monitoring: ['--set', 'serviceMonitor.enabled=true', '--set', 'prometheusRule.enabled=true', '--set', 'grafana.dashboards.enabled=true'],
};

const deployment = (objects: K8sObject[], component: string) =>
  objects.find((o) => o.kind === 'Deployment' && o.metadata?.name === `openpm-${component}`);

describe.skipIf(!helmAvailable())('rendered Helm chart', () => {
  describe.each(Object.entries(VARIANTS))('%s values', (_name, args) => {
    const objects = render(...args);

    it('renders only complete objects (apiVersion, kind, name)', () => {
      expect(objects.length).toBeGreaterThan(10);
      const incomplete = objects.filter((o) => !o.apiVersion || !o.kind || !o.metadata?.name);
      expect(incomplete).toEqual([]);
    });

    it('rolls the API, worker and frontend pods when config or secrets change', () => {
      for (const c of ['api', 'worker', 'frontend']) {
        const annotations = deployment(objects, c)!.spec.template.metadata.annotations ?? {};
        expect(annotations['checksum/config'], c).toMatch(/^[0-9a-f]{64}$/);
        expect(annotations['checksum/secrets'], c).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('migrates the database before the API starts', () => {
      const init = deployment(objects, 'api')!.spec.template.spec.initContainers ?? [];
      expect(init.map((c: { name: string }) => c.name)).toContain('migrate');
      expect(init[0].command).toEqual(['node', 'apps/api/dist/db/migrate.js', 'up']);
    });

    it('keeps dependency checks out of the API liveness probe (an outage must not restart every pod)', () => {
      const api = deployment(objects, 'api')!.spec.template.spec.containers[0];
      expect(api.livenessProbe.httpGet.path).toBe('/health/live');
      expect(api.readinessProbe.httpGet.path).toBe('/health');
    });

    it('renders a controller-neutral Ingress (no deprecated class annotation)', () => {
      const ingress = objects.find((o) => o.kind === 'Ingress') as K8sObject & { metadata: { annotations?: Record<string, string> } };
      expect(ingress).toBeDefined();
      expect(ingress.metadata.annotations?.['kubernetes.io/ingress.class']).toBeUndefined();
      expect(ingress.spec.ingressClassName).toBeUndefined(); // the cluster default
      const paths = ingress.spec.rules[0].http.paths.map((p: { path: string }) => p.path);
      expect(paths).toEqual(['/', '/api', '/ws']);
    });

    it('gives the frontend no runtime NEXT_PUBLIC_* (they are build-time only)', () => {
      const env = deployment(objects, 'frontend')!.spec.template.spec.containers[0].env ?? [];
      expect(env.map((e: { name: string }) => e.name).filter((n: string) => n.startsWith('NEXT_PUBLIC_'))).toEqual([]);
    });
  });

  it('runs the in-chart Postgres as its own non-root user', () => {
    const pg = deployment(render(), 'postgres')!.spec.template.spec;
    expect(pg.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 70, fsGroup: 70 });
    expect(pg.containers[0].env).toContainEqual({ name: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' });
  });

  it('can turn the migration init container off', () => {
    const api = deployment(render('--set', 'api.migrations.enabled=false'), 'api')!;
    expect(api.spec.template.spec.initContainers).toBeUndefined();
  });
});
