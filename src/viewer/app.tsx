import { useDeferredValue, useMemo, useState } from 'react';
import { edgeTypes, nodeTypes } from '../core/model.js';
import { GraphCanvas, type Selection } from './graph-canvas.js';
import { GraphList } from './graph-list.js';
import {
  edgeColors,
  filterGraph,
  initialFilters,
  nodeColors,
  nodeNames,
  relationNames,
  type ViewFilters,
} from './graph-adapter.js';
import { FitIcon, GraphIcon, SearchIcon } from './icons.js';
import { Inspector } from './inspector.js';
import { useGraph } from './use-graph.js';

export function App() {
  const { graph, focus, status, error, retry, clearFocus } = useGraph();
  const [filters, setFilters] = useState<ViewFilters>(initialFilters);
  const [mode, setMode] = useState<'3d' | '2d' | 'list'>('3d');
  const [scope, setScope] = useState<'all' | 'focused'>('all');
  const [selection, setSelection] = useState<Selection>(null);
  const [labels, setLabels] = useState(true);
  const [fitRequest, setFitRequest] = useState(0);
  const search = useDeferredValue(filters.search);
  const view = useMemo(
    () => filterGraph(graph, { ...filters, search }, scope === 'focused' ? focus : undefined),
    [graph, filters, search, scope, focus],
  );
  const domains = useMemo(
    () => [...new Set(graph.nodes.map((node) => node.domain))].sort(),
    [graph.nodes],
  );
  const focusAvailable = focus.nodeIds.length > 0 || focus.edgeIds.length > 0;
  const filter = <K extends keyof ViewFilters>(key: K, value: ViewFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const filtered =
    filters.search !== '' ||
    filters.domain !== 'all' ||
    filters.nodeType !== 'all' ||
    filters.evidence !== 'all' ||
    filters.edgeType !== 'all';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to graph workspace
      </a>
      <header className="app-header">
        <div className="brand">
          <GraphIcon />
          <h1>OSDU Schema Explorer</h1>
        </div>
        <div className="header-actions">
          <span className={`connection ${status}`}>
            <i aria-hidden="true" />
            {status === 'connected'
              ? 'Local graph'
              : status === 'loading'
                ? 'Connecting…'
                : status === 'reconnecting'
                  ? 'Reconnecting…'
                  : 'Service offline'}
          </span>
          <details className="about">
            <summary aria-label="About this graph">?</summary>
            <div>
              <strong>A growing schema graph</strong>
              <p>
                Only verified facts requested through your agent enter this local graph. Search and
                focus are temporary.
              </p>
              <p>
                This is a partial view of saved schema knowledge, not a complete OSDU catalog.
                Public versions do not indicate tenant deployment.
              </p>
            </div>
          </details>
        </div>
      </header>
      <aside className="sidebar" aria-label="Saved knowledge filters">
        <h2>Saved knowledge</h2>
        <div className="search-control">
          <SearchIcon />
          <label className="sr-only" htmlFor="saved-search">
            Search saved schemas
          </label>
          <input
            id="saved-search"
            type="search"
            placeholder="Search saved schemas"
            value={filters.search}
            onChange={(event) => filter('search', event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="filters">
          <label htmlFor="domain-filter">
            Domain
            <select
              id="domain-filter"
              value={filters.domain}
              onChange={(event) => filter('domain', event.target.value)}
            >
              <option value="all">All domains</option>
              {domains.map((domain) => (
                <option key={domain}>{domain}</option>
              ))}
            </select>
          </label>
          <label htmlFor="node-filter">
            Node type
            <select
              id="node-filter"
              value={filters.nodeType}
              onChange={(event) =>
                filter('nodeType', event.target.value as ViewFilters['nodeType'])
              }
            >
              <option value="all">All node types</option>
              {nodeTypes.map((type) => (
                <option value={type} key={type}>
                  {nodeNames[type]}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="evidence-filter">
            Evidence
            <select
              id="evidence-filter"
              value={filters.evidence}
              onChange={(event) =>
                filter('evidence', event.target.value as ViewFilters['evidence'])
              }
            >
              <option value="all">All evidence</option>
              <option value="schema">Schema evidence</option>
              <option value="documentation">Documentation evidence</option>
            </select>
          </label>
          <label htmlFor="relation-filter">
            Relationship
            <select
              id="relation-filter"
              value={filters.edgeType}
              onChange={(event) =>
                filter('edgeType', event.target.value as ViewFilters['edgeType'])
              }
            >
              <option value="all">All relationships</option>
              {edgeTypes.map((type) => (
                <option key={type} value={type}>
                  {relationNames[type]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {filtered ? (
          <button
            className="text-button reset-filters"
            onClick={() => setFilters((current) => ({ ...initialFilters, detail: current.detail }))}
          >
            Clear filters
          </button>
        ) : null}
        <div className="saved-counts">
          <p>{graph.nodes.length} saved nodes</p>
          <p>{graph.edges.length} relationships</p>
          {view.nodes.length !== graph.nodes.length ? (
            <p className="visible-count">{view.nodes.length} nodes visible</p>
          ) : null}
          <span>Local knowledge · persists across sessions</span>
        </div>
      </aside>
      <main id="workspace" className="workspace" tabIndex={-1} aria-label="Graph workspace">
        <div className="workspace-toolbar">
          <div className="segmented" role="group" aria-label="Knowledge scope">
            <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
              All saved knowledge
            </button>
            <button aria-pressed={scope === 'focused'} onClick={() => setScope('focused')}>
              Focused subgraph
            </button>
          </div>
          <div className="view-controls">
            <div className="segmented" role="group" aria-label="Graph view">
              {(['3d', '2d', 'list'] as const).map((viewMode) => (
                <button
                  key={viewMode}
                  aria-pressed={mode === viewMode}
                  onClick={() => setMode(viewMode)}
                >
                  {viewMode === 'list' ? 'List' : viewMode.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              className="fit-button"
              onClick={() => setFitRequest((value) => value + 1)}
              disabled={!view.nodes.length || mode === 'list'}
            >
              <FitIcon />
              Fit view
            </button>
          </div>
        </div>
        {error ? (
          <div className="service-error" role="alert">
            <span>{error}</span>
            <button onClick={retry}>Retry</button>
          </div>
        ) : null}
        <div className="graph-region">
          {!graph.nodes.length ? (
            <div className="empty-state">
              <GraphIcon />
              <h2>
                {status === 'loading' ? 'Opening your local graph…' : 'Your graph starts here.'}
              </h2>
              <p>
                Ask your agent about a schema relationship.
                <br />
                Verified facts accumulate here across sessions.
              </p>
            </div>
          ) : !view.nodes.length ? (
            <div className="canvas-message">
              <h2>
                {scope === 'focused' && !focusAvailable
                  ? 'No focused subgraph yet.'
                  : 'No saved nodes match this view.'}
              </h2>
              <p>
                {scope === 'focused' && !focusAvailable
                  ? 'Your agent can focus a verified path using saved graph IDs.'
                  : 'Adjust the filters or show expanded detail to inspect more saved facts.'}
              </p>
              <button
                onClick={() => {
                  setFilters(initialFilters);
                  setScope('all');
                }}
              >
                Show all saved knowledge
              </button>
            </div>
          ) : mode === 'list' ? (
            <GraphList graph={view} selection={selection} focus={focus} onSelect={setSelection} />
          ) : (
            <GraphCanvas
              graph={view}
              mode={mode}
              onList={() => setMode('list')}
              labels={labels}
              fitRequest={fitRequest}
              selection={selection}
              focus={focus}
              onSelect={setSelection}
            />
          )}
          {focusAvailable ? (
            <div className="focus-status">
              <span>
                Focused path · {focus.nodeIds.length} nodes · {focus.edgeIds.length} relationships
              </span>
              <button
                className="text-button"
                onClick={() => {
                  clearFocus();
                  setScope('all');
                }}
              >
                Clear highlight
              </button>
            </div>
          ) : null}
        </div>
        <footer className="workspace-footer">
          <details className="legend">
            <summary>
              Legend{' '}
              <span className="legend-swatches" aria-hidden="true">
                {nodeTypes.map((type) => (
                  <i key={type} style={{ background: nodeColors[type] }} />
                ))}
              </span>
            </summary>
            <div className="legend-panel">
              <h3>Node types</h3>
              {nodeTypes.map((type) => (
                <p key={type}>
                  <i style={{ background: nodeColors[type] }} />
                  {nodeNames[type]}
                </p>
              ))}
              <h3>Relationships</h3>
              {edgeTypes.map((type) => (
                <p key={type}>
                  <span className="edge-swatch" style={{ borderColor: edgeColors[type] }} />
                  {relationNames[type]}
                </p>
              ))}
              <p>→ Source defines the directional relationship</p>
              <p>Dashed 2D line: documentation evidence</p>
              <p>Curved 3D line: documented association</p>
              <p>
                <i style={{ background: '#184dd3' }} />
                Focused / reused
              </p>
              <p>
                <i style={{ background: '#bf7822' }} />
                Latest additions
              </p>
              <p>List view also identifies these states in text.</p>
            </div>
          </details>
          <span className="revision">Revision {graph.revision}</span>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={labels}
              onChange={(event) => setLabels(event.target.checked)}
            />
            <span className="toggle" aria-hidden="true" />
            Show labels
          </label>
          <label className="detail-control">
            <span className="sr-only">Level of detail</span>
            <select
              value={filters.detail}
              onChange={(event) => filter('detail', event.target.value as ViewFilters['detail'])}
            >
              <option value="expanded">Expanded detail</option>
              <option value="compact">Compact entities</option>
            </select>
          </label>
        </footer>
        {filters.detail === 'compact' ? (
          <p className="compact-note">
            Compact view hides properties and fragments. Expand detail to inspect their saved paths.
          </p>
        ) : null}
      </main>
      <Inspector graph={graph} selection={selection} onSelect={setSelection} />
      <div className="sr-only" role="status" aria-live="polite">
        Graph revision {graph.revision}. {view.nodes.length} visible nodes and {view.edges.length}{' '}
        relationships.{focusAvailable ? ' A saved path is highlighted.' : ''}
      </div>
    </div>
  );
}
