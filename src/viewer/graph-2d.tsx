import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { SceneProps } from './graph-canvas.js';
import {
  edgeColors,
  focusedNodeIds,
  nodeVisual,
  rendererHighlights,
  selectionNeighborhood,
  type RendererLink,
  type RendererNode,
} from './graph-adapter.js';
import { graphTheme, highlightedEndpointIds, nodeRadius, paintLabels } from './graph-painter.js';
import { FitIcon, ZoomIcon } from './icons.js';

export default function Graph2D({
  data,
  width,
  height,
  labels,
  selection,
  focus,
  onSelect,
}: SceneProps) {
  const renderer = useRef<ForceGraphMethods<RendererNode, RendererLink> | undefined>(undefined);
  const settled = useRef(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const { addedNodes, addedEdges, focusedNodes, focusedEdges } = useMemo(
    () => rendererHighlights(data, focus),
    [data, focus],
  );
  const neighborhood = useMemo(() => selectionNeighborhood(data, selection), [data, selection]);
  const hoveredEndpoints = highlightedEndpointIds(data, hoveredEdge);
  const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300;
  const fit = () => renderer.current?.zoomToFit(reducedMotion(), Math.min(95, width * 0.17));

  useEffect(() => {
    settled.current = false;
    renderer.current?.d3Force('charge')?.strength(-900);
    renderer.current?.d3Force('link')?.distance(170);
    renderer.current?.d3ReheatSimulation();
  }, [data]);
  useEffect(() => {
    if (settled.current) fit();
  }, [width, height]);
  useEffect(() => {
    const ids = focusedNodeIds(data, focus);
    if (settled.current && ids.size)
      renderer.current?.zoomToFit(reducedMotion(), Math.min(95, width * 0.17), (node) =>
        ids.has(node.id),
      );
  }, [focus, data]);
  return (
    <>
      <ForceGraph2D<RendererNode, RendererLink>
        ref={renderer}
        graphData={data}
        width={width}
        height={height}
        backgroundColor={graphTheme.canvas}
        nodeLabel={() => ''}
        linkLabel={() => ''}
        nodeCanvasObject={(node, context, scale) => {
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          const selected =
            (selection?.type === 'node' && selection.id === node.id) ||
            (selection?.type === 'edge' && neighborhood.nodes.has(node.id));
          const visual = nodeVisual(node, {
            selected,
            focused: focusedNodes.has(node.id) || hoveredEndpoints.has(node.id),
            added: addedNodes.has(node.id),
          });
          const dimmed = neighborhood.nodes.size > 0 && !neighborhood.nodes.has(node.id);
          const radius = nodeRadius(node) / scale;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fillStyle = dimmed ? visual.color + '88' : visual.color;
          context.fill();
          context.strokeStyle = '#ffffff';
          context.lineWidth = 2 / scale;
          context.stroke();
          if (visual.outline || hoveredNode === node.id) {
            context.beginPath();
            context.arc(x, y, radius + 3 / scale, 0, Math.PI * 2);
            context.strokeStyle = visual.outline ?? graphTheme.selected;
            context.lineWidth = 1.5 / scale;
            context.stroke();
          }
        }}
        nodePointerAreaPaint={(node, color, context, scale) => {
          context.beginPath();
          context.arc(node.x ?? 0, node.y ?? 0, 11 / scale, 0, Math.PI * 2);
          context.fillStyle = color;
          context.fill();
        }}
        onRenderFramePost={(context, scale) => {
          const start = renderer.current?.screen2GraphCoords(14, 14);
          const end = renderer.current?.screen2GraphCoords(width - 14, height - 62);
          if (!start || !end) return;
          paintLabels({
            context,
            scale,
            data,
            selection,
            hoveredNode,
            hoveredEdge,
            neighborhood,
            focusedNodes,
            labels,
            bounds: {
              x: start.x * scale,
              y: start.y * scale,
              width: (end.x - start.x) * scale,
              height: (end.y - start.y) * scale,
            },
          });
        }}
        linkColor={(edge) =>
          selection?.id === edge.id || hoveredEdge === edge.id || focusedEdges.has(edge.id)
            ? graphTheme.selected
            : addedEdges.has(edge.id)
              ? '#bf7822'
              : neighborhood.nodes.size && !neighborhood.edges.has(edge.id)
                ? graphTheme.dimmedLine
                : edge.evidenceCategory === 'documentation'
                  ? edgeColors[edge.type]
                  : graphTheme.line
        }
        linkWidth={(edge) =>
          selection?.id === edge.id || hoveredEdge === edge.id
            ? 2
            : focusedEdges.has(edge.id) || neighborhood.edges.has(edge.id)
              ? 1.3
              : 0.8
        }
        linkCurvature={(edge) => edge.curvature ?? 0}
        linkLineDash={(edge) => (edge.evidenceCategory === 'documentation' ? [5, 4] : null)}
        linkDirectionalArrowLength={(edge) => (edge.direction === 'forward' ? 5 : 0)}
        linkDirectionalArrowRelPos={0.88}
        linkHoverPrecision={7}
        warmupTicks={100}
        cooldownTicks={100}
        onEngineStop={() => {
          if (!settled.current) {
            settled.current = true;
            renderer.current?.zoomToFit(
              0,
              Math.min(95, width * 0.17),
              focusedNodes.size ? (node) => focusedNodes.has(node.id) : undefined,
            );
          }
        }}
        onNodeClick={(node) => onSelect({ type: 'node', id: node.id })}
        onNodeHover={(node) => setHoveredNode(node?.id ?? null)}
        onLinkClick={(edge) => onSelect({ type: 'edge', id: edge.id })}
        onLinkHover={(edge) => setHoveredEdge(edge?.id ?? null)}
        onBackgroundClick={() => onSelect(null)}
      />
      <div className="segmented canvas-controls" role="group" aria-label="Canvas navigation">
        <button
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() =>
            renderer.current?.zoom((renderer.current?.zoom() ?? 1) * 1.35, reducedMotion())
          }
        >
          <ZoomIcon />
        </button>
        <button
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() =>
            renderer.current?.zoom((renderer.current?.zoom() ?? 1) / 1.35, reducedMotion())
          }
        >
          <ZoomIcon out />
        </button>
        <button aria-label="Fit view" title="Fit view" onClick={fit}>
          <FitIcon />
        </button>
      </div>
    </>
  );
}
