import { useCallback, useEffect, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import { Group } from 'three';
import type { SceneProps } from './graph-canvas.js';
import {
  edgeColors,
  focusedNodeIds,
  nodeLabelLines,
  nodeVisual,
  type RendererLink,
  type RendererNode,
} from './graph-adapter.js';

export default function Graph3D({
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
  const colorEdge = (edge: RendererLink) =>
    addedEdges.has(edge.id)
      ? '#bf7822'
      : focusedEdges.has(edge.id) || selection?.id === edge.id
        ? '#184dd3'
        : edgeColors[edge.type];
  const drawLabel = useCallback(
    (node: RendererNode) => {
      const selected = selection?.type === 'node' && selection.id === node.id;
      const visual = nodeVisual(node, {
        selected,
        focused: focusedNodes.has(node.id),
        added: addedNodes.has(node.id),
      });
      const visible = node.type === 'entity' || selected || hovered === node.id;
      if (!visible) return new Group();
      const text = new SpriteText(nodeLabelLines(node).join('\n'));
      text.color = node.type === 'entity' ? '#162338' : '#43536e';
      text.textHeight = node.type === 'entity' ? 16 : 12;
      text.fontFace = 'system-ui';
      text.fontWeight = node.type === 'entity' ? '600' : '400';
      text.backgroundColor = '#f4f6f9ee';
      text.padding = 1;
      text.borderRadius = 1;
      if (visual.outline) {
        text.borderColor = visual.outline;
        text.borderWidth = selected ? 0.5 : 0.2;
      }
      text.position.y = 22;
      return text;
    },
    [selection, hovered, focus, data],
  );
  useEffect(() => {
    settled.current = false;
    renderer.current?.d3Force('charge')?.strength(-350);
    renderer.current?.d3Force('link')?.distance(110);
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
    <ForceGraph3D<RendererNode, RendererLink>
      ref={renderer}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="#f4f6f9"
      showNavInfo={false}
      nodeColor={(node) => nodeVisual(node, {}).color}
      nodeVal={(node) => nodeVisual(node, {}).value}
      nodeOpacity={1}
      nodeRelSize={6}
      nodeLabel={() => ''}
      linkLabel={() => ''}
      nodeThreeObject={labels ? drawLabel : undefined}
      nodeThreeObjectExtend={true}
      linkColor={colorEdge}
      linkOpacity={0.8}
      linkWidth={(edge) =>
        selection?.id === edge.id
          ? 1.8
          : focusedEdges.has(edge.id) || addedEdges.has(edge.id)
            ? 0.8
            : 0.6
      }
      linkDirectionalArrowLength={(edge) => (edge.direction === 'forward' ? 5 : 0)}
      linkDirectionalArrowRelPos={0.85}
      linkCurvature={(edge) => (edge.type === 'documented_association' ? 0.12 : 0)}
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
