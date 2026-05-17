import { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge as rfAddEdge,
  useReactFlow,
  Connection,
  NodeChange,
  EdgeChange,
  Edge,
  Node
} from 'reactflow';
import 'reactflow/dist/style.css';
import { ClientNode } from './nodes/ClientNode';
import { ApiNode } from './nodes/ApiNode';
import { RedisNode } from './nodes/RedisNode';
import { PostgresNode } from './nodes/PostgresNode';
import { LbNode } from './nodes/LbNode';
import { PostgresReplicaNode } from './nodes/PostgresReplicaNode';
import { QueueNode } from './nodes/QueueNode';
import { WorkerNode } from './nodes/WorkerNode';
import { CdnNode } from './nodes/CdnNode';
import { RegionBackdrops } from './canvas/RegionBackdrops';
import { AnimatedEdge } from './edges/AnimatedEdge';
import { Sidebar } from './controls/Sidebar';
import { TimeScrubber } from './controls/TimeScrubber';
import { Dashboard } from './dashboard/Dashboard';
import { FailureToasts } from './dashboard/FailureToasts';
import { PostMortem } from './mission/PostMortem';
import { Inspector } from './inspector/Inspector';
import { TutorialOverlay } from './controls/TutorialOverlay';
import { LearnPanels } from './controls/LearnPanels';
import { PlayBar } from './controls/PlayBar';
import { StartScreen } from './start/StartScreen';
import { useStore } from './store/useStore';
import { NodeType, Snapshot } from './sim/types';
import { isLegalEdge } from './sim/specs';

function Canvas() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const setNodes = useStore((s) => s.setNodes);
  const setEdges = useStore((s) => s.setEdges);
  const addNode = useStore((s) => s.addNode);
  const removeNodes = useStore((s) => s.removeNodes);
  const removeEdges = useStore((s) => s.removeEdges);
  const setSelection = useStore((s) => s.setSelection);
  const clearSelection = useStore((s) => s.clearSelection);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodeTypes = useMemo(
    () => ({
      client: ClientNode,
      api: ApiNode,
      redis: RedisNode,
      postgres: PostgresNode,
      postgresReplica: PostgresReplicaNode,
      lb: LbNode,
      queue: QueueNode,
      worker: WorkerNode,
      cdn: CdnNode
    }),
    []
  );

  const edgeTypes = useMemo(() => ({ animated: AnimatedEdge }), []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const removed = changes
        .filter((c) => c.type === 'remove')
        .map((c) => (c as { id: string }).id);
      if (removed.length > 0) {
        removeNodes(removed);
        return;
      }
      setNodes(applyNodeChanges(changes, useStore.getState().nodes));
    },
    [setNodes, removeNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes
        .filter((c) => c.type === 'remove')
        .map((c) => (c as { id: string }).id);
      if (removed.length > 0) {
        removeEdges(removed);
        return;
      }
      setEdges(applyEdgeChanges(changes, useStore.getState().edges));
    },
    [setEdges, removeEdges]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges(
        rfAddEdge({ ...conn, type: 'animated' }, useStore.getState().edges) as Edge[]
      );
    },
    [setEdges]
  );

  const isValidConnection = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return false;
    const all = useStore.getState().nodes;
    const s = all.find((n) => n.id === conn.source);
    const t = all.find((n) => n.id === conn.target);
    if (!s || !t) return false;
    return isLegalEdge(s.data.type, t.data.type);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(
        'application/scalecraft-node'
      ) as NodeType;
      if (!type) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(type, position);
    },
    [addNode, screenToFlowPosition]
  );

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      setSelection({ kind: 'node', id: node.id });
    },
    [setSelection]
  );

  const onEdgeClick = useCallback(
    (_e: React.MouseEvent, edge: Edge) => {
      setSelection({
        kind: 'edge',
        id: edge.id,
        source: edge.source,
        target: edge.target
      });
    },
    [setSelection]
  );

  const onPaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  return (
    <div className="sc-canvas" ref={wrapperRef} onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        isValidConnection={isValidConnection}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <RegionBackdrops />
      </ReactFlow>
    </div>
  );
}

export default function App() {
  const setSnapshot = useStore((s) => s.setSnapshot);
  const rps = useStore((s) => s.rps);
  const readPct = useStore((s) => s.readPct);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const paused = useStore((s) => s.paused);
  const incidents = useStore((s) => s.incidents);
  const tables = useStore((s) => s.tables);
  const endpoints = useStore((s) => s.endpoints);
  const selection = useStore((s) => s.selection);
  const clearSelection = useStore((s) => s.clearSelection);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), {
      type: 'module'
    });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<Snapshot>) => {
      setSnapshot(e.data);
      useStore.getState().tickMission(e.data);
    };
    worker.postMessage({
      type: 'init',
      state: {
        graph: useStore.getState().toSimGraph(),
        rps: useStore.getState().rps,
        readPct: useStore.getState().readPct,
        incidents: useStore.getState().incidents,
        tables: useStore.getState().tables,
        endpoints: useStore.getState().endpoints
      }
    });
    return () => {
      worker.postMessage({ type: 'stop' });
      worker.terminate();
      workerRef.current = null;
    };
  }, [setSnapshot]);

  useEffect(() => {
    workerRef.current?.postMessage({
      type: 'updateState',
      state: {
        graph: useStore.getState().toSimGraph(),
        rps,
        readPct,
        incidents,
        tables,
        endpoints
      }
    });
  }, [rps, readPct, nodes, edges, incidents, tables, endpoints]);

  useEffect(() => {
    workerRef.current?.postMessage({ type: paused ? 'pause' : 'resume' });
  }, [paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  return (
    <div className={`sc-app${selection ? ' sc-app--inspecting' : ''}`}>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
      <Inspector />
      <Sidebar />
      <TimeScrubber />
      <Dashboard />
      <FailureToasts />
      <PostMortem />
      <TutorialOverlay />
      <LearnPanels />
      <PlayBar />
      <StartScreen />
    </div>
  );
}
