# Architecture

```text
Pinned local source definitions → bounded inspector → candidate patch
                                                         ↓ review
CLI → shared validation + expected revision + exclusive lock → graph.json
                                                               ↓ poll
Loopback read service → graph/focus events → 3D / 2D / accessible list
```

`src/core` supplies deterministic IDs, strict graph/patch validation, typed-path
lookup, additive merging, and atomic persistence. `src/sources` inspects selected
JSON Schema scope. `src/cli` is the semantic write interface. `src/server` reads
validated snapshots and broadcasts changes; focus contains IDs only.
`src/viewer` receives copies and creates separate mutable force-layout objects.

The graph is the only semantic memory. Source checkout/cache content does not
authorize graph ingestion. A relationship is researched only on request. Reuse
is based on selected schema identities, typed paths, and provenance—not earlier
questions. Unrelated or unverifiable scope produces no semantic write. Different
schema versions have different IDs; a conflicting content hash at one ID is an
error. Disconnected components remain disconnected.

The service polls every 500 ms by default. Initial SSE snapshots have no addition
highlight; subsequent additions and ID-only focus remain in memory. No event
replay journal or conversation queue exists. The browser is a read-only viewer,
not an agent runtime. Heavy force renderers are lazy loaded.

## Local HTTP boundary

| Route             | Contract                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| `GET /api/graph`  | Current validated Graph, no-store                                        |
| `GET /api/events` | SSE `graph` `{graph,addedNodeIds,addedEdgeIds}` and `focus` FocusMessage |
| `POST /api/focus` | Strict existing ID arrays; unknown keys rejected; 16 KiB maximum         |

Focus returns `{focused:boolean}`. Invalid bodies return 400, forbidden Host or
Origin 403, wrong method 405, unknown paths 404, unavailable store 503. Errors do
not echo input or stack traces. There is no graph-write, shell, arbitrary file,
record query, or remote fetch endpoint. Production assets are served only from
the built static directory with path containment checks. Development proxies
the API to loopback; allowed origins are loopback ports 4310 and 5173.

## Scope and limits

Designed for one person and bounded schema subgraphs, not a million-node catalog.
Graph reads and updates validate the whole store. The default typed path search
excludes `composes_schema`; structural paths must be explicitly requested and
are labeled structural. Reversed traversal does not reverse an edge's schema
direction. No derived direct shortcuts are saved.

No database, tenant records, hosted AI, automatic schema upgrades, bulk imports,
or remote authentication system is included. Browser/agent terminology mapping
cannot be proven by deterministic fixture tests; inspect actual sources before
asserting real OSDU relationships.
