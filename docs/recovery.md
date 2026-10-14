# Store integrity and recovery

`knowledge/graph.json` is the only semantic store. Initialization creates an empty graph only when that file is absent; malformed existing content is an error. Startup never resets or seeds a graph. `--store DIRECTORY` selects another store for tests or development.

Writers validate patches, acquire an exclusive `graph.lock`, compare the expected revision, validate the resulting graph, write a unique temporary file, flush it, validate it again, and atomically rename it over the store. Transient sharing violations (including Windows readers or antivirus) receive five bounded retries; permanent failures preserve the old store. A repeated patch leaves both bytes and revision unchanged. Concurrent writers fail closed: reread the graph and recompute the additive patch before retrying. Never remove the destination to work around a failed rename.

The implementation uses Node filesystem operations on Windows and POSIX local filesystems. File contents are flushed before replacement. Network filesystems and filesystem-specific power-loss durability are not guaranteed; keep private graph-only backups if needed. The application does not create recovery history or automatic backups.

A crash can leave `graph.lock` or a `graph-*.tmp` file. No automatic stale-lock deletion occurs because elapsed time cannot establish that another writer has stopped. Stop the service and all graph CLI writers, inspect the files, and validate the existing graph with `npm run graph -- validate`. The lock does not contain questions or user identifiers.

After confirming every writer has stopped, an explicitly authorized recovery operation may remove that exact abandoned lock or temporary file. Preserve a private copy of any questionable graph first. Never replace a graph from a temporary file merely because it exists. Destructive restore or choosing between conflicting versions requires an explicit decision; this application supplies no automatic reset or restore command.

Keep graph copies, exports, recovery files and patches outside tracked/release artifacts. A source cache is not a backup of semantic knowledge. Public export has a separate explicit review workflow.
