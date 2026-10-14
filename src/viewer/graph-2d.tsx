import { useEffect, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { SceneProps } from './graph-canvas.js';
import {
  edgeColors,
  focusedNodeIds,
  nodeLabelLines,
  nodeVisual,
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
  const settled = useRef(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const addedNodes = new Set(focus.addedNodeIds);
  const addedEdges = new Set(focus.addedEdgeIds);
  const focusedNodes = focusedNodeIds(data, focus);
  const focusedEdges = new Set(focus.edgeIds);
  useEffect(() => {
    settled.current = false;
    renderer.current?.d3Force('charge')?.strength(-700);
    renderer.current?.d3Force('link')?.distance(150);
    renderer.current?.d3ReheatSimulation();
  }, [data]);
  useEffect(() => {
    if (settled.current) renderer.current?.zoomToFit(300, 90);
  }, [fitRequest, width, height]);
  useEffect(() => {
    const ids = focusedNodeIds(data, focus);
    if (settled.current && ids.size)
      renderer.current?.zoomToFit(300, 90, (node) => ids.has(node.id));
  }, [focus, data]);
  return (
    <ForceGraph2D<RendererNode, RendererLink>
      ref={renderer}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="#f4f6f9"
      nodeColor={(node) => nodeVisual(node, {}).color}
      nodeVal={(node) => nodeVisual(node, {}).value}
      nodeRelSize={6}
      nodeLabel={() => ''}
      linkLabel={() => ''}
      nodeCanvasObjectMode={() => 'after'}
      nodeCanvasObject={(node, context, scale) => {
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const visual = nodeVisual(node, {
          selected: selection?.type === 'node' && selection.id === node.id,
          focused: focusedNodes.has(node.id),
          added: addedNodes.has(node.id),
        });
        const radius = 6 * Math.sqrt(visual.value);
        context.beginPath();
        context.arc(x, y, radius + 3 / scale, 0, Math.PI * 2);
        context.strokeStyle = visual.outline ?? '#ffffff';
        context.lineWidth = (selection?.id === node.id ? 3 : 1.5) / scale;
        context.stroke();
        if (
          !labels ||
          (width < 600 &&
            node.type !== 'entity' &&
            selection?.id !== node.id &&
            hovered !== node.id)
        )
          return;
        const lines = nodeLabelLines(node);
        const fontSize = (node.type === 'entity' ? 13 : 11) / scale;
        const lineHeight = fontSize * 1.35;
        context.font = `${node.type === 'entity' ? 600 : 400} ${fontSize}px system-ui`;
        const labelWidth = Math.max(...lines.map((line) => context.measureText(line).width));
        const top = y + radius + 8 / scale;
        context.fillStyle = '#f4f6f9ee';
        context.fillRect(
          x - labelWidth / 2 - 4 / scale,
          top - 2 / scale,
          labelWidth + 8 / scale,
          lines.length * lineHeight + 4 / scale,
        );
        context.textAlign = 'center';
        context.textBaseline = 'top';
        context.fillStyle = node.type === 'entity' ? '#162338' : '#43536e';
        lines.forEach((line, index) => context.fillText(line, x, top + index * lineHeight));
      }}
      linkColor={(edge) =>
        addedEdges.has(edge.id)
          ? '#bf7822'
          : focusedEdges.has(edge.id) || selection?.id === edge.id
            ? '#184dd3'
            : edgeColors[edge.type]
      }
      linkWidth={(edge) =>
        selection?.id === edge.id
          ? 2.5
          : focusedEdges.has(edge.id) || addedEdges.has(edge.id)
            ? 1.5
            : 0.8
      }
      linkLineDash={(edge) => (edge.evidenceCategory === 'documentation' ? [5, 4] : null)}
      linkDirectionalArrowLength={(edge) => (edge.direction === 'forward' ? 5 : 0)}
      linkDirectionalArrowRelPos={0.85}
      warmupTicks={80}
      cooldownTicks={80}
      onEngineStop={() => {
        if (!settled.current) {
          settled.current = true;
          renderer.current?.zoomToFit(
            0,
            90,
            focusedNodes.size ? (node) => focusedNodes.has(node.id) : undefined,
          );
        }
      }}
      onNodeClick={(node) => onSelect({ type: 'node', id: node.id })}
      onNodeHover={(node) => setHovered(node?.id ?? null)}
      onLinkClick={(edge) => onSelect({ type: 'edge', id: edge.id })}
      onBackgroundClick={() => onSelect(null)}
    />
  );
}
