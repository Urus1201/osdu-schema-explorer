import { useCallback, useEffect, useRef } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import type { SceneProps } from './graph-canvas.js';
import {
  edgeColors,
  focusedNodeIds,
  nodeColors,
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
  const addedNodes = new Set(focus.addedNodeIds);
  const addedEdges = new Set(focus.addedEdgeIds);
  const focusedNodes = focusedNodeIds(data, focus);
  const focusedEdges = new Set(focus.edgeIds);
  const colorNode = (node: RendererNode) =>
    addedNodes.has(node.id)
      ? '#bf7822'
      : focusedNodes.has(node.id) || selection?.id === node.id
        ? '#184dd3'
        : nodeColors[node.type];
  const colorEdge = (edge: RendererLink) =>
    addedEdges.has(edge.id)
      ? '#bf7822'
      : focusedEdges.has(edge.id) || selection?.id === edge.id
        ? '#184dd3'
        : edgeColors[edge.type];
  const drawLabel = useCallback((node: RendererNode) => {
    const text = new SpriteText(node.label);
    text.color = '#26354b';
    text.textHeight = 3.4;
    text.backgroundColor = '#f4f6f9';
    text.padding = 1.2;
    text.position.y = 7;
    return text;
  }, []);
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
    if (!node || node.x === undefined || node.y === undefined || node.z === undefined) return;
    const distance = 75;
    const norm = Math.hypot(node.x, node.y, node.z) || 1;
    renderer.current?.cameraPosition(
      {
        x: node.x + (distance * node.x) / norm,
        y: node.y + (distance * node.y) / norm,
        z: node.z + distance * (node.z / norm || 1),
      },
      { x: node.x, y: node.y, z: node.z },
      0,
    );
  }, [selection, data]);
  return (
    <ForceGraph3D<RendererNode, RendererLink>
      ref={renderer}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="#f4f6f9"
      showNavInfo={false}
      nodeColor={colorNode}
      nodeOpacity={1}
      nodeRelSize={4.5}
      nodeLabel={() => ''}
      linkLabel={() => ''}
      nodeThreeObject={labels ? drawLabel : undefined}
      nodeThreeObjectExtend={true}
      linkColor={colorEdge}
      linkOpacity={0.8}
      linkWidth={(edge) => (focusedEdges.has(edge.id) || addedEdges.has(edge.id) ? 1.8 : 0.8)}
      linkDirectionalArrowLength={(edge) => (edge.direction === 'forward' ? 5 : 0)}
      linkDirectionalArrowRelPos={0.85}
      linkCurvature={(edge) => (edge.type === 'documented_association' ? 0.12 : 0)}
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
