# Contributing

Use the Node version and commands in [README](README.md). Install with `npm ci`,
run `npm run dev`, and run `npm run check` before proposing changes. CI validates
code; it does not publish, deploy, or upload graph state.

Keep changes focused. Add a regression test for nontrivial logic, especially
schema inspection, source bounds, concurrent writes, privacy, and security
boundaries. Tests use temporary stores and explicitly synthetic definitions,
never the live `knowledge/` directory. Keep canonical objects separate from
renderer mutation. Do not introduce telemetry or persist questions/searches.

For dependencies, pin the exact version, update the lockfile with npm, run
`npm audit`, regenerate `npm run licenses`, and commit the updated report and
license copies. Unknown or restricted licenses fail checks. A new license needs
a documented compatibility review; public accessibility is not a license.

OSDU facts require pinned, appropriately licensed authoritative evidence. Do not
turn examples, layouts, or test definitions into real schema claims. Do not
silently upgrade already saved kinds or redefine a schema identity with new
bytes. Schema-format changes must preserve old data or provide a separately
authorized migration; there is no automatic destructive migration.

Before committing, run `npm run release:check` and inspect `git diff --cached`.
Ignore rules do not protect previously tracked files. Keep local graph data,
source caches, credentials, exports, and coding-agent instructions untracked.

Contributions are provided under the project's Apache-2.0 license. Do not submit
third-party content you lack permission to redistribute.
