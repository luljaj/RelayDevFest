'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

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

const initialRepo = 'https://github.com/vercel/next.js';
const initialBranch = 'canary';

export default function HomePage() {
  const [repoUrl, setRepoUrl] = useState(initialRepo);
  const [branch, setBranch] = useState(initialBranch);
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lockCount = useMemo(() => Object.keys(graph?.locks ?? {}).length, [graph]);

  async function fetchGraph() {
    setLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams({ repo_url: repoUrl, branch });
      const response = await fetch(`/api/graph?${query.toString()}`);
      const data = (await response.json()) as DependencyGraph | { error: string };

      if (!response.ok) {
        const message = 'error' in data ? data.error : 'Failed to fetch graph';
        throw new Error(message);
      }

      setGraph(data as DependencyGraph);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchGraph();

    const timer = setInterval(() => {
      fetchGraph();
    }, 5000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl, branch]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    fetchGraph();
  }

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '2rem 1rem 3rem' }}>
      <section
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          padding: '1.25rem',
          boxShadow: '0 8px 30px rgba(2, 6, 23, 0.08)',
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.9rem' }}>Coordination Graph Monitor</h1>
        <p style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--muted)' }}>
          Polling every 5 seconds from <code>/api/graph</code>
        </p>

        <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: '1fr 180px 120px' }}>
          <input
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
            placeholder="https://github.com/user/repo"
            style={inputStyle}
          />
          <input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="main"
            style={inputStyle}
          />
          <button type="submit" style={buttonStyle}>
            Refresh
          </button>
        </form>

        {error && (
          <p style={{ color: 'var(--danger)', marginTop: '0.75rem', marginBottom: 0 }}>
            {error}
          </p>
        )}
      </section>

      <section
        style={{
          marginTop: '1rem',
          display: 'grid',
          gap: '0.75rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        }}
      >
        <MetricCard label="Files" value={graph?.nodes.length ?? 0} />
        <MetricCard label="Dependencies" value={graph?.edges.length ?? 0} />
        <MetricCard label="Active Locks" value={lockCount} />
        <MetricCard
          label="Last Generated"
          value={
            graph?.metadata.generated_at ? new Date(graph.metadata.generated_at).toLocaleTimeString() : 'Not yet'
          }
        />
      </section>

      <section
        style={{
          marginTop: '1rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          padding: '1rem',
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Files</h2>
        {loading && <p style={{ margin: 0 }}>Refreshing...</p>}
        {!loading && !graph && <p style={{ margin: 0 }}>No data yet.</p>}
        {graph && (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {graph.nodes.slice(0, 120).map((node) => {
              const lock = graph.locks[node.id];
              const lockColor = lock
                ? lock.status === 'WRITING'
                  ? 'var(--danger)'
                  : 'var(--warning)'
                : 'var(--ok)';

              return (
                <div
                  key={node.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    padding: '0.6rem 0.75rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{node.id}</div>
                    <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                      {node.language ?? 'unknown'} {typeof node.size === 'number' ? `• ${node.size} bytes` : ''}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      padding: '0.2rem 0.55rem',
                      borderRadius: 999,
                      color: '#fff',
                      background: lockColor,
                      whiteSpace: 'nowrap',
                    }}
                    title={lock?.message || 'No lock'}
                  >
                    {lock ? `${lock.status} · ${lock.user_name}` : 'AVAILABLE'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '0.75rem 0.9rem',
      }}
    >
      <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>{label}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{value}</div>
    </article>
  );
}

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '0.6rem 0.75rem',
  font: 'inherit',
};

const buttonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 10,
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};
