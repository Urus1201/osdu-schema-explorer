import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { acceptedLicense, readTarLicenseFiles, type LicenseFile } from './license-core';

interface Locked {
  version: string;
  license?: string;
  dev?: boolean;
  optional?: boolean;
  integrity: string;
  resolved: string;
}
interface Entry {
  path: string;
  name: string;
  version: string;
  development: boolean;
  optional: boolean;
  license: string;
  integrity: string;
  licenseFiles: { path: string; sha256: string }[];
  source: string;
}
interface Report {
  formatVersion: 1;
  lockHash: string;
  unresolved: string[];
  packages: Entry[];
}
const reportPath = 'docs/dependency-licenses.json';
const bundlePath = 'THIRD_PARTY_LICENSES.txt';
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

async function boundedFetch(url: string): Promise<Buffer> {
  if (new URL(url).protocol !== 'https:') throw new Error('HTTPS source required');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error(`License source unavailable: ${response.status}`);
  const reader = response.body!.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > 32 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('License source size limit');
    }
    chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks);
}
async function localLicenses(directory: string, depth = 0): Promise<LicenseFile[]> {
  const files: LicenseFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = join(directory, entry.name);
    if (entry.isFile() && /^(licen[sc]e|copying|notice)/i.test(entry.name))
      files.push({ path: file.replaceAll('\\', '/'), text: await readFile(file, 'utf8') });
    else if (entry.isDirectory() && depth < 5 && !['node_modules', '.git'].includes(entry.name))
      files.push(...(await localLicenses(file, depth + 1)));
  }
  return files;
}
async function missingLicenses(
  name: string,
  locked: Locked,
  packages: Record<string, Locked>,
): Promise<{ files: LicenseFile[]; source: string }> {
  // Platform binaries use the same parent-project distribution terms, including bundled notices.
  const parent = name.startsWith('@esbuild/')
    ? 'esbuild'
    : name.startsWith('@rollup/rollup-')
      ? 'rollup'
      : undefined;
  if (parent) {
    const parentPath = Object.entries(packages).find(
      ([path, item]) => path.endsWith(`node_modules/${parent}`) && item.version === locked.version,
    )?.[0];
    if (!parentPath) throw new Error('Missing platform license parent');
    const manifest = JSON.parse(await readFile(`${parentPath}/package.json`, 'utf8')) as {
      version: string;
    };
    if (manifest.version !== locked.version)
      throw new Error('Platform license parent version mismatch');
    return {
      files: await localLicenses(parentPath),
      source: `npm:${parent}@${locked.version} (same project platform package)`,
    };
  }
  const metadata = JSON.parse(
    (
      await boundedFetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${locked.version}`)
    ).toString(),
  ) as {
    gitHead?: string;
    repository?: { url: string } | string;
    dist: { integrity: string; tarball: string };
  };
  if (metadata.dist.integrity !== locked.integrity || metadata.dist.tarball !== locked.resolved)
    throw new Error('Registry/lock provenance mismatch');
  const archive = await boundedFetch(locked.resolved);
  const [algorithm, digest] = locked.integrity.split('-');
  if (
    !['sha512', 'sha256', 'sha1'].includes(algorithm) ||
    createHash(algorithm).update(archive).digest('base64') !== digest
  )
    throw new Error('Tarball integrity mismatch');
  const files = readTarLicenseFiles(gunzipSync(archive, { maxOutputLength: 64 * 1024 * 1024 }));
  if (files.length) return { files, source: locked.resolved };
  const repo =
    typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
  const match = repo?.match(/github\.com[/:]([^/]+\/[^/#]+?)(?:\.git)?$/);
  const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'COPYING'];
  // This pinned monorepo publishes its shared Apache terms under packages/core.
  if (name === '@humanfs/types') candidates.push('packages/core/LICENSE');
  for (const file of match && metadata.gitHead && /^[a-f0-9]{40}$/.test(metadata.gitHead)
    ? candidates
    : []) {
    const url = `https://raw.githubusercontent.com/${match![1]}/${metadata.gitHead}/${file}`;
    try {
      return { files: [{ path: file, text: (await boundedFetch(url)).toString() }], source: url };
    } catch {
      /* Try only known license filenames at the same pinned commit. */
    }
  }
  // These exact releases declare MIT but ship only their attribution/declaration.
  // Preserve those notices verbatim and supply the standard SPDX permission text.
  const reviewed: Record<string, { file: string; start: string; end?: string }> = {
    'bezier-js@6.1.4': { file: 'src/bezier.js', start: '/**', end: '**/' },
    'keyv@4.5.4': { file: 'README.md', start: '## License' },
    'natural-compare@1.4.0': { file: 'README.md', start: 'Copyright (c)' },
    'stackback@0.0.2': { file: 'package.json', start: '{', end: '}' },
  };
  const declaration = reviewed[`${name}@${locked.version}`];
  if (declaration && locked.license === 'MIT') {
    const original = await readFile(`node_modules/${name}/${declaration.file}`, 'utf8');
    const start = original.indexOf(declaration.start);
    const end = declaration.end
      ? original.indexOf(declaration.end, start) + declaration.end.length
      : original.length;
    if (start < 0 || end <= start) throw new Error('Missing reviewed upstream attribution');
    const url =
      'https://raw.githubusercontent.com/spdx/license-list-data/31ba1a50e5397e00a304dbadc76531740e89ee48/text/MIT.txt';
    const standard = (await boundedFetch(url)).toString();
    const terms = standard.indexOf('Permission is hereby granted');
    if (terms < 0 || !standard.includes('THE SOFTWARE IS PROVIDED'))
      throw new Error('Invalid standard MIT text');
    return {
      files: [
        {
          path: declaration.file + ' + SPDX MIT permission text',
          text: original.slice(start, end) + '\n\nMIT License\n\n' + standard.slice(terms),
        },
      ],
      source: locked.resolved + '; standard MIT terms: ' + url,
    };
  }
  // Some old packages embed their complete license in source or README.
  const directory = `node_modules/${name}`;
  for (const file of await readdir(directory).catch(() => [] as string[])) {
    if (!/\.(js|md)$/i.test(file)) continue;
    const text = await readFile(join(directory, file), 'utf8');
    const start = text.search(/Copyright (?:\(c\)|\(C\))/);
    if (
      start >= 0 &&
      /Permission is hereby granted|Redistribution and use in source/.test(text) &&
      /THE SOFTWARE IS PROVIDED|THIS SOFTWARE IS PROVIDED/.test(text)
    ) {
      const end = text.indexOf('*/', start);
      return {
        files: [{ path: file, text: text.slice(start, end < 0 ? undefined : end) }],
        source: locked.resolved,
      };
    }
  }
  throw new Error(`No complete pinned license notice for ${name}@${locked.version}`);
}

async function main() {
  const lockBytes = await readFile('package-lock.json');
  const lock = JSON.parse(lockBytes.toString()) as { packages: Record<string, Locked> };
  const locked = Object.entries(lock.packages).filter(([path]) => path);
  const write = process.argv.includes('--write');
  if (!write) {
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as Report;
    const bundle = await readFile(bundlePath, 'utf8');
    if (
      report.lockHash !== hash(lockBytes) ||
      report.unresolved.length ||
      report.packages.length !== locked.length
    )
      throw new Error('Stale or unresolved license report; run npm run licenses');
    for (const [path, item] of locked) {
      const name = path.split('node_modules/').at(-1)!;
      const entry = report.packages.find((row) => row.path === path);
      if (
        !item.license ||
        !acceptedLicense(name, item.version, item.license) ||
        entry?.version !== item.version ||
        entry.license !== item.license ||
        entry.integrity !== item.integrity ||
        !entry.licenseFiles.length ||
        !bundle.includes(`PACKAGE ${path} ${item.version}\n`)
      )
        throw new Error(`Unreviewed dependency ${name}`);
      for (const file of entry.licenseFiles) {
        const marker = `FILE ${file.path}\nSHA256 ${file.sha256}\n`;
        const start = bundle.indexOf(marker);
        if (start < 0) throw new Error('Missing notice text');
        const textStart = start + marker.length;
        const end = bundle.indexOf('\nEND LICENSE FILE\n', textStart);
        if (end < 0 || hash(bundle.slice(textStart, end)) !== file.sha256)
          throw new Error('License text hash mismatch');
      }
    }
    console.log(
      `Reviewed ${locked.length} pinned runtime/development/platform dependency entries; no unresolved licenses.`,
    );
    return;
  }
  const report: Report = {
    formatVersion: 1,
    lockHash: hash(lockBytes),
    unresolved: [],
    packages: [],
  };
  let bundle = 'Third-party licenses and notices. Project-owned code is Apache-2.0.\n';
  for (const [path, item] of locked.sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const name = path.split('node_modules/').at(-1)!;
    if (!item.license || !acceptedLicense(name, item.version, item.license))
      throw new Error(`Unreviewed license ${name}@${item.version}: ${item.license}`);
    let files: LicenseFile[] = [];
    let source = item.resolved;
    try {
      files = await localLicenses(path);
    } catch {
      /* Optional platform package is absent on this machine. */
    }
    if (!files.length) {
      const fallback = await missingLicenses(name, item, lock.packages);
      files = fallback.files;
      source = fallback.source;
    }
    files = files
      .map((file) => ({ path: file.path, text: file.text.replaceAll('\r\n', '\n').trimEnd() }))
      .sort((a, b) => a.path.localeCompare(b.path, 'en'));
    if (!files.length || files.some((file) => !file.text))
      throw new Error(`Missing licenses ${name}`);
    report.packages.push({
      path,
      name,
      version: item.version,
      development: item.dev ?? false,
      optional: item.optional ?? false,
      license: item.license,
      integrity: item.integrity,
      source,
      licenseFiles: files.map((file) => ({ path: file.path, sha256: hash(file.text) })),
    });
    bundle += `\nPACKAGE ${path} ${item.version}\nLICENSE ${item.license}\nSOURCE ${source}\n`;
    for (const file of files)
      bundle += `FILE ${file.path}\nSHA256 ${hash(file.text)}\n${file.text}\nEND LICENSE FILE\n`;
  }
  await mkdir('docs', { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(bundlePath, bundle);
  console.log(
    `Wrote ${report.packages.length} pinned dependency entries and their full license/NOTICE copies.`,
  );
}
await main();
