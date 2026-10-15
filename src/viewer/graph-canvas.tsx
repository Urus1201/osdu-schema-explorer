import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FocusMessage } from '../core/model.js';
import type { ViewGraph } from './graph-overview.js';
import { createRendererGraph, type RendererGraph } from './graph-adapter.js';

const Graph3D = lazy(() => import('./graph-3d.js'));
const Graph2D = lazy(() => import('./graph-2d.js'));

export type Selection = { type: 'node' | 'edge'; id: string } | null;
export interface SceneProps {
  data: RendererGraph;
  width: number;
  height: number;
  labels: boolean;
  focus: FocusMessage;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

class CanvasBoundary extends Component<
  { children: ReactNode; onList: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="canvas-message" role="alert">
          <h2>Graph rendering is unavailable.</h2>
          <p>Your saved facts are available in the accessible list.</p>
          <button onClick={this.props.onList}>Open list view</button>
        </div>
      );
    return this.props.children;
  }
}

export function GraphCanvas({
  graph,
  mode,
  onList,
  ...scene
}: Omit<SceneProps, 'data' | 'width' | 'height'> & {
  graph: ViewGraph;
  mode: '3d' | '2d';
  onList: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const [contextLost, setContextLost] = useState(false);
  const [rendered, setRendered] = useState(() => ({
    source: graph,
    data: createRendererGraph(graph),
  }));
  if (rendered.source !== graph) {
    setRendered({ source: graph, data: createRendererGraph(graph, rendered.data) });
  }
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
    });
    observer.observe(container.current);
    const element = container.current;
    const lost = () => setContextLost(true);
    element.addEventListener('webglcontextlost', lost, true);
    return () => {
      observer.disconnect();
      element.removeEventListener('webglcontextlost', lost, true);
    };
  }, []);
  return (
    <div
      className="graph-canvas"
      ref={container}
      role="region"
      aria-label={`${mode === '3d' ? '3D' : '2D'} graph of ${graph.nodes.length} visible nodes and ${graph.edges.length} relationships. Use List view for keyboard and screen reader inspection.`}
    >
      {contextLost && mode === '3d' ? (
        <div className="canvas-message" role="alert">
          <h2>3D rendering is unavailable.</h2>
          <p>Your saved facts are available in the accessible list.</p>
          <button onClick={onList}>Open list view</button>
        </div>
      ) : (
        <CanvasBoundary key={mode} onList={onList}>
          <Suspense
            fallback={
              <div className="canvas-message" role="status">
                Loading graph renderer…
              </div>
            }
          >
            {mode === '3d' ? (
              <Graph3D {...scene} {...size} data={rendered.data} />
            ) : (
              <Graph2D {...scene} {...size} data={rendered.data} />
            )}
          </Suspense>
        </CanvasBoundary>
      )}
      <p className="canvas-hint">
        {mode === '3d'
          ? 'Left-drag to orbit · Right-drag to pan · Scroll to zoom · Controls for shortcuts'
          : size.width < 600
            ? 'Drag to pan · Zoom to explore · Tap nodes for field details'
            : 'Drag to pan · Scroll to zoom · Hover for properties · Click to inspect'}
      </p>
    </div>
  );
}
