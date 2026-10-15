import { Box3, OrthographicCamera, PerspectiveCamera, Sphere, Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { endpointId, type RendererGraph } from './graph-adapter.js';
import type { Selection } from './graph-canvas.js';

export type SelectedObject = NonNullable<Selection>;
export type Projection = 'perspective' | 'orthographic';
export type ViewDirection = 'front' | 'side' | 'top';
type NavigationCommand =
  ViewDirection | 'frame' | 'fit' | 'reset' | 'projection' | 'cancel' | 'move';

export function selectionAfterClick(
  current: readonly SelectedObject[],
  next: Selection,
  additive: boolean,
): SelectedObject[] {
  if (!additive) return next ? [next] : [];
  if (!next || current.some((item) => item.type === next.type && item.id === next.id))
    return [...current];
  return [...current, next];
}

export function selectedNodeIds(data: RendererGraph, selection: readonly SelectedObject[]) {
  const visible = new Set(data.nodes.map((node) => node.id));
  const nodes = new Set(
    selection.filter((item) => item.type === 'node' && visible.has(item.id)).map((item) => item.id),
  );
  const edges = new Set(selection.filter((item) => item.type === 'edge').map((item) => item.id));
  for (const edge of data.links) {
    if (edges.has(edge.id)) {
      for (const id of [endpointId(edge.source), endpointId(edge.target)]) {
        if (visible.has(id)) nodes.add(id);
      }
    }
  }
  return nodes;
}

export function navigationCommand(event: {
  key: string;
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): NavigationCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const numpad: Record<string, NavigationCommand> = {
    Numpad1: 'front',
    Numpad3: 'side',
    Numpad7: 'top',
    Numpad5: 'projection',
  };
  if (numpad[event.code]) return numpad[event.code];
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(event.code)) return 'move';
  const commands: Record<string, NavigationCommand> = {
    f: 'frame',
    home: 'fit',
    r: 'reset',
    p: 'projection',
    '5': 'projection',
    escape: 'cancel',
  };
  return commands[event.key.toLowerCase()] ?? null;
}

/** Keeps camera identity stable: the force renderer exposes a getter, not a camera setter. */
export class CameraNavigation {
  projection: Projection = 'perspective';
  private halfHeight = 1;
  private readonly originalProjection: PerspectiveCamera['updateProjectionMatrix'];

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly controls: OrbitControls,
  ) {
    this.originalProjection = camera.updateProjectionMatrix;
    camera.updateProjectionMatrix = () => {
      if (this.projection === 'perspective') {
        this.originalProjection.call(camera);
      } else {
        Object.assign(camera, {
          left: -this.halfHeight * camera.aspect,
          right: this.halfHeight * camera.aspect,
          top: this.halfHeight,
          bottom: -this.halfHeight,
        });
        OrthographicCamera.prototype.updateProjectionMatrix.call(
          camera as unknown as OrthographicCamera,
        );
      }
    };
  }

  setProjection(projection: Projection) {
    if (projection === this.projection) return;
    const camera = this.camera;
    const offset = camera.position.clone().sub(this.controls.target);
    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
    if (projection === 'orthographic') {
      this.halfHeight = (Math.max(1, offset.length()) * tanHalfFov) / camera.zoom;
    } else {
      const distance = this.halfHeight / (camera.zoom * tanHalfFov);
      camera.position.copy(this.controls.target).add(offset.normalize().multiplyScalar(distance));
    }
    this.projection = projection;
    camera.zoom = 1;
    Object.assign(camera, {
      isPerspectiveCamera: projection === 'perspective',
      isOrthographicCamera: projection === 'orthographic',
    });
    camera.updateProjectionMatrix();
    this.controls.update();
  }

  fit(points: readonly Vector3[]) {
    const finite = points.filter((point) => point.toArray().every(Number.isFinite));
    if (!finite.length) return;
    const bounds = new Box3().setFromPoints(finite).expandByScalar(30);
    const sphere = bounds.getBoundingSphere(new Sphere());
    const camera = this.camera;
    const aspect = Math.max(0.01, camera.aspect);
    const vertical = Math.atan(Math.tan((camera.fov * Math.PI) / 360) / camera.zoom);
    const horizontal = Math.atan(Math.tan(vertical) * aspect);
    const direction = camera.position.clone().sub(this.controls.target).normalize();
    if (!direction.lengthSq()) direction.set(0, 0, 1);
    const right = camera.up.clone().cross(direction).normalize();
    const up = direction.clone().cross(right).normalize();
    let distance = 60;
    let halfHeight = 30;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new Vector3(x, y, z).sub(sphere.center);
          const horizontalExtent = Math.abs(corner.dot(right));
          const verticalExtent = Math.abs(corner.dot(up));
          const depth = corner.dot(direction);
          distance = Math.max(
            distance,
            depth + horizontalExtent / Math.tan(horizontal),
            depth + verticalExtent / Math.tan(vertical),
          );
          halfHeight = Math.max(halfHeight, verticalExtent, horizontalExtent / aspect);
        }
      }
    }
    distance *= 1.15;
    this.controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    if (this.projection === 'orthographic') {
      this.halfHeight = halfHeight * 1.15;
      camera.zoom = 1;
    }
    camera.far = Math.max(camera.far, distance + sphere.radius * 3);
    camera.updateProjectionMatrix();
    this.controls.update();
  }

  focus(point: Vector3) {
    this.camera.position.add(point.clone().sub(this.controls.target));
    this.controls.target.copy(point);
    this.controls.update();
  }

  view(direction: ViewDirection) {
    const distance = Math.max(1, this.camera.position.distanceTo(this.controls.target));
    const offset =
      direction === 'side'
        ? new Vector3(1, 0, 0)
        : direction === 'top'
          ? new Vector3(0, 1, 0.000001).normalize()
          : new Vector3(0, 0, 1);
    this.camera.position.copy(this.controls.target).addScaledVector(offset, distance);
    this.controls.update();
  }

  move(keys: ReadonlySet<string>, seconds: number) {
    const forward = this.camera.getWorldDirection(new Vector3());
    const up = this.camera.up.clone().normalize();
    const right = forward.clone().cross(up).normalize();
    const movement = new Vector3()
      .addScaledVector(forward, Number(keys.has('KeyW')) - Number(keys.has('KeyS')))
      .addScaledVector(right, Number(keys.has('KeyD')) - Number(keys.has('KeyA')))
      .addScaledVector(up, Number(keys.has('KeyE')) - Number(keys.has('KeyQ')));
    const speed = Math.max(30, this.camera.position.distanceTo(this.controls.target) * 0.65);
    movement.normalize().multiplyScalar(speed * Math.min(0.05, Math.max(0, seconds)));
    this.camera.position.add(movement);
    this.controls.target.add(movement);
    this.controls.update();
  }

  dispose() {
    this.camera.updateProjectionMatrix = this.originalProjection;
    Object.assign(this.camera, { isPerspectiveCamera: true, isOrthographicCamera: false });
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
  }
}
