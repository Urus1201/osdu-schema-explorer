# Privacy and graph sharing

`knowledge/`, local source checkouts/exports, environment files, logs, temporary
patches, recovery files, and coding-agent instructions are ignored. They are not
part of the public application. `npm run release:check` checks tracked/staged
paths; always manually inspect the staged diff. Never rewrite history to hide
private material without an explicit cleanup decision.

The application does not store questions, answers, search text, request history,
or focus. A graph is still potentially sensitive: field descriptions, source
paths and schema extensions may be proprietary. Strict keys cannot detect all
secrets disguised as valid descriptions. Your coding-agent host may retain its
own chat independently of this application.

## Private backup/export

Create the ignored directory first, then:

```sh
npm run graph -- export --output exports/private-graph.json
```

Exports refuse to overwrite existing files. Default export is private local
data; it is not permission to upload the file.

## Public reviewed subset

```sh
npm run graph -- export --public --reviewed --nodes "NODE_ID,NODE_ID" --edges "EDGE_ID" --output exports/reviewed-graph.json
```

List the exact reviewed nodes and edges, including required endpoints/property
owners. Required evidence is included with its attribution, never stripped to
disguise private material. The command fails closed for unknown/private source
visibility, unreviewed/prohibited redistribution, unaccepted licenses, missing
attribution, nonpublic source locations, or incomplete selections.

Before marking sources reviewed, verify their licenses and that the **entire
selected content** contains no private extensions, tenant URLs, secrets,
customer/employer material, record IDs, or proprietary descriptions. Public
accessibility alone does not grant redistribution. Review fields and excerpts
as well as source URLs. The command is a rights guard, not a content classifier
or legal clearance. Publication remains a separate explicit decision.

The code repository and npm release allowlist exclude local graph state. Build
outputs contain the viewer and third-party notices, not a graph snapshot. Local
agent instructions are deliberately not included in releases.
