import { useEffect, useRef } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { SceneProps } from './graph-canvas.js';
import {
  edgeColors,
  focusedNodeIds,
  nodeColors,
  type RendererLink,
  type RendererNode,
} from './graph-adapter.js';

export default function Graph2D({
  data,
  width,
  height,
  labels,
  fitRequest,
  selection,
  focus,
  onSelect,
}: SceneProps) {
  const renderer = useRef<ForceGraphMethods<RendererNode, RendererLink> | undefined>(undefined);
  const addedNodes = new Set(focus.addedNodeIds);
  const addedEdges = new Set(focus.addedEdgeIds);
  const focusedNodes = focusedNodeIds(data, focus);
  const focusedEdges = new Set(focus.edgeIds);
  useEffect(() => {
    renderer.current?.zoomToFit(0, 65);
  }, [fitRequest]);
  useEffect(() => {
    const ids = focusedNodeIds(data, focus);
    if (ids.size) renderer.current?.zoomToFit(0, 65, (node) => ids.has(node.id));
  }, [focus, data]);
  useEffect(() => {
    if (selection?.type !== 'node') return;
    const node = data.nodes.find((item) => item.id === selection.id);
    if (node?.x !== undefined && node.y !== undefined)
      renderer.current?.centerAt(node.x, node.y, 0);
  }, [selection, data]);
  return (
    <ForceGraph2D<RendererNode, RendererLink>
      ref={renderer}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="#f4f6f9"
      nodeColor={(node) =>
        addedNodes.has(node.id)
          ? '#bf7822'
          : focusedNodes.has(node.id) || selection?.id === node.id
            ? '#184dd3'
            : nodeColors[node.type]
      }
      nodeRelSize={5}
      nodeLabel={() => ''}
      linkLabel={() => ''}
      nodeCanvasObjectMode={() => 'after'}
      nodeCanvasObject={(node, context, scale) => {
        if (!labels) return;
        const fontSize = 12 / scale;
        context.font = `${fontSize}px system-ui`;
        context.textAlign = 'center';
        context.textBaseline = 'top';
        context.fillStyle = '#26354b';
        context.fillText(node.label, node.x ?? 0, (node.y ?? 0) + 7);
      }}
      linkColor={(edge) =>
        addedEdges.has(edge.id)
          ? '#bf7822'
          : focusedEdges.has(edge.id) || selection?.id === edge.id
            ? '#184dd3'
            : edgeColors[edge.type]
      }
      linkWidth={(edge) => (focusedEdges.has(edge.id) || addedEdges.has(edge.id) ? 2.5 : 1.1)}
      linkLineDash={(edge) => (edge.evidenceCategory === 'documentation' ? [5, 4] : null)}
      linkDirectionalArrowLength={(edge) => (edge.direction === 'forward' ? 5 : 0)}
      linkDirectionalArrowRelPos={0.85}
      cooldownTicks={100}
      onEngineStop={() => {
        if (fitRequest === 0)
          renderer.current?.zoomToFit(
            0,
            65,
            focusedNodes.size ? (node) => focusedNodes.has(node.id) : undefined,
          );
      }}
      onNodeClick={(node) => onSelect({ type: 'node', id: node.id })}
      onLinkClick={(edge) => onSelect({ type: 'edge', id: edge.id })}
      onBackgroundClick={() => onSelect(null)}
    />
  );
}
