import type { Evidence, Graph, GraphEdge, GraphNode } from '../core/model.js';
import type { Selection } from './graph-canvas.js';
import { nodeNames, relationNames, safeSourceUrl } from './graph-adapter.js';
import { DocumentIcon } from './icons.js';

function relationshipSource(graph: Graph, edge: GraphEdge): GraphNode | undefined {
  const source = graph.nodes.find((node) => node.id === edge.source);
  return source?.type === 'property'
    ? (graph.nodes.find((node) => node.id === source.ownerId) ?? source)
    : source;
}

function propertyName(edge: GraphEdge): string {
  return edge.fieldPath.split('.').at(-1) || edge.fieldPath;
}

function EntityRelationships({
  graph,
  node,
  onSelect,
}: {
  graph: Graph;
  node: GraphNode;
  onSelect: (selection: Selection) => void;
}) {
  const nodes = new Map(graph.nodes.map((item) => [item.id, item]));
  const relationships = graph.edges.filter(
    (edge) =>
      (edge.type === 'references_record' || edge.type === 'documented_association') &&
      (edge.target === node.id ||
        edge.source === node.id ||
        nodes.get(edge.source)?.ownerId === node.id),
  );
  if (!relationships.length) return null;
  return (
    <section className="entity-relationships" aria-label="Entity relationships">
      <h4>
        Relationships <span>{relationships.length}</span>
      </h4>
      <ul>
        {relationships.map((edge) => {
          const source = relationshipSource(graph, edge);
          const target = nodes.get(edge.target);
          return (
            <li key={edge.id}>
              <button
                className="relationship-button"
                aria-label={`Inspect ${propertyName(edge)} from ${source?.label} to ${target?.label}`}
                onClick={() => onSelect({ type: 'edge', id: edge.id })}
              >
                <code>{propertyName(edge)}</code>
                <span>
                  {source?.label} {edge.direction === 'forward' ? '→' : '—'} {target?.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EvidenceCard({ evidence }: { evidence: Evidence }) {
  const url = safeSourceUrl(evidence.location);
  return (
    <section className="evidence-card" aria-label={`${evidence.category} evidence`}>
      <span className={`badge ${evidence.category === 'schema' ? 'verified' : 'documented'}`}>
        {evidence.category === 'schema' ? 'Schema evidence' : 'Documentation evidence'}
      </span>
      <dl>
        <Detail label="Source">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">
              {evidence.location}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span>{evidence.location}</span>
          )}
        </Detail>
        <Detail label="Namespace">{evidence.namespace}</Detail>
        <Detail label="Source revision">
          <code>{evidence.revision}</code>
        </Detail>
        <Detail label="Content hash">
          <code>{evidence.contentHash}</code>
        </Detail>
        <Detail label="Owning schema">
          <code>{evidence.schemaKind}</code>
        </Detail>
        <Detail label="Schema version">{evidence.schemaVersion}</Detail>
        <Detail label="JSON Pointer">
          <code>{evidence.pointer || '(document root)'}</code>
        </Detail>
        {evidence.dialect ? <Detail label="JSON Schema dialect">{evidence.dialect}</Detail> : null}
        {evidence.excerpt ? <Detail label="Supporting text">{evidence.excerpt}</Detail> : null}
        <Detail label="Visibility">{evidence.visibility}</Detail>
        <Detail label="Source license">{evidence.license}</Detail>
        <Detail label="Redistribution review">{evidence.redistribution}</Detail>
        {evidence.attribution ? <Detail label="Attribution">{evidence.attribution}</Detail> : null}
      </dl>
      {evidence.origin ? (
        <details>
          <summary>Origin fragment and use sites</summary>
          <dl>
            <Detail label="Origin schema">{evidence.origin.schemaKind}</Detail>
            <Detail label="Origin version">{evidence.origin.schemaVersion}</Detail>
            <Detail label="Origin source">{evidence.origin.location}</Detail>
            <Detail label="Origin pointer">
              <code>{evidence.origin.pointer || '(document root)'}</code>
            </Detail>
          </dl>
          {evidence.origin.useSites.map((site, index) => (
            <p key={index} className="use-site">
              <strong>{site.schemaKind}</strong>
              <br />
              {site.location}
              <br />
              <code>{site.pointer || '(document root)'}</code>
            </p>
          ))}
        </details>
      ) : null}
    </section>
  );
}

export function Inspector({
  graph,
  selection,
  onSelect,
}: {
  graph: Graph;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const node =
    selection?.type === 'node' ? graph.nodes.find((item) => item.id === selection.id) : undefined;
  const edge =
    selection?.type === 'edge' ? graph.edges.find((item) => item.id === selection.id) : undefined;
  const item = node ?? edge;
  const evidence = item
    ? graph.evidence.filter((entry) => item.evidenceIds.includes(entry.id))
    : [];
  const source = edge ? relationshipSource(graph, edge) : undefined;
  const target = edge ? graph.nodes.find((item) => item.id === edge.target) : undefined;
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="panel-heading">
        <h2>{edge ? 'Relationship' : 'Inspector'}</h2>
        {item ? (
          <button
            className="close-button"
            onClick={() => onSelect(null)}
            aria-label="Clear selection"
          >
            ×
          </button>
        ) : null}
      </div>
      {item ? (
        <div className="inspection-body">
          {node ? <p className="eyebrow">{nodeNames[node.type]}</p> : null}
          <h3>
            {node?.label ??
              `${source?.label ?? edge?.source} ${edge?.direction === 'forward' ? '→' : '—'} ${target?.label ?? edge?.target}`}
          </h3>
          {item.description ? <p className="description">{item.description}</p> : null}
          {edge ? (
            <dl className="relationship-summary">
              <Detail label="Source">
                <button
                  className="text-button"
                  onClick={() => onSelect({ type: 'node', id: source?.id ?? edge.source })}
                >
                  {source?.label ?? edge.source}
                </button>
              </Detail>
              {edge.fieldPath ? (
                <Detail label="Property">
                  <code>{propertyName(edge)}</code>
                </Detail>
              ) : null}
              <Detail label="Target">
                <button
                  className="text-button"
                  onClick={() => onSelect({ type: 'node', id: edge.target })}
                >
                  {target?.label ?? edge.target}
                </button>
              </Detail>
              {edge.fieldPath ? (
                <Detail label="Property path">
                  <code>{edge.fieldPath}</code>
                </Detail>
              ) : null}
            </dl>
          ) : null}
          {node && node.type !== 'property' ? (
            <EntityRelationships graph={graph} node={node} onSelect={onSelect} />
          ) : null}
          <details className="schema-details">
            <summary>Schema details</summary>
            <dl className="fact-details">
              <Detail label="Stable ID">
                <code>{item.id}</code>
              </Detail>
              {node ? (
                <>
                  <Detail label="Kind">
                    <code>{node.kind}</code>
                  </Detail>
                  <Detail label="Selected version">{node.version}</Detail>
                  <Detail label="Domain">{node.domain}</Detail>
                  <Detail label="Namespace">{node.namespace}</Detail>
                  {node.propertyPath ? (
                    <Detail label="Property path">
                      <code>{node.propertyPath}</code>
                    </Detail>
                  ) : null}
                  {node.occurrencePath ? (
                    <Detail label="Occurrence path">
                      <code>{node.occurrencePath}</code>
                    </Detail>
                  ) : null}
                  {node.ownerId ? (
                    <Detail label="Owning node">
                      <button
                        className="text-button"
                        onClick={() => onSelect({ type: 'node', id: node.ownerId! })}
                      >
                        {graph.nodes.find((item) => item.id === node.ownerId)?.label ??
                          node.ownerId}
                      </button>
                    </Detail>
                  ) : null}
                  <Detail label="Schema hash">
                    <code>{node.schemaHash}</code>
                  </Detail>
                </>
              ) : null}
              {edge ? (
                <>
                  <Detail label="Relationship">{relationNames[edge.type]}</Detail>
                  <Detail label="Source schema">
                    <button
                      className="text-button"
                      onClick={() => onSelect({ type: 'node', id: source?.id ?? edge.source })}
                    >
                      {source?.label ?? edge.source}
                    </button>
                  </Detail>
                  <Detail label="Target schema">
                    <button
                      className="text-button"
                      onClick={() => onSelect({ type: 'node', id: edge.target })}
                    >
                      {target?.label ?? edge.target}
                    </button>
                  </Detail>
                  <Detail label="Direction">
                    {edge.direction === 'forward' ? 'Source → target' : 'Undirected'}
                  </Detail>
                  <Detail label="Field path">
                    <code>{edge.fieldPath}</code>
                  </Detail>
                  <Detail label="Evidence category">{edge.evidenceCategory}</Detail>
                  <Detail label="Branch conditions">
                    {edge.branch.length
                      ? edge.branch.map((branch) => (
                          <code className="branch" key={branch}>
                            {branch}
                          </code>
                        ))
                      : 'Unconditional'}
                  </Detail>
                  <Detail label="Declared target constraint">
                    {edge.targetConstraint ?? 'No version constraint declared'}
                  </Detail>
                  <Detail label="Exploration target version">
                    {target?.version ?? 'Not available'}
                  </Detail>
                  <Detail label="Field requiredness">
                    {edge.required === undefined
                      ? 'Not specified'
                      : edge.required
                        ? 'Required field'
                        : 'Optional field'}
                  </Detail>
                  {edge.minItems !== undefined ? (
                    <Detail label="Minimum array items">{edge.minItems}</Detail>
                  ) : null}
                  {edge.maxItems !== undefined ? (
                    <Detail label="Maximum array items">{edge.maxItems}</Detail>
                  ) : null}
                </>
              ) : null}
            </dl>
          </details>
          {edge?.type === 'references_record' ? (
            <p className="inspection-note">
              The schema defines a reference field. This does not assert a link between business
              records.
            </p>
          ) : null}
          {edge?.type === 'composes_schema' ? (
            <p className="inspection-note">
              Schema composition describes reuse; it does not imply domain inheritance.
            </p>
          ) : null}
          <h4>
            Source evidence <span>{evidence.length}</span>
          </h4>
          {evidence.map((entry) => (
            <EvidenceCard key={entry.id} evidence={entry} />
          ))}
          {edge ? (
            <p className="relationship-hint">Select a relationship to inspect its property.</p>
          ) : null}
        </div>
      ) : (
        <div className="inspector-empty">
          <DocumentIcon />
          <p>
            Select a saved schema or
            <br />
            relationship to inspect
            <br />
            its evidence.
          </p>
        </div>
      )}
    </aside>
  );
}
