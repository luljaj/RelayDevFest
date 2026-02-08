import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
    Background,
    BackgroundVariant,
    Controls,
    Edge,
    MarkerType,
    MiniMap,
    Node,
    NodeMouseHandler,
    Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { DependencyGraph, LockEntry } from '../hooks/useGraphData';
import FileNode from './FileNode';
import DependencyEdge from './DependencyEdge';
import ControlDock from './ControlDock';
import NodeDetailsDialog from './NodeDetailsDialog';

const nodeTypes = {
    activeFile: FileNode,
};

const edgeTypes = {
    dependency: DependencyEdge,
};

interface GraphPanelProps {
    graph: DependencyGraph | null;
    repoUrl: string;
    setRepoUrl: (url: string) => void;
    branch: string;
    setBranch: (branch: string) => void;
    onRefresh: () => void;
    refreshing: boolean;
    loading: boolean;
    lastUpdatedAt: number | null;
    pollIntervalMs: number;
    isDark: boolean;
    onToggleTheme: () => void;
}

const NODE_UPDATE_HIGHLIGHT_MS = 4500;
const NEW_EDGE_HIGHLIGHT_MS = 2500;
const LAYOUT_X_STEP = 360;
const LAYOUT_Y_STEP = 210;
const LAYOUT_SPAWN_JITTER = 24;
const LAYOUT_TICK_MS = 42;
const LAYOUT_EDGE_LENGTH = 230;
const LAYOUT_EDGE_SPRING = 0.008;
const LAYOUT_REPULSION = 30_000;
const LAYOUT_REPULSION_MIN_DISTANCE = 38;
const LAYOUT_CENTER_GRAVITY = 0.0014;
const LAYOUT_SAME_FOLDER_TARGET = 180;
const LAYOUT_SAME_FOLDER_PULL = 0.0024;
const LAYOUT_DAMPING = 0.84;
const LAYOUT_MAX_SPEED = 12;

type Point = { x: number; y: number };

export default function GraphPanel({
    graph,
    repoUrl,
    setRepoUrl,
    branch,
    setBranch,
    onRefresh,
    refreshing,
    loading,
    lastUpdatedAt,
    pollIntervalMs,
    isDark,
    onToggleTheme,
}: GraphPanelProps) {
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [updatedNodeExpiry, setUpdatedNodeExpiry] = useState<Record<string, number>>({});
    const [newEdgeExpiry, setNewEdgeExpiry] = useState<Record<string, number>>({});
    const [nodePositions, setNodePositions] = useState<Record<string, Point>>({});
    const previousLocksRef = useRef<Record<string, LockEntry>>({});
    const previousEdgesRef = useRef<Set<string>>(new Set());
    const velocitiesRef = useRef<Record<string, Point>>({});
    const structureSignature = useMemo(() => {
        if (!graph) {
            return '';
        }

        const nodeIds = graph.nodes.map((node) => node.id).sort().join('|');
        const edgeIds = graph.edges.map((edge) => toEdgeId(edge.source, edge.target)).sort().join('|');
        return `${nodeIds}::${edgeIds}`;
    }, [graph]);

    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setUpdatedNodeExpiry((previous) => pruneExpired(previous, now));
            setNewEdgeExpiry((previous) => pruneExpired(previous, now));
        }, 700);

        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!graph) {
            setNodePositions({});
            velocitiesRef.current = {};
            return;
        }

        setNodePositions((previous) => {
            const columns = Math.max(2, Math.ceil(Math.sqrt(graph.nodes.length)));
            const next: Record<string, Point> = {};

            for (const [index, node] of graph.nodes.entries()) {
                const existing = previous[node.id];
                if (existing) {
                    next[node.id] = existing;
                    continue;
                }

                const gridPosition = getGridPosition(index, columns);
                const jitter = getInitialJitter(node.id);
                next[node.id] = {
                    x: gridPosition.x + jitter.x,
                    y: gridPosition.y + jitter.y,
                };
            }

            return next;
        });

        const nextVelocities: Record<string, Point> = {};
        for (const node of graph.nodes) {
            nextVelocities[node.id] = velocitiesRef.current[node.id] ?? { x: 0, y: 0 };
        }
        velocitiesRef.current = nextVelocities;
    }, [graph, structureSignature]);

    useEffect(() => {
        if (!graph || graph.nodes.length === 0) {
            return;
        }

        const nodeIds = graph.nodes.map((node) => node.id);
        const edges = graph.edges.map((edge) => ({ source: edge.source, target: edge.target }));
        const folderByNodeId = Object.fromEntries(
            graph.nodes.map((node) => [node.id, getFolderPath(node.id)]),
        );

        const interval = setInterval(() => {
            setNodePositions((previous) => {
                if (Object.keys(previous).length === 0) {
                    return previous;
                }

                const nextPositions: Record<string, Point> = {};
                const forces: Record<string, Point> = {};
                const nextVelocities: Record<string, Point> = { ...velocitiesRef.current };

                for (const [index, nodeId] of nodeIds.entries()) {
                    const fallback = getGridPosition(index, Math.max(2, Math.ceil(Math.sqrt(nodeIds.length))));
                    nextPositions[nodeId] = previous[nodeId] ?? fallback;
                    forces[nodeId] = { x: 0, y: 0 };
                }

                for (let i = 0; i < nodeIds.length; i += 1) {
                    const sourceId = nodeIds[i];
                    for (let j = i + 1; j < nodeIds.length; j += 1) {
                        const targetId = nodeIds[j];
                        const source = nextPositions[sourceId];
                        const target = nextPositions[targetId];
                        const deltaX = target.x - source.x;
                        const deltaY = target.y - source.y;
                        const distance = Math.max(
                            Math.hypot(deltaX, deltaY),
                            LAYOUT_REPULSION_MIN_DISTANCE,
                        );
                        const directionX = deltaX / distance;
                        const directionY = deltaY / distance;
                        const magnitude = LAYOUT_REPULSION / (distance * distance);

                        forces[sourceId].x -= directionX * magnitude;
                        forces[sourceId].y -= directionY * magnitude;
                        forces[targetId].x += directionX * magnitude;
                        forces[targetId].y += directionY * magnitude;

                        if (folderByNodeId[sourceId] === folderByNodeId[targetId]) {
                            const separation = distance - LAYOUT_SAME_FOLDER_TARGET;
                            if (separation > 0) {
                                const folderPull = separation * LAYOUT_SAME_FOLDER_PULL;
                                forces[sourceId].x += directionX * folderPull;
                                forces[sourceId].y += directionY * folderPull;
                                forces[targetId].x -= directionX * folderPull;
                                forces[targetId].y -= directionY * folderPull;
                            }
                        }
                    }
                }

                for (const edge of edges) {
                    const source = nextPositions[edge.source];
                    const target = nextPositions[edge.target];
                    if (!source || !target) {
                        continue;
                    }

                    const deltaX = target.x - source.x;
                    const deltaY = target.y - source.y;
                    const distance = Math.max(Math.hypot(deltaX, deltaY), 1);
                    const directionX = deltaX / distance;
                    const directionY = deltaY / distance;
                    const spring = (distance - LAYOUT_EDGE_LENGTH) * LAYOUT_EDGE_SPRING;

                    forces[edge.source].x += directionX * spring;
                    forces[edge.source].y += directionY * spring;
                    forces[edge.target].x -= directionX * spring;
                    forces[edge.target].y -= directionY * spring;
                }

                let centroidX = 0;
                let centroidY = 0;
                for (const nodeId of nodeIds) {
                    centroidX += nextPositions[nodeId].x;
                    centroidY += nextPositions[nodeId].y;
                }
                centroidX /= nodeIds.length;
                centroidY /= nodeIds.length;

                for (const nodeId of nodeIds) {
                    const position = nextPositions[nodeId];
                    forces[nodeId].x += (centroidX - position.x) * LAYOUT_CENTER_GRAVITY;
                    forces[nodeId].y += (centroidY - position.y) * LAYOUT_CENTER_GRAVITY;
                }

                for (const nodeId of nodeIds) {
                    const velocity = nextVelocities[nodeId] ?? { x: 0, y: 0 };
                    velocity.x = (velocity.x + forces[nodeId].x) * LAYOUT_DAMPING;
                    velocity.y = (velocity.y + forces[nodeId].y) * LAYOUT_DAMPING;

                    const speed = Math.hypot(velocity.x, velocity.y);
                    if (speed > LAYOUT_MAX_SPEED) {
                        const scale = LAYOUT_MAX_SPEED / speed;
                        velocity.x *= scale;
                        velocity.y *= scale;
                    }

                    nextVelocities[nodeId] = velocity;
                    nextPositions[nodeId] = {
                        x: nextPositions[nodeId].x + velocity.x,
                        y: nextPositions[nodeId].y + velocity.y,
                    };
                }

                velocitiesRef.current = nextVelocities;
                return nextPositions;
            });
        }, LAYOUT_TICK_MS);

        return () => clearInterval(interval);
    }, [graph, structureSignature]);

    useEffect(() => {
        if (!graph) {
            previousLocksRef.current = {};
            previousEdgesRef.current = new Set();
            return;
        }

        const now = Date.now();
        const previousLocks = previousLocksRef.current;
        const releasedLocks = Object.keys(previousLocks).filter((path) => !graph.locks[path]);

        if (releasedLocks.length > 0) {
            setUpdatedNodeExpiry((previous) => {
                const next = { ...previous };
                for (const filePath of releasedLocks) {
                    next[filePath] = now + NODE_UPDATE_HIGHLIGHT_MS;
                }
                return next;
            });
        }

        const currentEdgeIds = new Set(graph.edges.map((edge) => toEdgeId(edge.source, edge.target)));
        if (previousEdgesRef.current.size > 0) {
            const newEdges: string[] = [];
            for (const edgeId of currentEdgeIds) {
                if (!previousEdgesRef.current.has(edgeId)) {
                    newEdges.push(edgeId);
                }
            }

            if (newEdges.length > 0) {
                setNewEdgeExpiry((previous) => {
                    const next = { ...previous };
                    for (const edgeId of newEdges) {
                        next[edgeId] = now + NEW_EDGE_HIGHLIGHT_MS;
                    }
                    return next;
                });
            }
        }

        previousLocksRef.current = graph.locks;
        previousEdgesRef.current = currentEdgeIds;
    }, [graph]);

    const activeDevelopers = useMemo(() => {
        if (!graph) {
            return [];
        }

        const grouped = new Map<string, { name: string; lockCount: number }>();
        for (const lock of Object.values(graph.locks)) {
            const existing = grouped.get(lock.user_id);
            if (existing) {
                existing.lockCount += 1;
                continue;
            }
            grouped.set(lock.user_id, { name: lock.user_name, lockCount: 1 });
        }

        return Array.from(grouped.entries())
            .map(([id, value]) => ({
                id,
                name: value.name,
                lockCount: value.lockCount,
                color: neutralTone(id),
            }))
            .sort((a, b) => b.lockCount - a.lockCount || a.name.localeCompare(b.name));
    }, [graph]);

    const nodes = useMemo(() => {
        if (!graph) return [];

        const columns = Math.max(2, Math.ceil(Math.sqrt(graph.nodes.length)));
        const now = Date.now();

        return graph.nodes.map((node, index) => {
            const lock = graph.locks[node.id];
            const isUpdated = (updatedNodeExpiry[node.id] ?? 0) > now;
            const fallback = getGridPosition(index, columns);
            const position = nodePositions[node.id] ?? fallback;

            return {
                id: node.id,
                type: 'activeFile',
                position,
                data: {
                    path: node.id,
                    fileName: node.id,
                    lockStatus: lock?.status,
                    isUpdated,
                    isDark,
                },
            };
        });
    }, [graph, nodePositions, updatedNodeExpiry, isDark]);

    const edges = useMemo(() => {
        if (!graph) return [];
        const now = Date.now();

        return graph.edges.map((edge) => {
            const edgeId = toEdgeId(edge.source, edge.target);
            const isNew = (newEdgeExpiry[edgeId] ?? 0) > now;
            const sourceLock = graph.locks[edge.source];
            const targetLock = graph.locks[edge.target];
            const isLockedEdge = !!sourceLock || !!targetLock;
            const baseStroke = isDark ? '#52525b' : '#a1a1aa';
            const activeStroke = isDark ? '#d4d4d8' : '#27272a';
            const stroke = isNew || isLockedEdge ? activeStroke : baseStroke;

            return {
                id: edgeId,
                source: edge.source,
                target: edge.target,
                type: 'dependency',
                animated: isNew || isLockedEdge,
                markerEnd: {
                    type: MarkerType.ArrowClosed,
                    color: stroke,
                    width: 14,
                    height: 14,
                },
                style: {
                    stroke,
                    strokeWidth: isNew ? 2 : 1.1,
                    opacity: isNew ? 1 : 0.7,
                },
                data: {
                    isNew,
                },
            };
        });
    }, [graph, newEdgeExpiry, isDark]);

    const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
        setSelectedNodeId(node.id);
    }, []);

    const selectedNodeData = useMemo(() => {
        if (!graph || !selectedNodeId) return null;
        return {
            node: graph.nodes.find((n) => n.id === selectedNodeId) || null,
            lock: graph.locks[selectedNodeId],
            dependencies: graph.edges.filter((e) => e.source === selectedNodeId).map((e) => e.target),
            dependents: graph.edges.filter((e) => e.target === selectedNodeId).map((e) => e.source),
        };
    }, [graph, selectedNodeId]);

    const activeLocksCount = graph ? Object.keys(graph.locks).length : 0;

    return (
        <div className={`w-full h-full relative overflow-hidden border rounded-2xl ${isDark ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-zinc-100'}`}>
            <ControlDock
                repoUrl={repoUrl}
                setRepoUrl={setRepoUrl}
                branch={branch}
                setBranch={setBranch}
                onRefresh={onRefresh}
                refreshing={refreshing}
                loading={loading}
                lastUpdatedAt={lastUpdatedAt}
                activeLocks={activeLocksCount}
                pollIntervalMs={pollIntervalMs}
                isDark={isDark}
                onToggleTheme={onToggleTheme}
            />

            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={onNodeClick}
                nodesConnectable={false}
                nodesDraggable
                fitView
                minZoom={0.1}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
                className={isDark ? '!bg-zinc-900' : '!bg-zinc-100'}
            >
                <Background color={isDark ? '#3f3f46' : '#a1a1aa'} variant={BackgroundVariant.Dots} gap={24} size={1.2} />
                <Controls
                    position="bottom-right"
                    className={isDark
                        ? '!bg-zinc-900/85 !text-zinc-200 !shadow-lg !border !border-zinc-700 !rounded-xl'
                        : '!bg-white/65 !shadow-lg !border !border-zinc-200 !rounded-xl'}
                />
                <MiniMap
                    pannable
                    zoomable
                    className={isDark
                        ? '!bg-zinc-900/85 !shadow-lg !rounded-xl !border !border-zinc-700'
                        : '!bg-white/60 !shadow-lg !rounded-xl !border !border-zinc-200'}
                    nodeColor={(node) => {
                        const lockStatus = node.data.lockStatus;
                        if (!lockStatus) return isDark ? '#3f3f46' : '#d4d4d8';
                        return isDark ? '#f4f4f5' : '#18181b';
                    }}
                />

                <Panel
                    position="bottom-left"
                    className={`max-w-[280px] border px-4 py-3 shadow-xl rounded-xl ${isDark ? 'border-zinc-700 bg-black' : 'border-zinc-200 bg-white'}`}
                >
                    <h4 className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>Legend</h4>
                    <div className="mt-2 space-y-2">
                        {activeDevelopers.length === 0 && (
                            <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>No active locks. Nodes are currently available.</p>
                        )}
                        {activeDevelopers.slice(0, 6).map((developer) => (
                            <div key={developer.id} className="flex items-center justify-between gap-3 text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: developer.color }} />
                                    <span className={`truncate font-semibold ${isDark ? 'text-zinc-200' : 'text-zinc-700'}`}>{developer.name}</span>
                                </div>
                                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${isDark ? 'border-zinc-700 bg-zinc-800 text-zinc-300' : 'border-zinc-200 bg-zinc-100 text-zinc-600'}`}>
                                    {developer.lockCount} lock{developer.lockCount === 1 ? '' : 's'}
                                </span>
                            </div>
                        ))}
                    </div>
                </Panel>
            </ReactFlow>

            <NodeDetailsDialog
                isOpen={!!selectedNodeId}
                onClose={() => setSelectedNodeId(null)}
                node={selectedNodeData?.node || null}
                lock={selectedNodeData?.lock}
                dependencies={selectedNodeData?.dependencies || []}
                dependents={selectedNodeData?.dependents || []}
                repoUrl={normalizeRepoUrl(repoUrl)}
                branch={branch}
                isDark={isDark}
            />
        </div>
    );
}

function toEdgeId(source: string, target: string): string {
    return `${source}->${target}`;
}

function pruneExpired(values: Record<string, number>, now: number): Record<string, number> {
    const entries = Object.entries(values);
    let changed = false;
    const next: Record<string, number> = {};

    for (const [key, expiry] of entries) {
        if (expiry > now) {
            next[key] = expiry;
            continue;
        }
        changed = true;
    }

    return changed ? next : values;
}

function neutralTone(seed: string): string {
    const tones = ['#3f3f46', '#52525b', '#71717a', '#a1a1aa'];
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
        hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }
    return tones[hash % tones.length];
}

function getGridPosition(index: number, columns: number): Point {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return {
        x: col * LAYOUT_X_STEP,
        y: row * LAYOUT_Y_STEP,
    };
}

function getInitialJitter(seed: string): Point {
    const hash = hashSeed(seed);
    const angle = (hash % 360) * (Math.PI / 180);
    const radius = ((hash >>> 8) % 1000) / 1000 * LAYOUT_SPAWN_JITTER;
    return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
    };
}

function hashSeed(input: string): number {
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
    }
    return hash;
}

function getFolderPath(filePath: string): string {
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash === -1) {
        return '';
    }
    return filePath.slice(0, lastSlash);
}

function normalizeRepoUrl(input: string): string {
    const trimmed = input.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
    }
    if (trimmed.startsWith('github.com/')) {
        return `https://${trimmed}`;
    }
    return trimmed;
}
