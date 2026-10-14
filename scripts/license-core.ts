export interface LicenseFile {
  path: string;
  text: string;
}

const permissive = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD']);
// Exact pinned nonstandard cases reviewed in THIRD_PARTY_NOTICES.md; no blanket acceptance.
const reviewed = new Map([
  ['minimatch@10.2.6', 'BlueOak-1.0.0'],
  ['argparse@2.0.1', 'Python-2.0'],
  ['caniuse-lite@1.0.30001816', 'CC-BY-4.0'],
]);
export function acceptedLicense(name: string, version: string, license: string): boolean {
  return permissive.has(license) || reviewed.get(`${name}@${version}`) === license;
}

/** Read data only; never extract archive paths or execute package scripts. */
export function readTarLicenseFiles(bytes: Buffer): LicenseFile[] {
  const files: LicenseFile[] = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const sizeText = header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Unsupported archive size');
    const size = parseInt(sizeText, 8);
    const start = offset + 512;
    if (!Number.isSafeInteger(size) || size > 64 * 1024 * 1024 || start + size > bytes.length)
      throw new Error('Corrupt archive bounds');
    if (
      (header[156] === 48 || header[156] === 0) &&
      /(^|\/)(licen[sc]e[^/]*|copying[^/]*|notice[^/]*)$/i.test(name)
    ) {
      if (size > 1024 * 1024) throw new Error('License file too large');
      files.push({ path: name, text: bytes.subarray(start, start + size).toString('utf8') });
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  return files;
}
