'use client';

import { FormEvent, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useGraphData, DependencyGraph, LockEntry, ActivityEvent } from './hooks/useGraphData';
import GraphPanel from './components/GraphPanel';
import SidebarPanel from './components/SidebarPanel';

// =========================================================================================
// NEW UI IMPLEMENTATION
// =========================================================================================

export default function HomePage() {
  const {
    graph,
    repoUrl,
    setRepoUrl,
    branch,
    setBranch,
    activities,
    fetchGraph,
    refreshing,
    loading,
    error,
  } = useGraphData();

  const locks = graph?.locks || {};

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-slate-50 font-sans text-slate-900">

      {/* Main Graph Area */}
      <section className="flex-1 relative h-full flex flex-col">
        {error && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-red-100 border border-red-300 text-red-800 px-4 py-2 rounded-lg z-50 text-sm shadow-lg font-medium">
            Error: {error}
          </div>
        )}

        {loading && !graph && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-50 backdrop-blur-sm">
            <div className="animate-pulse text-slate-400 font-semibold tracking-wide">Initializing Mission Control...</div>
          </div>
        )}

        <GraphPanel
          graph={graph}
          repoUrl={repoUrl}
          setRepoUrl={setRepoUrl}
          branch={branch}
          setBranch={setBranch}
          onRefresh={() => fetchGraph({ regenerate: true })}
          refreshing={refreshing}
        />
      </section>

      {/* Right Sidebar */}
      <aside className="w-[320px] h-full shrink-0 relative shadow-2xl z-40">
        <SidebarPanel activities={activities} locks={locks} />
      </aside>

    </main>
  );
}

// =========================================================================================
// OLD UI IMPLEMENTATION (PRESERVED)
// =========================================================================================

/*
interface GraphNode {
  id: string;
  type: 'file';
  size?: number;
  language?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  type: 'import';
}

interface LockEntry {
  user_id: string;
  user_name: string;
  status: 'READING' | 'WRITING';
  message: string;
  timestamp: number;
  expiry: number;
}

interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  locks: Record<string, LockEntry>;
  version: string;
  metadata: {
    generated_at: number;
    files_processed: number;
    edges_found: number;
  };
}

type StatusFilter = 'ALL' | 'AVAILABLE' | 'READING' | 'WRITING';

type ActivityEvent = {
  id: string;
  type: 'lock_acquired' | 'lock_released' | 'lock_reassigned';
  filePath: string;
  userName: string;
  message: string;
  timestamp: number;
};

type NodeData = {
  label: React.ReactNode;
};

const initialRepo = 'github.com/luljaj/relayfrontend';
const initialBranch = 'master';

// Renamed to avoid export conflict with new HomePage
function OldHomePage() {
  const [repoUrl, setRepoUrl] = useState(initialRepo);
  const [branch, setBranch] = useState(initialBranch);
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ... (Logic removed/commented since it's now in useGraphData, but keeping types above for reference)
  // To restore, one would copy back the logic from the original file or useGraphData
  
  return (
    <main className="dashboard-shell">
        <section className="panel controls-panel">
            <div>
            <h1 className="title">Relay Coordination Graph</h1>
            <p className="subtitle">
                Polling <code>/api/graph</code> every 5 seconds with lock overlays and dependency links.
            </p>
            </div>
            {/* ... Old JSX ... * /}
        </section>
        {/* ... Rest of Old JSX ... * /}
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="panel metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
    </article>
  );
}

function fileName(path: string): string {
    const index = path.lastIndexOf('/');
    return index >= 0 ? path.slice(index + 1) : path;
}
  
function getNodeColors(lock: LockEntry | undefined, selected: boolean): {
    background: string;
    border: string;
    text: string;
} {
    if (!lock) {
        return {
        background: selected ? '#d1fae5' : '#ecfdf5',
        border: selected ? '#047857' : '#10b981',
        text: '#064e3b',
        };
    }

    if (lock.status === 'WRITING') {
        return {
        background: selected ? '#fee2e2' : '#fef2f2',
        border: selected ? '#b91c1c' : '#ef4444',
        text: '#7f1d1d',
        };
    }

    return {
        background: selected ? '#fef3c7' : '#fffbeb',
        border: selected ? '#b45309' : '#f59e0b',
        text: '#78350f',
        };
}

function relativeTime(timestamp: number): string {
    const delta = Date.now() - timestamp;
    if (delta < 1000 * 30) return 'just now';
    if (delta < 1000 * 60) return `${Math.floor(delta / 1000)}s ago`;
    if (delta < 1000 * 60 * 60) return `${Math.floor(delta / (1000 * 60))}m ago`;
    return `${Math.floor(delta / (1000 * 60 * 60))}h ago`;
}
*/
