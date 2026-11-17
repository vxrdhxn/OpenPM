import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A release tag vX.Y.Z must match one version recorded everywhere (the release workflow checks the
 * tag against Chart.yaml). `npm run release:version -- X.Y.Z` sets them all; this catches a hand edit
 * that changed only some.
 */
const root = path.join(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const pkgVersion = (p: string) => JSON.parse(read(p)).version as string;

describe('release version', () => {
  const chart = read('helm/openpm/Chart.yaml');
  const chartVersion = chart.match(/^version: (.*)$/m)?.[1]?.trim();
  const appVersion = chart.match(/^appVersion: "?([^"\n]*)"?$/m)?.[1]?.trim();

  it('is a plain semver version', () => {
    expect(pkgVersion('package.json')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is the same in every package.json, the lockfile and the Helm chart', () => {
    const v = pkgVersion('package.json');
    for (const p of ['apps/api/package.json', 'apps/worker/package.json', 'apps/frontend/package.json']) {
      expect(pkgVersion(p), p).toBe(v);
    }
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.version, 'package-lock.json').toBe(v);
    for (const ws of ['apps/api', 'apps/worker', 'apps/frontend']) {
      expect(lock.packages[ws]?.version, `package-lock.json ${ws}`).toBe(v);
    }
    expect(chartVersion, 'Chart.yaml version').toBe(v);
    expect(appVersion, 'Chart.yaml appVersion').toBe(v);
  });
});
