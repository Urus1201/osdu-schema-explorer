# Security

This is a single-user local tool, not an Internet-facing or multi-tenant service.
It binds to `127.0.0.1`, checks Host and Origin, bounds input, exposes no remote
schema-fetch/filesystem routes, and does not permit semantic writes over HTTP.
Any process running as your user can access your local files; loopback binding
is not protection from a compromised machine.

Sources are untrusted data, never instructions or executable code. Use only
trusted pinned checkouts/exports and review source licensing before sharing.
The graph schema rejects unknown keys, but free-text descriptions can still
contain private information. Review content, not only structure.

No tenant tokens or AI API keys are required. Do not put credentials in kinds,
URLs, descriptions, manifests, or patches. No application telemetry, request
body logging, question history, or persistent search history is included. Your
coding-agent host, shell, browser, OS, and external source services have their
own retention policies, outside this application's control.

Do not expose the service through a proxy or bind it to a public address. Keep
dependencies updated and use `npm audit` before a release. Supported fixes apply
to the latest release; older snapshots are not separately maintained.

Report a suspected vulnerability privately using the repository's GitHub
security advisory feature if enabled. Otherwise contact the repository owner
through their GitHub profile without including secrets or exploit data in a
public issue. Never attach a private graph/source cache to a public report.
