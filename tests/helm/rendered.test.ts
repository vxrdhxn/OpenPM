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

// The chart has no default credentials; tests supply throwaway ones (renderBare does not).
const TEST_SECRETS = ['--set', 'secrets.jwtSecret=' + 'x'.repeat(40), '--set', 'secrets.postgres.password=pg-test', '--set', 'secrets.redis.password=redis-test'];

function renderBare(...args: string[]): K8sObject[] {
  const out = execFileSync('helm', ['template', 'openpm', CHART, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return parseAllDocuments(out)
    .map((d) => d.toJS() as K8sObject | null)
    .filter((o): o is K8sObject => o !== null);
}

const render = (...args: string[]) => renderBare(...TEST_SECRETS, ...args);

function renderError(...args: string[]): string {
  try {
    renderBare(...args);
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err);
  }
  throw new Error('expected helm template to fail');
}

const VARIANTS: Record<string, string[]> = {
  defaults: [],
  production: ['-f', path.join(CHART, 'values.prod.yaml')], // credentials from existingSecret
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

    it('passes the storage origin to the frontend for its Content-Security-Policy only when set', () => {
      const envOf = (objs: K8sObject[]) =>
        (deployment(objs, 'frontend')!.spec.template.spec.containers[0].env ?? []).find((e: { name: string }) => e.name === 'CSP_CONNECT_SRC');
      expect(envOf(objects)).toBeUndefined();
      expect(envOf(render('--set', 'frontend.cspConnectSrc=https://files.example.com'))).toEqual({
        name: 'CSP_CONNECT_SRC',
        value: 'https://files.example.com',
      });
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

  describe('credentials', () => {
    it('refuses to render without a JWT secret, or with one published in this repository', () => {
      expect(renderError()).toMatch(/secrets\.jwtSecret must be set/);
      for (const published of ['change_me_to_something_super_secret_and_long_enough_32_chars', 'super_secret_development_key_change_me_in_prod_123']) {
        expect(renderError(...TEST_SECRETS, '--set', `secrets.jwtSecret=${published}`)).toMatch(/secrets\.jwtSecret must be set/);
      }
      expect(renderError(...TEST_SECRETS, '--set', 'secrets.jwtSecret=short')).toMatch(/at least 32/);
    });

    it('refuses to render in-chart Postgres or Redis without a password', () => {
      expect(renderError(...TEST_SECRETS, '--set', 'secrets.postgres.password=')).toMatch(/secrets\.postgres\.password is required/);
      expect(renderError(...TEST_SECRETS, '--set', 'secrets.redis.password=')).toMatch(/secrets\.redis\.password is required/);
      expect(renderError(...TEST_SECRETS, '--set', 'postgres.enabled=false')).toMatch(/externalDatabase\.url is required/);
    });

    it('uses an existing Secret instead of rendering one, for every reference', () => {
      const objects = renderBare('--set', 'secrets.existingSecret=my-creds');
      expect(objects.some((o) => o.kind === 'Secret')).toBe(false);
      const names = JSON.stringify(objects).match(/"secretKeyRef":\{"name":"[^"]+"/g) ?? [];
      expect(names.length).toBeGreaterThan(5);
      expect(new Set(names)).toEqual(new Set(['"secretKeyRef":{"name":"my-creds"']));
      const resend = (deployment(objects, 'worker')!.spec.template.spec.containers[0].env as any[]).find((e) => e.name === 'RESEND_API_KEY');
      expect(resend.valueFrom.secretKeyRef).toEqual({ name: 'my-creds', key: 'RESEND_API_KEY', optional: true });
    });

    it('URL-encodes generated passwords inside DATABASE_URL and REDIS_URL', () => {
      const secret = render('--set', 'secrets.postgres.password=a@b/c').find((o) => o.kind === 'Secret') as K8sObject & { data: Record<string, string> };
      // Compared from the user part on, so this file holds no whole connection string (gitleaks).
      expect(Buffer.from(secret.data.DATABASE_URL, 'base64').toString()).toMatch(/^postgresql:\/\/openpm:a%40b%2Fc@openpm-postgres:5432\/openpm$/);
    });
  });

  describe('least-privilege database user', () => {
    const secretOf = (objs: K8sObject[]) => (objs.find((o) => o.kind === 'Secret') as K8sObject & { data: Record<string, string> }).data;
    const decoded = (v: string | undefined) => (v === undefined ? undefined : Buffer.from(v, 'base64').toString());

    it('is off by default: everything connects as the owner, and there is no migration URL', () => {
      const data = secretOf(render());
      expect(decoded(data.DATABASE_URL)).toMatch(/^postgresql:\/\/openpm:/);
      expect(data.DATABASE_MIGRATION_URL).toBeUndefined();
    });

    it('with appPassword, the app connects as its own user and migrations as the owner', () => {
      const objs = render('--set', 'secrets.postgres.appPassword=a@b');
      const data = secretOf(objs);
      expect(decoded(data.DATABASE_URL)).toMatch(/^postgresql:\/\/openpm_app:a%40b@openpm-postgres:5432\/openpm$/);
      expect(decoded(data.DATABASE_MIGRATION_URL)).toMatch(/^postgresql:\/\/openpm:pg-test@/);

      // Only the migration init container is given the owner's URL (optional: existingSecret may lack it).
      const pod = deployment(objs, 'api')!.spec.template.spec;
      const migrate = pod.initContainers.find((c: { command?: string[] }) => c.command?.includes('apps/api/dist/db/migrate.js'));
      expect(migrate.env.find((e: { name: string }) => e.name === 'DATABASE_MIGRATION_URL').valueFrom.secretKeyRef.optional).toBe(true);
      for (const component of ['api', 'worker']) {
        const names = deployment(objs, component)!.spec.template.spec.containers.flatMap((c: { env?: Array<{ name: string }> }) => (c.env ?? []).map((e) => e.name));
        expect(names).not.toContain('DATABASE_MIGRATION_URL');
      }
    });

    it('refuses an app user named like the owner', () => {
      expect(renderError('--set', 'secrets.postgres.appPassword=x', '--set', 'secrets.postgres.appUsername=openpm', ...TEST_SECRETS)).toMatch(/must differ/);
    });
  });

  it('makes the API trust one proxy hop (the Ingress) by default, and none when unset', () => {
    const env = (objects: K8sObject[]) => deployment(objects, 'api')!.spec.template.spec.containers[0].env as Array<{ name: string; value?: string }>;
    expect(env(render())).toContainEqual({ name: 'TRUST_PROXY', value: '1' });
    expect(env(render('--set', 'api.trustProxy=')).map((e) => e.name)).not.toContain('TRUST_PROXY');
  });

  it('can turn the migration init container off', () => {
    const api = deployment(render('--set', 'api.migrations.enabled=false'), 'api')!;
    expect(api.spec.template.spec.initContainers).toBeUndefined();
  });
});
