import { describe, expect, it } from 'vitest';
import { checkReleasePaths } from '../scripts/release-check';
import { acceptedLicense, readTarLicenseFiles } from '../scripts/license-core';

describe('release boundaries', () => {
  it('rejects all local state and coding-agent artifacts, including tracked ignored files', () => {
    expect(checkReleasePaths(['src/cli/main.ts', 'README.md', '.github/workflows/ci.yml'])).toEqual(
      [],
    );
    expect(
      checkReleasePaths([
        'knowledge/graph.json',
        'exports/a.json',
        'local-sources/schema.json',
        '.env.production',
        'AGENTS.md',
        '.agents/skills/a/SKILL.md',
        'docs/implementation-plan.md',
        'codex_osdu_schema_graph_prompt_opensource.md',
      ]),
    ).toHaveLength(8);
  });
  it('rejects unknown and restricted licenses; exceptions require exact reviewed versions', () => {
    expect(acceptedLicense('three', '0.186.1', 'MIT')).toBe(true);
    expect(acceptedLicense('unknown', '1.0.0', 'UNLICENSED')).toBe(false);
    expect(acceptedLicense('unknown', '1.0.0', 'CC-BY-NC-4.0')).toBe(false);
    expect(acceptedLicense('argparse', '2.0.1', 'Python-2.0')).toBe(true);
    expect(acceptedLicense('argparse', '3.0.0', 'Python-2.0')).toBe(false);
  });
  it('reads license entries without extracting archive paths and rejects corrupt bounds', () => {
    const bytes = Buffer.alloc(2048);
    const body = 'Copyright synthetic MIT license';
    bytes.write('package/LICENSE');
    bytes.write(body.length.toString(8).padStart(11, '0'), 124);
    bytes.write('0', 156);
    bytes.write(body, 512);
    expect(readTarLicenseFiles(bytes)).toEqual([{ path: 'package/LICENSE', text: body }]);
    bytes.write('77777777777', 124);
    expect(() => readTarLicenseFiles(bytes)).toThrow();
  });
});
