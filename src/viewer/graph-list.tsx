import type { FocusMessage, Graph } from '../core/model.js';
import type { Selection } from './graph-canvas.js';
import { nodeNames, relationNames } from './graph-adapter.js';

export function GraphList({
  graph,
  selection,
  focus,
  onSelect,
}: {
  graph: Graph;
  selection: Selection;
  focus: FocusMessage;
  onSelect: (selection: Selection) => void;
}) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const additions = new Set([...(focus.addedNodeIds ?? []), ...(focus.addedEdgeIds ?? [])]);
  const highlighted = new Set([...focus.nodeIds, ...focus.edgeIds]);
  const state = (id: string) =>
    additions.has(id) ? 'New' : highlighted.has(id) ? 'Reused' : 'Saved';
  return (
    <div className="graph-list">
      <p className="list-intro">Inspect the same saved facts in a keyboard accessible view.</p>
      <table>
        <caption>
          Saved nodes <span>{graph.nodes.length}</span>
        </caption>
        <thead>
          <tr>
            <th scope="col">Schema or property</th>
            <th scope="col">Type</th>
            <th scope="col">Version</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {graph.nodes.map((node) => (
            <tr key={node.id} className={selection?.id === node.id ? 'selected-row' : ''}>
              <th scope="row">
                <button
                  className="text-button"
                  aria-pressed={selection?.type === 'node' && selection.id === node.id}
                  onClick={() => onSelect({ type: 'node', id: node.id })}
                >
                  {node.label}
                </button>
                <small>{node.domain}</small>
              </th>
              <td>{nodeNames[node.type]}</td>
              <td>{node.version}</td>
              <td>
                <span className={`badge ${state(node.id).toLowerCase()}`}>{state(node.id)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <caption>
          Saved relationships <span>{graph.edges.length}</span>
        </caption>
        <thead>
          <tr>
            <th scope="col">Relationship</th>
            <th scope="col">Source / target</th>
            <th scope="col">Evidence</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {graph.edges.map((edge) => (
            <tr key={edge.id} className={selection?.id === edge.id ? 'selected-row' : ''}>
              <th scope="row">
                <button
                  className="text-button"
                  aria-pressed={selection?.type === 'edge' && selection.id === edge.id}
                  onClick={() => onSelect({ type: 'edge', id: edge.id })}
                >
                  {relationNames[edge.type]}
                </button>
                <small>{edge.fieldPath}</small>
              </th>
              <td>
                {nodes.get(edge.source)?.label}
                <span className="relationship-direction">
                  {edge.direction === 'forward' ? ' → ' : ' — '}
                  <span className="sr-only">
                    {edge.direction === 'forward' ? 'references' : 'associated with'}
                  </span>
                </span>
                {nodes.get(edge.target)?.label}
              </td>
              <td>{edge.evidenceCategory}</td>
              <td>
                <span className={`badge ${state(edge.id).toLowerCase()}`}>{state(edge.id)}</span>
              </td>
            </tr>
          ))}
          {!graph.edges.length ? (
            <tr>
              <td colSpan={4}>No saved relationships in this view.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
