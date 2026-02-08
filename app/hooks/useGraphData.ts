import { useCallback, useEffect, useRef, useState } from 'react';
import { Edge, Node } from 'reactflow';

export interface GraphNode {
    id: string;
    type: 'file';
    size?: number;
    language?: string;
}

export interface GraphEdge {
    source: string;
    target: string;
    type: 'import';
}

export interface LockEntry {
    user_id: string;
    user_name: string;
    status: 'READING' | 'WRITING';
    message: string;
    timestamp: number;
    expiry: number;
}

export interface DependencyGraph {
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

export type ActivityEvent = {
    id: string;
    type: 'lock_acquired' | 'lock_released' | 'lock_reassigned';
    filePath: string;
    userName: string;
    message: string;
    timestamp: number;
};

interface UseGraphDataReturn {
    graph: DependencyGraph | null;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    activities: ActivityEvent[];
    fetchGraph: (options?: { regenerate?: boolean }) => Promise<void>;
    setRepoUrl: (url: string) => void;
    setBranch: (branch: string) => void;
    repoUrl: string;
    branch: string;
}

const initialRepo = 'github.com/luljaj/relayfrontend';
const initialBranch = 'master';

export function useGraphData(): UseGraphDataReturn {
    const [repoUrl, setRepoUrl] = useState(initialRepo);
    const [branch, setBranch] = useState(initialBranch);
    const [graph, setGraph] = useState<DependencyGraph | null>(null);
    const [activities, setActivities] = useState<ActivityEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const hasLoadedRef = useRef(false);
    const previousLocksRef = useRef<Record<string, LockEntry>>({});

    const fetchGraph = useCallback(
        async (options?: { regenerate?: boolean }) => {
            if (!hasLoadedRef.current) {
                setLoading(true);
            } else {
                setRefreshing(true);
            }
            setError(null);

            try {
                const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
                const query = new URLSearchParams({
                    repo_url: normalizedRepoUrl,
                    branch: branch.trim() || 'master',
                    ...(options?.regenerate ? { regenerate: 'true' } : {}),
                });

                const response = await fetch(`/api/graph?${query.toString()}`);
                const data = (await response.json()) as DependencyGraph | { error: string };

                if (!response.ok) {
                    const message = 'error' in data ? data.error : 'Failed to fetch graph';
                    throw new Error(message);
                }

                const nextGraph = data as DependencyGraph;
                setGraph(nextGraph);
                captureActivity(previousLocksRef.current, nextGraph.locks, setActivities);
                previousLocksRef.current = nextGraph.locks;

                hasLoadedRef.current = true;
            } catch (requestError) {
                const message = requestError instanceof Error ? requestError.message : 'Unknown error';
                setError(message);
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [repoUrl, branch],
    );

    useEffect(() => {
        previousLocksRef.current = {};
        setActivities([]);
        hasLoadedRef.current = false;

        fetchGraph();
        const interval = setInterval(() => {
            fetchGraph();
        }, 3000); // Polling every 3s as per plan

        return () => clearInterval(interval);
    }, [fetchGraph]);

    return {
        graph,
        loading,
        refreshing,
        error,
        activities,
        fetchGraph,
        setRepoUrl,
        setBranch,
        repoUrl,
        branch,
    };
}

function normalizeRepoUrl(input: string): string {
    const value = input.trim();
    if (value.startsWith('http://') || value.startsWith('https://')) {
        return value;
    }
    if (value.startsWith('github.com/')) {
        return `https://${value}`;
    }
    return value;
}

function captureActivity(
    previousLocks: Record<string, LockEntry>,
    currentLocks: Record<string, LockEntry>,
    setActivities: React.Dispatch<React.SetStateAction<ActivityEvent[]>>,
): void {
    const events: ActivityEvent[] = [];

    for (const [filePath, lock] of Object.entries(currentLocks)) {
        const prev = previousLocks[filePath];

        if (!prev) {
            events.push({
                id: `acquire:${filePath}:${lock.timestamp}`,
                type: 'lock_acquired',
                filePath,
                userName: lock.user_name,
                message: lock.message,
                timestamp: lock.timestamp,
            });
            continue;
        }

        if (prev.user_id !== lock.user_id || prev.status !== lock.status || prev.message !== lock.message) {
            // Also track message updates or status changes
            if (prev.message !== lock.message) {
                // Treated as a reassignment or update
                events.push({
                    id: `update:${filePath}:${lock.timestamp}`,
                    type: 'lock_reassigned',
                    filePath,
                    userName: lock.user_name,
                    message: lock.message,
                    timestamp: lock.timestamp,
                });
            } else {
                events.push({
                    id: `reassign:${filePath}:${lock.timestamp}`,
                    type: 'lock_reassigned',
                    filePath,
                    userName: lock.user_name,
                    message: lock.message,
                    timestamp: lock.timestamp,
                });
            }
        }
    }

    for (const [filePath, lock] of Object.entries(previousLocks)) {
        if (!currentLocks[filePath]) {
            events.push({
                id: `release:${filePath}:${Date.now()}`,
                type: 'lock_released',
                filePath,
                userName: lock.user_name,
                message: lock.message,
                timestamp: Date.now(),
            });
        }
    }

    if (events.length === 0) {
        return;
    }

    setActivities((prev) => [...events, ...prev].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50));
}
