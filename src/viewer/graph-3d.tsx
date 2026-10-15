import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import { Group } from 'three';
import type { SceneProps } from './graph-canvas.js';
import {
  edgeColors,
  focusedNodeIds,
  nodeLabelLines,
  nodeVisual,
  rendererHighlights,
  selectionNeighborhood,
  type RendererLink,
  type RendererNode,
} from './graph-adapter.js';
import { graphTheme, linkMidpoint, relationshipLabel } from './graph-painter.js';
import { useGraph3DNavigation } from './graph-3d-navigation.js';
import { selectedNodeIds } from './graph-navigation.js';

export default function Graph3D({
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
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const navigation = useGraph3DNavigation(renderer, { data, selection, onSelect });
  const selectedNodes = useMemo(
    () => selectedNodeIds(data, navigation.selected),
    [data, navigation.selected],
  );
  const selectedEdges = useMemo(
    () =>
      new Set(navigation.selected.filter((item) => item.type === 'edge').map((item) => item.id)),
    [navigation.selected],
  );
  const { addedNodes, addedEdges, focusedNodes, focusedEdges } = useMemo(
    () => rendererHighlights(data, focus),
    [data, focus],
  );
  const neighborhood = useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>();
    for (const item of navigation.selected) {
      const adjacent = selectionNeighborhood(data, item);
      adjacent.nodes.forEach((id) => nodes.add(id));
      adjacent.edges.forEach((id) => edges.add(id));
    }
    return { nodes, edges };
  }, [data, navigation.selected]);
  const linksById = useMemo(() => new Map(data.links.map((edge) => [edge.id, edge])), [data]);
  const captionEdge = hoveredEdge ?? (selection?.type === 'edge' ? selection.id : null);
  const curvature = (edge: RendererLink) =>
    edge.curvature || (edge.type === 'documented_association' ? 0.12 : 0);
  const colorEdge = (edge: RendererLink) =>
    focusedEdges.has(edge.id) || selectedEdges.has(edge.id) || hoveredEdge === edge.id
      ? '#184dd3'
      : addedEdges.has(edge.id)
        ? '#bf7822'
        : neighborhood.nodes.size && !neighborhood.edges.has(edge.id)
          ? graphTheme.dimmedLine
          : edgeColors[edge.type];
  const drawLabel = useCallback(
    (node: RendererNode) => {
      const selected = selectedNodes.has(node.id);
      const visual = nodeVisual(node, {
        selected,
        focused: focusedNodes.has(node.id),
        added: addedNodes.has(node.id),
      });
      const visible =
        node.type === 'entity' || node.type === 'reference_data' || selected || hovered === node.id;
      if (!visible) return new Group();
      const text = new SpriteText(nodeLabelLines(node).join('\n'));
      text.color =
        neighborhood.nodes.size && !neighborhood.nodes.has(node.id)
          ? graphTheme.muted
          : graphTheme.text;
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
    [selectedNodes, hovered, neighborhood, focusedNodes, addedNodes],
  );
  useEffect(() => {
    settled.current = false;
    renderer.current?.d3Force('charge')?.strength(-350);
    renderer.current?.d3Force('link')?.distance(110);
    renderer.current?.d3ReheatSimulation();
  }, [data]);
  useEffect(() => {
    if (settled.current) navigation.fit();
  }, [width, height]);
  useEffect(() => {
    const ids = focusedNodeIds(data, focus);
    if (settled.current && ids.size) navigation.fit(ids);
  }, [focus, data]);
  return (
    <div className="graph-3d-viewport" ref={navigation.viewport} {...navigation.viewportProps}>
      <ForceGraph3D<RendererNode, RendererLink>
        ref={renderer}
        graphData={data}
        width={width}
        height={height}
        backgroundColor="#f4f6f9"
        showNavInfo={false}
        controlType="orbit"
        enableNodeDrag={false}
        nodeColor={(node) =>
          neighborhood.nodes.size && !neighborhood.nodes.has(node.id)
            ? '#a4b4be'
            : nodeVisual(node, {}).color
        }
        nodeVal={(node) => nodeVisual(node, {}).value}
        nodeOpacity={1}
        nodeRelSize={6}
        nodeLabel={() => ''}
        linkLabel={() => ''}
        linkThreeObjectExtend={true}
        linkThreeObject={(edge) => {
          if (captionEdge !== edge.id) return new Group();
          const text = new SpriteText(relationshipLabel(edge));
          text.color = graphTheme.selected;
          text.textHeight = 10;
          text.fontFace = 'system-ui';
          text.backgroundColor = graphTheme.canvas;
          text.padding = 2;
          return text;
        }}
        linkPositionUpdate={(object, _coordinates, edge) => {
          const link = linksById.get(edge.id);
          const position = link && linkMidpoint({ ...link, curvature: curvature(link) }, 3);
          if (position) object.position.set(position.x, position.y, position.z);
          return true;
        }}
        nodeThreeObject={labels ? drawLabel : undefined}
        nodeThreeObjectExtend={true}
        linkColor={colorEdge}
        linkOpacity={0.8}
        linkWidth={(edge) =>
          selectedEdges.has(edge.id) || hoveredEdge === edge.id
            ? 1.8
            : focusedEdges.has(edge.id) || addedEdges.has(edge.id)
              ? 0.8
              : 0.6
        }
        linkDirectionalArrowLength={(edge) => (edge.direction === 'forward' ? 5 : 0)}
        linkDirectionalArrowRelPos={0.85}
        linkCurvature={curvature}
        warmupTicks={80}
        cooldownTicks={80}
        onEngineStop={() => {
          if (!settled.current) {
            settled.current = true;
            navigation.fit(focusedNodes.size ? focusedNodes : undefined);
          }
        }}
        onNodeClick={(node, event) => navigation.select({ type: 'node', id: node.id }, event)}
        onNodeHover={(node) => setHovered(node?.id ?? null)}
        onLinkClick={(edge, event) => navigation.select({ type: 'edge', id: edge.id }, event)}
        onLinkHover={(edge) => setHoveredEdge(edge?.id ?? null)}
        onBackgroundClick={(event) => navigation.select(null, event)}
      />
      {navigation.toolbar}
    </div>
  );
}
