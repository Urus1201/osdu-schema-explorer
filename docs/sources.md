# Reproducible source inspection

The inspector reads a selected field from pinned local JSON Schema exports or a
checkout. It returns a candidate additive patch; it never writes the canonical
graph, fetches a catalog, queries tenant records, or imports every cached schema.
The default research authority is the [OSDU Data Definitions repository](https://community.opengroup.org/osdu/data/data-definitions).
Select an immutable upstream commit or release before preparing an export. Public
upstream versions do not establish which versions are deployed in a tenant.

Keep exports and their manifests under ignored `local-sources/` or
`knowledge/sources/`. Place the manifest at the root of the exported files. Each
listed path must be a relative forward-slash path under that directory; symlinks
escaping it are rejected. `location` is the portable source path or a canonical
HTTPS URL, never an absolute workstation path. URLs cannot contain credentials,
query parameters, or fragments. No network request occurs when a URL is used.

## Manifest

This template uses synthetic names and placeholders. Replace the revision, hashes,
and identities with those of the actual files being inspected; it is not an OSDU
fact or permission to seed a graph.

```json
{
  "formatVersion": 1,
  "namespace": "my-reviewed-source-snapshot",
  "revision": "immutable-commit-or-local-snapshot-id",
  "license": "unknown",
  "visibility": "private",
  "redistribution": "unknown",
  "schemas": [
    {
      "kind": "example:wks:master-data--SyntheticSource:1.0.0",
      "version": "1.0.0",
      "path": "source.json",
      "location": "source.json",
      "contentHash": "sha256:<64-lowercase-hex-characters>"
    },
    {
      "kind": "example:wks:master-data--SyntheticTarget:2.0.0",
      "version": "2.0.0",
      "path": "target.json",
      "location": "target.json",
      "contentHash": "sha256:<64-lowercase-hex-characters>"
    }
  ],
  "bounds": {
    "maxDocuments": 12,
    "maxDepth": 32,
    "maxNodes": 2000,
    "maxBytes": 4194304
  }
}
```

All source hashes cover original file bytes, including whitespace and line endings.
Compute them with `Get-FileHash -Algorithm SHA256 <file>` in PowerShell and lowercase
the hexadecimal result. Both raw SHA-256 hex and the `sha256:` prefix are accepted;
use one spelling consistently because stored provenance preserves that spelling.
Manifest kinds include the exact version and must agree with `version` and a
document's `x-osdu-schema-source` declaration, when present. Mutable revision names
such as `master`, `main`, `HEAD`, or `latest` are rejected.

Source visibility is `public`, `private`, or `unknown`; redistribution status is
`reviewed`, `unknown`, or `prohibited`. These declarations travel with evidence;
local inspection does not conduct a licensing or ownership review. A public URL
does not make its content redistributable. Record source licensing separately from
the application's Apache-2.0 license. Optional manifest `attribution` preserves a
reviewed attribution string. Optional schema `type` selects `entity`, `fragment`,
or `reference_data`; otherwise group names determine the type.

Bounds are optional and use the defaults shown above. Hard caps are 64 documents,
128 levels, 20,000 visited schema nodes, and 16 MiB of total source bytes. The
manifest itself is limited to 1 MiB. Only requested, referenced documents and
selected targets are read; unrelated entries are not read or hash-checked. Crossing
any traversal or file budget discards the entire candidate patch and reports the
limit. Hash, identity, and malformed-manifest errors fail the operation.

## Inspect and review

```sh
npm run graph -- inspect --manifest local-sources/manifest.json --kind example:wks:master-data--SyntheticSource:1.0.0 --field data.TargetID --target example:wks:master-data--SyntheticTarget:2.0.0
```

The CLI prints the candidate patch to stdout and issues to stderr. Save only the
patch in an ignored graph-only filename if needed, inspect its evidence, then use
the shared `validate` and `apply --expected-revision` operations. Inspection alone
never authorizes applying a patch. Do not write questions, answers, or search text
into manifests, graph patches, source filenames, or provenance.

Fields use an explicit dotted property path, for example `data.Links[].TargetID`.
Array markers may be omitted to resolve the actual array structure; supplied
markers must match the inspected occurrence. JSON Pointers in evidence are kept
separate from these readable paths. Property occurrence IDs include composition
use-site pointers and a `$resolved` delimiter, so a fragment reused in two places
does not collapse into one property occurrence.

The API is:

```ts
inspectRelationship(manifestFile, { kind, field, target? })
// Promise<{ patch: GraphPatch; issues: string[] }>
```

`target` chooses an exact pinned target kind/version. Without it, each annotation
must resolve to exactly one listed kind/version. An ambiguous or unmatched target
produces an issue, never an inferred subtype or automatic version upgrade. A
selected target version is not a constraint declared by the source schema.

## Supported mechanics and limits

Inspection follows the selected nested `properties`, object/tuple `items`, draft
2020-12 `prefixItems`, JSON Pointer `$ref`, `allOf`, `oneOf`, `anyOf`, and draft 7+
`if`/`then`/`else`. Alternatives and conditional predicates are preserved as branch
qualifications; no record is evaluated to choose a branch. Array bounds describe
the immediate inspected array, and `required: true` records a local explicit
required declaration. It does not infer reverse cardinality, global requiredness,
or that an optional containing object exists.

Declared draft 4, 6, 7, 2019-09, and 2020-12 dialect URIs are recognized. Draft 4–7
`$ref` siblings are ignored, following the [JSON Schema reference rules](https://json-schema.org/understanding-json-schema/structuring).
Modern siblings are inspected. Missing or unknown dialects, unsupported nested
resource identifiers/dialect changes, named anchors, dynamic/recursive references,
and unresolved references are reported. External references resolve only to
manifest-listed relative paths, locations, or already-loaded root `$id` URIs.
No host is contacted to resolve a reference.
External composition through a manifest entry typed as an entity or reference-data
schema is reported as unsupported; composition edges in this graph model target
fragments. A record-reference annotation targeting a fragment is likewise rejected.

Schema-valued `patternProperties`, `additionalProperties`, `dependentSchemas`,
`dependencies`, `contains`, `not`, and unevaluated-property/item constraints are
outside this version's traversal and reported when encountered in scoped objects.
The inspector is a bounded annotation extractor, not a full JSON Schema validator
or a proof that a business record satisfies every schema constraint. Review issues
alongside any verified matches; an explicit supported annotation can coexist with
unresolved scope elsewhere. Embedded resources with their own `$id`, common in
some bundled exports, need separate pinned fragment exports for this version.

Record-reference extraction recognizes `x-osdu-relationship` arrays containing
`GroupType` and `EntityType`, a convention visible in [OSDU's published QA schema
example](https://osdu.pages.opengroup.org/qa/gcp.Wellbore%20R3%20CI-CD%20v1_0_report_extra.html).
Unknown annotation shapes are reported. No fixture is treated as real OSDU data.

A verified field produces owner → property containment and property → selected
target `references_record` edges. Necessary external fragment uses produce separate
`composes_schema` edges; they never become domain inheritance. Evidence includes
original content hashes, namespace, revision, owning kind/version, exact annotation
pointers, and fragment origin plus composition use sites. No verified match means
an empty candidate patch, including no standalone nodes. Documentation-derived
associations require separately authored documentation evidence; this extractor
does not fabricate them from prose.
