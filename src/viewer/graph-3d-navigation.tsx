import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type HTMLAttributes,
} from 'react';
import { MOUSE, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ForceGraphMethods } from 'react-force-graph-3d';
import type { RendererLink, RendererNode } from './graph-adapter.js';
import type { SceneProps, Selection } from './graph-canvas.js';
import {
  CameraNavigation,
  navigationCommand,
  selectedNodeIds,
  selectionAfterClick,
  type Projection,
} from './graph-navigation.js';

export function useGraph3DNavigation(
  renderer: RefObject<ForceGraphMethods<RendererNode, RendererLink> | undefined>,
  { data, selection, onSelect }: Pick<SceneProps, 'data' | 'selection' | 'onSelect'>,
) {
  const viewport = useRef<HTMLDivElement>(null);
  const controller = useRef<CameraNavigation | null>(null);
  const keys = useRef(new Set<string>());
  const animation = useRef<number | null>(null);
  const activePointer = useRef<number | null>(null);
  const cancelledPointer = useRef<number | null>(null);
  const cancelledClicks = useRef(new WeakSet<Event>());
  const [projection, setProjection] = useState<Projection>('perspective');
  const [help, setHelp] = useState(false);
  const helpId = useId();
  const [chosen, setChosen] = useState({
    primary: selection,
    items: selectionAfterClick([], selection, false),
  });
  // Inspector and list selections replace the viewport's selection as well.
  if (chosen.primary !== selection) {
    setChosen({ primary: selection, items: selectionAfterClick([], selection, false) });
  }
  const selected = useMemo(() => {
    const visibleNodes = new Set(data.nodes.map((node) => node.id));
    const visibleEdges = new Set(data.links.map((edge) => edge.id));
    return chosen.items.filter((item) =>
      (item.type === 'node' ? visibleNodes : visibleEdges).has(item.id),
    );
  }, [chosen.items, data]);

  const stop = useCallback(() => {
    keys.current.clear();
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  }, []);

  useEffect(() => {
    const graph = renderer.current;
    if (!graph) return;
    const controls = graph.controls() as OrbitControls;
    controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };
    controls.zoomToCursor = true;
    controls.screenSpacePanning = true;
    const navigation = new CameraNavigation(graph.camera() as PerspectiveCamera, controls);
    controller.current = navigation;
    const visibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stop();
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', visibility);
      navigation.dispose();
      controller.current = null;
    };
  }, [renderer, stop]);

  const fit = useCallback(
    (ids?: ReadonlySet<string>) => {
      controller.current?.fit(
        data.nodes
          .filter((node) => !ids || ids.has(node.id))
          .filter((node) => [node.x, node.y, node.z].every(Number.isFinite))
          .map((node) => new Vector3(node.x, node.y, node.z)),
      );
    },
    [data],
  );

  const select = (next: Selection, event?: MouseEvent) => {
    if (event && cancelledClicks.current.has(event)) return;
    const additive = !!(event?.shiftKey || event?.ctrlKey || event?.metaKey);
    if (!next && additive) return;
    setChosen({ primary: next, items: selectionAfterClick(selected, next, additive) });
    onSelect(next);
  };

  const act = (command: Exclude<ReturnType<typeof navigationCommand>, null | 'move'>) => {
    stop();
    const navigation = controller.current;
    if (!navigation) return;
    if (command === 'frame') {
      const ids = selectedNodeIds(data, selected);
      fit(ids.size ? ids : undefined);
    } else if (command === 'fit') fit();
    else if (command === 'reset') {
      navigation.setProjection('perspective');
      setProjection('perspective');
      navigation.view('front');
      fit();
    } else if (command === 'projection') {
      const next = navigation.projection === 'perspective' ? 'orthographic' : 'perspective';
      navigation.setProjection(next);
      setProjection(next);
    } else if (command === 'cancel') {
      if (activePointer.current !== null) {
        cancelledPointer.current = activePointer.current;
        renderer.current?.renderer().domElement.dispatchEvent(
          new PointerEvent('pointercancel', {
            pointerId: activePointer.current,
            bubbles: true,
          }),
        );
        activePointer.current = null;
      }
      select(null);
      setHelp(false);
    } else navigation.view(command);
  };

  const viewportProps: HTMLAttributes<HTMLDivElement> = {
    tabIndex: 0,
    role: 'group',
    'aria-label': '3D navigation viewport',
    'aria-describedby': help ? helpId : undefined,
    onPointerDownCapture: (event) => {
      if (event.target instanceof HTMLCanvasElement) {
        viewport.current?.focus({ preventScroll: true });
        activePointer.current = event.pointerId;
        cancelledPointer.current = null;
      }
    },
    onPointerUpCapture: (event) => {
      if (event.pointerId === cancelledPointer.current) {
        cancelledClicks.current.add(event.nativeEvent);
        cancelledPointer.current = null;
      }
      activePointer.current = null;
    },
    onBlur: stop,
    onKeyDown: (event) => {
      const command = navigationCommand(event);
      if (!command) return;
      if (event.target !== event.currentTarget && command !== 'cancel') return;
      event.preventDefault();
      if (command !== 'move') {
        if (!event.repeat) act(command);
        if (command === 'cancel') viewport.current?.focus({ preventScroll: true });
        return;
      }
      // A cancelled/blurred gesture must wait for a fresh key press before moving again.
      if (event.repeat && !keys.current.has(event.code)) return;
      keys.current.add(event.code);
      if (animation.current !== null) return;
      let previous = performance.now();
      const step = (now: number) => {
        controller.current?.move(keys.current, (now - previous) / 1000);
        previous = now;
        animation.current = keys.current.size ? requestAnimationFrame(step) : null;
      };
      animation.current = requestAnimationFrame(step);
    },
    onKeyUp: (event) => {
      keys.current.delete(event.code);
      if (!keys.current.size) stop();
    },
    onDoubleClick: (event) => {
      if (!(event.target instanceof HTMLCanvasElement)) return;
      const graph = renderer.current;
      if (!graph || !controller.current) return;
      const rect = event.target.getBoundingClientRect();
      const raycaster = new Raycaster();
      raycaster.setFromCamera(
        new Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        graph.camera(),
      );
      const hit = raycaster.intersectObjects(graph.scene().children, true).find(({ object }) => {
        for (let parent: typeof object | null = object; parent; parent = parent.parent) {
          if (!parent.visible) return false;
        }
        return true;
      });
      const controls = graph.controls() as OrbitControls;
      const point =
        hit?.point ??
        raycaster.ray.intersectPlane(
          new Plane().setFromNormalAndCoplanarPoint(
            graph.camera().getWorldDirection(new Vector3()),
            controls.target,
          ),
          new Vector3(),
        );
      if (point) controller.current.focus(point);
    },
  };

  const button = (label: string, title: string, command: Parameters<typeof act>[0]) => (
    <button
      title={title}
      onClick={() => {
        act(command);
        viewport.current?.focus();
      }}
    >
      {label}
    </button>
  );
  const toolbar = (
    <>
      {help ? (
        <div
          className="navigation-help"
          id={helpId}
          role="note"
          aria-label="3D navigation shortcuts"
        >
          <strong>3D navigation</strong>
          <p>Click the view or Tab to it to use keyboard shortcuts.</p>
          <dl>
            <dt>Scroll</dt>
            <dd>Zoom toward the cursor</dd>
            <dt>Left-drag</dt>
            <dd>Orbit around the target</dd>
            <dt>Right / middle-drag</dt>
            <dd>Pan (also Shift / Ctrl + left-drag)</dd>
            <dt>Click</dt>
            <dd>Inspect an object; Shift / Ctrl + click adds to selection</dd>
            <dt>Double-click</dt>
            <dd>Center on an object or point</dd>
            <dt>F / Home</dt>
            <dd>Frame selection (or all) / fit all visible objects</dd>
            <dt>R</dt>
            <dd>Reset to the front perspective view and fit all</dd>
            <dt>W A S D</dt>
            <dd>Fly forward, left, backward, right</dd>
            <dt>Q / E</dt>
            <dd>Move down / up</dd>
            <dt>Numpad 1 / 3 / 7</dt>
            <dd>Front / side / top</dd>
            <dt>5 / P</dt>
            <dd>Toggle perspective and orthographic</dd>
            <dt>Esc</dt>
            <dd>Stop navigation, close help, and deselect</dd>
          </dl>
        </div>
      ) : null}
      <div className="navigation-3d" role="group" aria-label="3D view controls">
        {button('Fit', 'Frame selection or all (F); fit all (Home)', 'frame')}
        {button('Front', 'Front view (Numpad 1)', 'front')}
        {button('Side', 'Side view (Numpad 3)', 'side')}
        {button('Top', 'Top view (Numpad 7)', 'top')}
        {button('Reset', 'Reset view (R)', 'reset')}
        <button
          title="Toggle perspective / orthographic (5 or P)"
          aria-pressed={projection === 'orthographic'}
          onClick={() => {
            act('projection');
            viewport.current?.focus();
          }}
        >
          {projection === 'orthographic' ? 'Orthographic' : 'Perspective'}
        </button>
        <button
          aria-expanded={help}
          aria-controls={helpId}
          onClick={() => setHelp((value) => !value)}
        >
          Controls
        </button>
        <output aria-live="polite">{selected.length} selected</output>
      </div>
    </>
  );
  return { viewport, viewportProps, toolbar, fit, selected, select };
}
