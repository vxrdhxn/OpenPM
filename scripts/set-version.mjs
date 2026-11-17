#!/usr/bin/env node
// Sets the release version everywhere it is recorded: the root and workspace package.json files
// (and package-lock.json), and the Helm chart's version and appVersion. The release workflow refuses
// a tag that does not match. Usage: npm run release:version -- 1.2.0   (see docs/releasing.md)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: npm run release:version -- <major.minor.patch>   e.g. 1.2.0 (no "v", no pre-release suffix)');
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmArgs = ['version', version, '--workspaces', '--include-workspace-root', '--no-git-tag-version', '--allow-same-version'];
// Under `npm run`, npm_execpath is npm's own CLI script: run it with this node (no shell needed on Windows).
if (process.env.npm_execpath) execFileSync(process.execPath, [process.env.npm_execpath, ...npmArgs], { cwd: root, stdio: 'inherit' });
else execFileSync('npm', npmArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

const chart = path.join(root, 'helm/openpm/Chart.yaml');
const text = readFileSync(chart, 'utf8');
const updated = text.replace(/^version: .*$/m, `version: ${version}`).replace(/^appVersion: .*$/m, `appVersion: "${version}"`);
if (!/^version: /m.test(text) || !/^appVersion: /m.test(text)) throw new Error('Chart.yaml has no version/appVersion line');
writeFileSync(chart, updated);

console.log(`\nVersion set to ${version}. Commit it, merge to main, then tag the merge commit:\n  git tag -a v${version} -m "v${version}" && git push origin v${version}`);
