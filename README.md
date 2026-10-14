# OSDU Schema Explorer

A local-first, evidence-backed graph of **schemas**, not OSDU business records.
The graph starts empty, grows through explicitly requested, verified additions, and
survives restarts. Questions and search text are not application data.

## Run locally

Use Node.js 22.23.2 or newer on Windows, macOS, or Linux. Windows is locally tested;
the CI matrix checks Windows and Linux. No database, cloud account, tenant
credentials, or AI API key is required.

```sh
npm ci
npm run init
npm run dev
```

Open **http://127.0.0.1:5173**. Development runs the loopback graph service on
port 4310 and Vite on port 5173. For the built application:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:4310**. Starts reuse `knowledge/graph.json`; they never
reset or populate it. The viewer offers 3D, 2D, and a keyboard-accessible list.
It displays saved facts; it is not an embedded chat or a live Codex connection.

## Add or reuse a verified relationship

Resolve actual schema kinds and versions, check the saved typed path, and inspect
only missing scope. An existing pair of nodes is not proof of a relationship;
composition through a shared fragment is not a business association.

```sh
npm run graph -- help
npm run graph -- lookup --term Well
npm run graph -- path --from "SCHEMA_ID" --to "SCHEMA_ID"
npm run graph -- inspect --manifest local-sources/manifest.json --kind "FULL_KIND" --field data.TargetID --target "TARGET_KIND"
npm run graph -- validate --patch exports/relationship.patch.json
npm run graph -- apply --patch exports/relationship.patch.json --expected-revision 0
npm run graph -- focus --nodes "ID,ID" --edges "EDGE_ID"
```

The inspect CLI prints a candidate patch to stdout and issues to stderr (its
TypeScript API returns `{patch, issues}`). Review both before saving the patch
file. Inspection never applies facts. `apply` requires the current revision, validates the union,
and refuses conflicts. Reapplying identical facts does not change graph bytes or
revision. `focus` is best-effort and sends only existing IDs; facts save even when
the viewer is closed. `--store DIRECTORY` selects an isolated store.

Default authoritative source: [OSDU Data Definitions](https://community.opengroup.org/osdu/data/data-definitions).
Use a local checkout/export pinned by immutable revision and SHA-256 hashes;
there is deliberately no unbounded online crawler. See [source manifests and
inspection limits](docs/sources.md). No real OSDU definitions are bundled or
claimed as tenant-deployed. All test definitions are synthetic.

Local coding-agent instructions and skills are intentionally gitignored and are
not distributed with this repository. The public CLI is usable by any coding
agent or a person without an agent framework.

## Development and sharing

```sh
npm run check
npm audit
```

Checks cover formatting, lint, types, deterministic core/store/source/API/viewer
adapter tests, build, dependency notices, and release privacy. See
[CONTRIBUTING](CONTRIBUTING.md), [architecture](docs/architecture.md),
[data format](docs/data-format.md), [privacy and exports](docs/privacy.md),
[store recovery](docs/recovery.md), and [security](SECURITY.md).

Private local state, exports, caches, agent files, and environment files are
ignored. **Publishing this code does not authorize publishing your graph.**
Public graph export requires an explicit reviewed set and source redistribution
rights; manual content review remains essential.

## License

[Apache-2.0](LICENSE) applies to project-owned code, documentation, and synthetic
tests. Upstream schemas retain their own licenses. Dependency licenses and
notices are in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md),
[THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES.txt), and the
[pinned dependency report](docs/dependency-licenses.json).
