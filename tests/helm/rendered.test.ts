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

    it('does not let the start-up CPU spike of a rollout scale the API or frontend up', () => {
      for (const c of ['api', 'frontend']) {
        const hpa = objects.find((o) => o.kind === 'HorizontalPodAutoscaler' && o.metadata?.name === `openpm-${c}`)!;
        expect(hpa.spec.behavior?.scaleUp?.stabilizationWindowSeconds).toBeGreaterThanOrEqual(60);
      }
    });
  });

  it('pins app images by digest when one is set (releases do)', () => {
    const objects = render('--set', 'api.image.repository=ghcr.io/o/openpm-api', '--set', 'api.image.tag=1.2.3', '--set', 'api.image.digest=sha256:' + 'a'.repeat(64));
    const api = deployment(objects, 'api')!.spec.template.spec;
    const ref = 'ghcr.io/o/openpm-api:1.2.3@sha256:' + 'a'.repeat(64);
    expect(api.containers[0].image).toBe(ref);
    expect(api.initContainers[0].image).toBe(ref); // migrations run the same build
    expect(deployment(objects, 'worker')!.spec.template.spec.containers[0].image).toBe('openpm-worker:latest');
  });

  it('adds imagePullSecrets to every app pod, including the smoke test', () => {
    const objects = render('--set', 'global.imagePullSecrets[0].name=ghcr-pull');
    for (const c of ['api', 'worker', 'frontend']) {
      expect(deployment(objects, c)!.spec.template.spec.imagePullSecrets).toEqual([{ name: 'ghcr-pull' }]);
    }
    const job = objects.find((o) => o.kind === 'Job' && o.metadata?.name === 'openpm-smoke-test')!;
    expect(job.spec.template.spec.imagePullSecrets).toEqual([{ name: 'ghcr-pull' }]);
  });

  it('verifies each deployment with a post-sync smoke test that is allowed to reach the API and frontend', () => {
    const objects = render();
    const job = objects.find((o) => o.kind === 'Job' && o.metadata?.name === 'openpm-smoke-test') as K8sObject & { metadata: { annotations: Record<string, string> } };
    expect(job.metadata.annotations['argocd.argoproj.io/hook']).toBe('PostSync');
    expect(job.metadata.annotations['helm.sh/hook']).toBe('post-install,post-upgrade');
    const policy = objects.find((o) => o.kind === 'NetworkPolicy' && o.metadata?.name === 'openpm-smoke-test')!;
    expect(policy.spec.egress.map((e: any) => e.to[0].podSelector.matchLabels['app.kubernetes.io/component'])).toEqual(['api', 'frontend']);
    expect(render('--set', 'smokeTest.enabled=false').some((o) => o.kind === 'Job')).toBe(false);
  });

  it('appends extraEnv to the API and worker containers', () => {
    const objects = render('--set', 'api.extraEnv[0].name=BCRYPT_CONCURRENCY', '--set-string', 'api.extraEnv[0].value=4', '--set', 'worker.extraEnv[0].name=WORKER_CONCURRENCY', '--set-string', 'worker.extraEnv[0].value=10');
    const env = (c: string) => deployment(objects, c)!.spec.template.spec.containers[0].env as Array<{ name: string; value?: string }>;
    expect(env('api')).toContainEqual({ name: 'BCRYPT_CONCURRENCY', value: '4' });
    expect(env('worker')).toContainEqual({ name: 'WORKER_CONCURRENCY', value: '10' });
    expect(env('api').map((e) => e.name)).toContain('JWT_SECRET'); // the chart's own env is kept
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
