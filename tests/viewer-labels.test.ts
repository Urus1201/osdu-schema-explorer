import { describe, expect, it } from 'vitest';
import { placeLabels, type LabelRequest } from '../src/viewer/graph-labels.js';
import { linkMidpoint } from '../src/viewer/graph-painter.js';
import type { RendererLink, RendererNode } from '../src/viewer/graph-adapter.js';

const request = (id: string, x: number, priority = 0): LabelRequest => ({
  id,
  x,
  y: 50,
  width: 80,
  height: 18,
  radius: 6,
  priority,
});

describe('canvas label placement', () => {
  it('keeps parallel 3D property captions on their separate curved references', () => {
    const edge = {
      source: { x: 0, y: 0, z: 0 },
      target: { x: 100, y: 0, z: 0 },
      curvature: 0.2,
    } as RendererLink;
    expect(linkMidpoint(edge, 3)).toEqual({ x: 50, y: -10, z: 0 });
    expect(linkMidpoint({ ...edge, curvature: -0.2 }, 3)).toEqual({ x: 50, y: 10, z: 0 });
  });

  it('positions self-reference captions on the loop instead of over the entity', () => {
    const node = { x: 0, y: 0, z: 0 } as RendererNode;
    const edge = { source: node, target: node, curvature: 0.4 } as RendererLink;
    expect(linkMidpoint(edge, 3)).toEqual({ x: 10.5, y: 10.5, z: 0 });
    expect(linkMidpoint(edge, 2)).toEqual({ x: 10.5, y: -10.5, z: 0 });
  });

  it('places a caption on a curved reference along the depth axis', () => {
    const edge = {
      source: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 100 },
      curvature: 0.2,
    } as RendererLink;
    expect(linkMidpoint(edge, 3)).toEqual({ x: -10, y: 0, z: 50 });
  });

  it('moves a label to another side when its first position overlaps another label', () => {
    const labels = placeLabels([request('a', 100), request('b', 130)], []);
    const a = labels.get('a')!;
    const b = labels.get('b')!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(
      a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y,
    ).toBe(true);
  });

  it('reserves space for selected labels before crowded background labels', () => {
    const labels = placeLabels(
      [request('background', 100), request('selected', 100, 100)],
      [{ x: 0, y: 0, width: 100, height: 200 }],
      { x: 0, y: 0, width: 220, height: 80 },
    );
    expect(labels.has('selected')).toBe(true);
    expect(labels.has('background')).toBe(false);
  });

  it('omits labels that cannot fit without overlapping nodes or clipping the viewport', () => {
    const labels = placeLabels([request('a', 100)], [{ x: 0, y: 0, width: 240, height: 200 }], {
      x: 0,
      y: 0,
      width: 240,
      height: 200,
    });
    expect(labels.size).toBe(0);
    expect(placeLabels([request('a', 100)], [], { x: 90, y: 40, width: 25, height: 25 }).size).toBe(
      0,
    );
  });
});
