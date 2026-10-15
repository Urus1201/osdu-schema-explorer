import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  CameraNavigation,
  navigationCommand,
  selectionAfterClick,
  selectedNodeIds,
} from '../src/viewer/graph-navigation.js';
import type { RendererGraph } from '../src/viewer/graph-adapter.js';

function navigation() {
  const camera = new PerspectiveCamera(60, 2, 0.1, 100000);
  camera.position.set(0, 0, 1000);
  const controls = new OrbitControls(camera, null);
  controls.update();
  return { camera, controls, navigation: new CameraNavigation(camera, controls) };
}

describe('3D navigation', () => {
  it('replaces selection normally and adds distinct objects with a modifier', () => {
    const alpha = { type: 'node' as const, id: 'Alpha' };
    const beta = { type: 'node' as const, id: 'Beta' };
    expect(selectionAfterClick([alpha], beta, false)).toEqual([beta]);
    expect(selectionAfterClick([alpha], beta, true)).toEqual([alpha, beta]);
    expect(selectionAfterClick([alpha, beta], alpha, true)).toEqual([alpha, beta]);
    expect(selectionAfterClick([alpha], null, true)).toEqual([alpha]);
    expect(selectionAfterClick([alpha], null, false)).toEqual([]);
  });

  it('frames selected edges through resolved endpoints and ignores missing objects', () => {
    const graph = {
      nodes: [{ id: 'Alpha' }, { id: 'Beta' }, { id: 'Gamma' }],
      links: [{ id: 'edge', source: { id: 'Alpha' }, target: 'Beta' }],
    } as RendererGraph;
    expect([...selectedNodeIds(graph, [{ type: 'edge', id: 'edge' }])]).toEqual(['Alpha', 'Beta']);
    expect([...selectedNodeIds(graph, [{ type: 'node', id: 'missing' }])]).toEqual([]);
  });

  it('recognizes numpad views even with Num Lock off and leaves browser shortcuts alone', () => {
    expect(navigationCommand({ key: 'End', code: 'Numpad1' })).toBe('front');
    expect(navigationCommand({ key: 'PageDown', code: 'Numpad3' })).toBe('side');
    expect(navigationCommand({ key: 'Home', code: 'Numpad7' })).toBe('top');
    expect(navigationCommand({ key: 'Clear', code: 'Numpad5' })).toBe('projection');
    expect(navigationCommand({ key: 'F', code: 'KeyF' })).toBe('frame');
    expect(navigationCommand({ key: 'Home', code: 'Home' })).toBe('fit');
    expect(navigationCommand({ key: 'r', code: 'KeyR', ctrlKey: true })).toBeNull();
    expect(navigationCommand({ key: 'p', code: 'KeyP', metaKey: true })).toBeNull();
    expect(navigationCommand({ key: 'w', code: 'KeyW', altKey: true })).toBeNull();
  });

  it('fits distant points inside the viewport while preserving the viewing direction', () => {
    const { camera, controls, navigation: nav } = navigation();
    camera.position.set(900, 700, 1000);
    controls.update();
    const direction = camera.getWorldDirection(new Vector3());
    const points = [new Vector3(-500, -200, -100), new Vector3(900, 600, 300)];
    nav.fit(points);
    camera.updateMatrixWorld();
    expect(controls.target.distanceTo(new Vector3(200, 200, 100))).toBeLessThan(1e-6);
    expect(camera.getWorldDirection(new Vector3()).distanceTo(direction)).toBeLessThan(1e-6);
    for (const point of points) {
      const screen = point.clone().project(camera);
      expect(Math.abs(screen.x)).toBeLessThan(0.9);
      expect(Math.abs(screen.y)).toBeLessThan(0.9);
    }
  });

  it('handles a single point, empty coordinates, and a narrow viewport without invalid cameras', () => {
    const { camera, controls, navigation: nav } = navigation();
    nav.fit([]);
    expect(camera.position.distanceTo(new Vector3(0, 0, 1000))).toBeLessThan(1e-6);
    camera.aspect = 0.25;
    nav.fit([new Vector3(100, -50, 0)]);
    expect(controls.target.distanceTo(new Vector3(100, -50, 0))).toBeLessThan(1e-6);
    expect(camera.position.distanceTo(controls.target)).toBeGreaterThan(40);
    expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
  });

  it('uses the available width for a wide, shallow graph', () => {
    const { camera, navigation: nav } = navigation();
    const points = [new Vector3(-500, 0, 0), new Vector3(500, 0, 0)];
    nav.fit(points);
    camera.updateMatrixWorld();
    const x = Math.abs(points[0].clone().project(camera).x);
    expect(x).toBeGreaterThan(0.7);
    expect(x).toBeLessThan(0.9);
  });

  it('switches real projection and ray picking without changing scale at the target', () => {
    const { camera, controls, navigation: nav } = navigation();
    const point = new Vector3(100, 50, 0);
    const before = point.clone().project(camera);
    nav.setProjection('orthographic');
    expect(point.clone().project(camera).x).toBeCloseTo(before.x);
    expect(point.clone().project(camera).y).toBeCloseTo(before.y);
    const farPoint = new Vector3(100, 50, -500);
    expect(farPoint.clone().project(camera).x).toBeCloseTo(before.x);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(0.5, 0), camera);
    expect(raycaster.ray.direction.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-6);
    expect(raycaster.ray.origin.x).toBeGreaterThan(0);
    camera.zoom = 2;
    camera.updateProjectionMatrix();
    const zoomed = point.clone().project(camera);
    nav.setProjection('perspective');
    camera.updateMatrixWorld();
    expect(point.clone().project(camera).x).toBeCloseTo(zoomed.x);
    expect(point.clone().project(camera).y).toBeCloseTo(zoomed.y);
    expect(controls.target.toArray()).toEqual([0, 0, 0]);
  });

  it('keeps orthographic fitting and resizing correct', () => {
    const { camera, navigation: nav } = navigation();
    nav.setProjection('orthographic');
    camera.aspect = 0.5;
    camera.updateProjectionMatrix();
    const points = [new Vector3(-300, 0, 0), new Vector3(300, 0, 0)];
    nav.fit(points);
    camera.updateMatrixWorld();
    expect(Math.abs(points[0].clone().project(camera).x)).toBeLessThan(0.9);
    const oldX = points[0].clone().project(camera).x;
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    expect(points[0].clone().project(camera).x).toBeCloseTo(oldX / 2);
  });

  it('provides front, side, and top views around the current target', () => {
    const { camera, controls, navigation: nav } = navigation();
    nav.focus(new Vector3(100, 200, 300));
    nav.view('side');
    expect(camera.position.x).toBeCloseTo(1100);
    expect(camera.position.y).toBeCloseTo(200);
    nav.view('top');
    expect(camera.position.y).toBeCloseTo(1200);
    expect(camera.getWorldDirection(new Vector3()).y).toBeCloseTo(-1);
    nav.view('front');
    expect(camera.position.z).toBeCloseTo(1300);
    expect(controls.target.toArray()).toEqual([100, 200, 300]);
  });

  it('moves camera and orbit target together with normalized, time-based fly motion', () => {
    const { camera, controls, navigation: nav } = navigation();
    nav.move(new Set(['KeyW']), 0.02);
    expect(camera.position.z).toBeLessThan(1000);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(1000);
    const straightDistance = 1000 - camera.position.z;
    const diagonal = navigation();
    diagonal.navigation.move(new Set(['KeyW', 'KeyD']), 0.02);
    expect(diagonal.controls.target.length()).toBeCloseTo(straightDistance);
    nav.move(new Set(['KeyE']), 0.02);
    expect(camera.position.y).toBeGreaterThan(0);
    nav.move(new Set(['KeyQ']), 0.02);
    expect(camera.position.y).toBeCloseTo(0);
  });

  it('restores the renderer camera when navigation is disposed', () => {
    const { camera, navigation: nav } = navigation();
    const original = PerspectiveCamera.prototype.updateProjectionMatrix;
    nav.setProjection('orthographic');
    nav.dispose();
    expect(camera.isPerspectiveCamera).toBe(true);
    expect(camera.updateProjectionMatrix).toBe(original);
    expect(camera.projectionMatrix.elements[15]).toBe(0);
  });
});
