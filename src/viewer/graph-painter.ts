import type { Selection } from './graph-canvas.js';
import {
  endpointId,
  nodeLabelLines,
  type RendererGraph,
  type RendererLink,
  type RendererNode,
} from './graph-adapter.js';
import { placeLabels, type LabelBox, type LabelRequest } from './graph-labels.js';

export const graphTheme = {
  canvas: '#f4f6f9',
  text: '#162338',
  muted: '#637188',
  selected: '#184dd3',
  line: '#8c9bae',
  dimmedLine: '#c9d1dc',
};

export function relationshipLabel(edge: RendererLink): string {
  const field = edge.fieldPath.split('.').at(-1) || edge.fieldPath;
  return field
    ? field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    : edge.type === 'composes_schema'
      ? 'Schema composition'
      : 'Association';
}

export function nodeRadius(node: RendererNode): number {
  return node.type === 'property' ? 3 : node.type === 'fragment' ? 4 : 6;
}

/** Midpoint of the force renderers' quadratic curves and cubic self-loops (zero rotation). */
export function linkMidpoint(
  edge: RendererLink,
  dimensions: 2 | 3 = 2,
): { x: number; y: number; z: number } | undefined {
  if (typeof edge.source === 'string' || typeof edge.target === 'string') return;
  const sx = edge.source.x ?? 0;
  const sy = edge.source.y ?? 0;
  const tx = edge.target.x ?? 0;
  const ty = edge.target.y ?? 0;
  const sz = dimensions === 3 ? (edge.source.z ?? 0) : 0;
  const tz = dimensions === 3 ? (edge.target.z ?? 0) : 0;
  const curvature = edge.curvature ?? 0;
  if (sx === tx && sy === ty && sz === tz)
    return {
      x: sx + curvature * 26.25,
      y: sy + curvature * 26.25 * (dimensions === 3 ? 1 : -1),
      z: sz,
    };
  if (sx === tx && sy === ty)
    return { x: sx - ((tz - sz) * curvature) / 2, y: sy, z: (sz + tz) / 2 };
  return {
    x: (sx + tx) / 2 + ((ty - sy) * curvature) / 2,
    y: (sy + ty) / 2 - ((tx - sx) * curvature) / 2,
    z: (sz + tz) / 2,
  };
}

export function paintLabels({
  context,
  scale,
  data,
  selection,
  hoveredNode,
  hoveredEdge,
  neighborhood,
  focusedNodes,
  bounds,
  labels,
}: {
  context: CanvasRenderingContext2D;
  scale: number;
  data: RendererGraph;
  selection: Selection;
  hoveredNode: string | null;
  hoveredEdge: string | null;
  neighborhood: { nodes: Set<string>; edges: Set<string> };
  focusedNodes: Set<string>;
  bounds: LabelBox;
  labels: boolean;
}) {
  const obstacles: LabelBox[] = data.nodes.map((node) => ({
    x: (node.x ?? 0) * scale - nodeRadius(node) - 1,
    y: (node.y ?? 0) * scale - nodeRadius(node) - 1,
    width: nodeRadius(node) * 2 + 2,
    height: nodeRadius(node) * 2 + 2,
  }));
  context.save();
  // Hover previews one caption; the inspector keeps the selected relationship pinned.
  const captionEdge =
    data.links.find((edge) => edge.id === hoveredEdge) ??
    data.links.find((edge) => selection?.type === 'edge' && selection.id === edge.id);
  if (captionEdge) {
    const edge = captionEdge;
    const position = linkMidpoint(edge);
    if (position) {
      const text = relationshipLabel(edge);
      context.font = '500 ' + 12 / scale + 'px system-ui';
      const width = context.measureText(text).width;
      let box: LabelBox | undefined = {
        x: position.x * scale - (width * scale) / 2 - 7,
        y: position.y * scale - 12,
        width: width * scale + 14,
        height: 24,
      };
      if (
        obstacles.some(
          (node) =>
            box!.x < node.x + node.width &&
            box!.x + box!.width > node.x &&
            box!.y < node.y + node.height &&
            box!.y + box!.height > node.y,
        )
      ) {
        box = placeLabels(
          [
            {
              ...box,
              id: edge.id,
              x: position.x * scale,
              y: position.y * scale,
              radius: 0,
              priority: 100,
            },
          ],
          obstacles,
          bounds,
        ).get(edge.id);
      }
      if (box) {
        context.fillStyle = graphTheme.canvas;
        context.fillRect(box.x / scale, box.y / scale, box.width / scale, box.height / scale);
        context.strokeStyle = '#cbd9fa';
        context.lineWidth = 1 / scale;
        context.strokeRect(box.x / scale, box.y / scale, box.width / scale, box.height / scale);
        context.fillStyle = graphTheme.selected;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, (box.x + box.width / 2) / scale, (box.y + box.height / 2) / scale);
        obstacles.push(box);
      }
    }
  }
  if (!labels) {
    context.restore();
    return;
  }
  const requests: LabelRequest[] = [];
  const captions = new Map<string, { lines: string[]; size: number; emphasized: boolean }>();
  for (const node of data.nodes) {
    const active =
      (selection?.type === 'node' && selection.id === node.id) || hoveredNode === node.id;
    const neighbor = neighborhood.nodes.has(node.id);
    const focused = focusedNodes.has(node.id);
    const entity = node.type === 'entity' || node.type === 'reference_data';
    // Structural labels become available on inspection or when zoomed into detail.
    if (!entity && !active && !neighbor && !focused && scale < 1.1) continue;
    const lines = nodeLabelLines(node);
    const size = entity ? 13 : 11;
    context.font = (entity ? '600 ' : '400 ') + size / scale + 'px system-ui';
    const width = Math.max(...lines.map((line) => context.measureText(line).width)) * scale;
    requests.push({
      id: node.id,
      x: (node.x ?? 0) * scale,
      y: (node.y ?? 0) * scale,
      width: width + 4,
      height: lines.length * size * 1.35,
      radius: nodeRadius(node) + 1,
      priority: active ? 100 : neighbor ? 80 : focused ? 60 : entity ? 20 : 0,
    });
    captions.set(node.id, {
      lines,
      size,
      emphasized: !neighborhood.nodes.size || neighbor || active,
    });
  }
  const placed = placeLabels(requests, obstacles, bounds);
  context.textAlign = 'left';
  context.textBaseline = 'top';
  for (const [id, box] of placed) {
    const caption = captions.get(id)!;
    context.fillStyle = graphTheme.canvas;
    context.fillRect(
      (box.x - 2) / scale,
      (box.y - 2) / scale,
      (box.width + 4) / scale,
      (box.height + 4) / scale,
    );
    context.font = (caption.size === 13 ? '600 ' : '400 ') + caption.size / scale + 'px system-ui';
    context.fillStyle = caption.emphasized ? graphTheme.text : graphTheme.muted;
    caption.lines.forEach((line, index) =>
      context.fillText(line, (box.x + 2) / scale, (box.y + index * caption.size * 1.35) / scale),
    );
  }
  context.restore();
}

export function highlightedEndpointIds(
  data: RendererGraph,
  hoveredEdge: string | null,
): Set<string> {
  const edge = data.links.find((item) => item.id === hoveredEdge);
  return new Set(edge ? [endpointId(edge.source), endpointId(edge.target)] : []);
}
