# Graph data format (version 1)

Canonical store: `knowledge/graph.json`. Initialization writes:

```json
{ "formatVersion": 1, "revision": 0, "nodes": [], "edges": [], "evidence": [] }
```

A patch has the same `formatVersion`, `nodes`, `edges`, `evidence`, but **no**
revision. The writer supplies a separate expected revision. JSON Schemas are
in `schemas/`; shared core validation additionally checks identities, unique
IDs, evidence ownership, endpoint integrity, and source hashes. Unknown keys
are rejected recursively. Validation checks structure, not semantic truth.

## Node and edge meaning

Nodes are `entity`, `reference_data` (types, not records), `fragment`, or
`property`. Schema IDs include source namespace and the entire kind including
version. Property IDs include owning schema ID and occurrence path. The same
fragment used twice can have two property occurrences without becoming two
business entities.

| Edge                     | Meaning                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `references_record`      | A schema field can reference the selected target type; no record existence asserted |
| `contains_property`      | A schema contains this property occurrence                                          |
| `composes_schema`        | A schema uses this fragment; not inheritance/business linkage                       |
| `documented_association` | Documentation supports an association, distinct from explicit schema fields         |

Edge IDs include source, target, type, direction, field path, and ordered branch
conditions. Different fields/branches between the same endpoints remain distinct.
Edges carry evidence category and evidence IDs. `direction:forward` reflects
schema declaration. An undirected documented association may use `none`.
`required`, `minItems`, and `maxItems` are field/array constraints—not reverse
business cardinality. The target node's selected version is separate from an
optional `targetConstraint` actually declared by the source. A generic target
does not imply every dataset subtype.

## Provenance and privacy

Evidence includes namespace, canonical URL or portable relative path, immutable
revision, SHA-256 content hash, owning kind/version, exact source JSON Pointer,
and source visibility/license/redistribution review state. JSON Pointer is
separate from readable `data.Field[]` paths. Composed occurrences include origin
fragment and use-site chain; documentation needs a supporting excerpt.

Allowed descriptions explain stable facts. Do not place questions, answers,
requester identities, timestamps of conversations, or research narratives in
them. No positions, selections, focus, or object-valued renderer endpoints are
accepted. IDs are deterministic, not user chat text.

Application licensing does not change source licensing. See
[source inspection](sources.md) and [privacy/export](privacy.md).
