import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * scripts/pin-images.sh, which the release workflow uses to pin production to a release's digests.
 * The deploy PR must change only the image lines: yq on its own drops every blank line in the file.
 *
 * Needs bash and yq (GitHub's Ubuntu runners have both). Skipped locally without yq; in CI a missing
 * yq fails instead.
 */
const root = path.join(__dirname, '../..');
const SCRIPT = path.join(root, 'scripts/pin-images.sh');

function yqAvailable(): boolean {
  try {
    execFileSync('yq', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    if (process.env.CI) throw new Error('yq is required in CI for tests/release/pin-images');
    return false;
  }
}

const digest = (n: number) => 'sha256:' + String(n).padStart(64, '0');
const IMAGES = [
  `api ghcr.io/o/openpm-api ${digest(1)}`,
  `worker ghcr.io/o/openpm-worker ${digest(2)}`,
  `frontend ghcr.io/o/openpm-frontend ${digest(3)}`,
].join('\n') + '\n';

describe.skipIf(!yqAvailable())('pin-images.sh', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pin-images-'));
  const file = path.join(dir, 'values.prod.yaml');
  // As checked out on Linux (a Windows checkout may have CRLF line endings).
  const original = readFileSync(path.join(root, 'helm/openpm/values.prod.yaml'), 'utf8').replace(/\r\n/g, '\n');

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const pin = () => execFileSync('bash', [SCRIPT, file, '9.9.9'], { input: IMAGES });

  it('changes only the repository, tag and digest of each app, keeping blank lines and comments', () => {
    writeFileSync(file, original);
    pin();
    const before = original.split('\n');
    const after = readFileSync(file, 'utf8').split('\n');

    expect(after).toHaveLength(before.length);
    const changed = after.flatMap((line, i) => (line === before[i] ? [] : [line.trim()]));
    expect(changed).toEqual([
      'repository: "ghcr.io/o/openpm-api"', 'tag: "9.9.9"', `digest: "${digest(1)}"`,
      'repository: "ghcr.io/o/openpm-worker"', 'tag: "9.9.9"', `digest: "${digest(2)}"`,
      'repository: "ghcr.io/o/openpm-frontend"', 'tag: "9.9.9"', `digest: "${digest(3)}"`,
    ]);
  });

  it('changes nothing when run again', () => {
    const pinned = readFileSync(file, 'utf8');
    pin();
    expect(readFileSync(file, 'utf8')).toBe(pinned);
  });
});
