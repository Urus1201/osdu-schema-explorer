# Third-party notices

Project-owned work is Apache-2.0. Third-party packages and source schemas retain
their own terms; no OSDU definitions are bundled. The lockfile pins the complete
runtime and development dependency tree, including optional platform entries.

`docs/dependency-licenses.json` records exact package versions, package paths,
SPDX declarations, integrity hashes, notice locations, and notice SHA-256 hashes.
`THIRD_PARTY_LICENSES.txt` preserves the complete license and packaged NOTICE
texts, including licenses bundled inside packages. Build distributions copy
these files and the project LICENSE. No third-party raster or font assets are
used. System fonts and project-owned SVG/CSS are used for the viewer.

MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 and 0BSD are accepted permissive
code licenses with preserved notices. The following pinned exceptions receive
an explicit compatibility review rather than blanket acceptance:

| Package                                        | License       | Review                                                                                                                                                                           |
| ---------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimatch@10.2.6` (development, nested)       | BlueOak-1.0.0 | Permissive copyright and patent grant; no noncommercial restriction. Preserve supplied terms; do not relabel as Apache.                                                          |
| `argparse@2.0.1` (development)                 | Python-2.0    | Permissive PSF terms; preserve license/copyright and historical notices. This project does not modify its code.                                                                  |
| `caniuse-lite@1.0.30001816` (development data) | CC-BY-4.0     | Attribution-licensed browser compatibility data, not proprietary visualization code. Preserve license and author/source attribution from package; no dataset modifications here. |

The runtime visualizers React Force Graph, Three.js, their force-graph rendering
dependencies, and React use permissive licenses. Read the generated report for
the actual complete pinned tree rather than relying on this summary. Unknown,
unreviewed, noncommercial and source-available-only licenses fail the check.

Some packages omit a standalone license in their npm archive. The report records
a full license from the package's npm `gitHead` commit or a complete embedded
license. Four reviewed MIT releases (`bezier-js@6.1.4`, `keyv@4.5.4`,
`natural-compare@1.4.0`, `stackback@0.0.2`) publish an MIT declaration and
attribution but not the full permission text. Their original notices are preserved
with the standard MIT terms from the pinned SPDX license-list-data revision
recorded in the report; no copyright names or dates are invented.
Platform-only esbuild/Rollup binaries use the matching-version parent
project distribution license and notices. Archive bytes fetched during generation
are checked against lockfile integrity; no package scripts are executed. Ordinary
license checks are offline and validate the report and copied license text.

Rollup is pinned through an override to `4.62.2`: later releases add an optional
compression binary without complete published license notices. This reviewed
version supports the installed Vite and has no known advisories in the release audit.

Review dependency changes using `npm run licenses`; commit the lockfile, updated
report and copies together. Human review is still necessary for new bundled
content or source-data licenses. This is an engineering license inventory, not
legal advice or a sublicense of third-party work.
