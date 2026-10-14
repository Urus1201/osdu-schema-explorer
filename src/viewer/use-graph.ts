import { useEffect, useState } from 'react';
import { emptyGraph, type FocusMessage, type Graph, type PatchResult } from '../core/model.js';

const emptyFocus: FocusMessage = { nodeIds: [], edgeIds: [] };

export function useGraph() {
  const [graph, setGraph] = useState<Graph>(emptyGraph);
  const [focus, setFocus] = useState<FocusMessage>(emptyFocus);
  const [status, setStatus] = useState<'loading' | 'connected' | 'reconnecting' | 'error'>(
    'loading',
  );
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const events = new EventSource('/api/events');
    const acceptGraph = (value: Graph) => {
      setGraph((current) => (value.revision >= current.revision ? value : current));
      setStatus('connected');
      setError('');
    };
    void fetch('/api/graph', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load the local graph.');
        acceptGraph((await response.json()) as Graph);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus('error');
          setError('The local graph service could not be reached. Start the service and retry.');
        }
      });
    events.addEventListener('graph', (event: MessageEvent<string>) => {
      try {
        const update = JSON.parse(event.data) as PatchResult;
        acceptGraph(update.graph);
        if (update.addedNodeIds.length || update.addedEdgeIds.length) {
          setFocus((current) => ({
            ...current,
            addedNodeIds: update.addedNodeIds,
            addedEdgeIds: update.addedEdgeIds,
          }));
        }
      } catch {
        setError('A graph update could not be read. Retry to reload saved knowledge.');
      }
    });
    events.addEventListener('focus', (event: MessageEvent<string>) => {
      try {
        setFocus(JSON.parse(event.data) as FocusMessage);
      } catch {
        setError('A focus update could not be read. Saved knowledge is still available.');
      }
    });
    events.onopen = () => setStatus('connected');
    events.onerror = () => setStatus((current) => (current === 'error' ? current : 'reconnecting'));
    return () => {
      controller.abort();
      events.close();
    };
  }, [retry]);

  return {
    graph,
    focus,
    status,
    error,
    retry: () => setRetry((value) => value + 1),
    clearFocus: () => setFocus(emptyFocus),
  };
}
