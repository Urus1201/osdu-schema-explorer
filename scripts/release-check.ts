import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function checkReleasePaths(paths: string[]): string[] {
  return paths.filter(
    (path) =>
      /(^|\/)(knowledge|local-sources|exports|\.agents|\.codex|\.claude|\.cursor|\.superpowers|\.qa|node_modules|dist|coverage|playwright-report|test-results)(\/|$)/i.test(
        path,
      ) ||
      /(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$/i.test(path) ||
      (/(^|\/)(SKILL\.md|\.env(?:\..*)?|[^/]+\.(?:log|tmp|patch\.json))$/i.test(path) &&
        !path.endsWith('.env.example')) ||
      /(^|\/)(implementation-plan\.md|codex_osdu_schema_graph_prompt_opensource\.md)$/.test(path) ||
      /^\.github\/(copilot-instructions\.md|instructions\/)/i.test(path),
  );
}

function main() {
  const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const forbidden = checkReleasePaths(paths);
  if (forbidden.length) throw new Error(`Private/agent paths tracked: ${forbidden.join(', ')}`);
  console.log(
    `Release paths checked: ${paths.length}; no local-state or agent files tracked. Manually review content before publishing.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
