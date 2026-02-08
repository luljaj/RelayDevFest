import React, { useCallback, useMemo, useState } from 'react';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    Node,
    Edge,
    NodeMouseHandler,
    BackgroundVariant,
    Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { DependencyGraph, GraphNode, LockEntry } from '../hooks/useGraphData';
import FileNode from './FileNode';
import DependencyEdge from './DependencyEdge';
import ControlDock from './ControlDock';
import NodeDetailsDialog from './NodeDetailsDialog';
import { getUserColor } from '../utils/colors';

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
}

export default function GraphPanel({
    graph,
    repoUrl,
    setRepoUrl,
    branch,
    setBranch,
    onRefresh,
    refreshing,
}: GraphPanelProps) {
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

    // Layout Logic (Simplified Grid for now, same as original)
    const { nodes, edges } = useMemo(() => {
        if (!graph) return { nodes: [], edges: [] };

        const columns = Math.max(2, Math.ceil(Math.sqrt(graph.nodes.length)));
        const xStep = 280;
        const yStep = 120; // Tighter vertical spacing

        const nodes: Node[] = graph.nodes.map((node, index) => {
            const row = Math.floor(index / columns);
            const col = index % columns;
            const lock = graph.locks[node.id];
            const lockedBy = lock?.user_id;

            return {
                id: node.id,
                type: 'activeFile',
                position: { x: col * xStep, y: row * yStep },
                data: {
                    label: node.id,
                    fileName: node.id,
                    lockStatus: lock?.status,
                    lockedBy,
                    lockedByName: lock?.user_name,
                    intentMessage: lock?.message, // "Bubble" content
                    isUpdated: false, // TODO: Implement diffing for "isUpdated"
                    language: node.language,
                },
            };
        });

        const edges: Edge[] = graph.edges.map((edge) => ({
            id: `${edge.source}->${edge.target}`,
            source: edge.source,
            target: edge.target,
            type: 'dependency',
            animated: !!graph.locks[edge.source] || !!graph.locks[edge.target],
            data: {
                isNew: false // TODO: Diff logic
            }
        }));

        return { nodes, edges };
    }, [graph]);

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

    return (
        <div className="w-full h-full relative bg-slate-50">
            <ControlDock
                repoUrl={repoUrl}
                setRepoUrl={setRepoUrl}
                branch={branch}
                setBranch={setBranch}
                onRefresh={onRefresh}
                refreshing={refreshing}
            />

            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={onNodeClick}
                fitView
                minZoom={0.1}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#cbd5e1" variant={BackgroundVariant.Dots} gap={24} size={2} />
                <Controls position="bottom-right" className="!bg-white !shadow-lg !border-none !rounded-lg" />
                <MiniMap
                    pannable
                    zoomable
                    className="!bg-white !shadow-lg !rounded-lg !border-none"
                    nodeColor={(node) => {
                        const lockStatus = node.data.lockStatus;
                        if (!lockStatus) return '#e2e8f0';
                        return lockStatus === 'WRITING' ? '#ef4444' : '#f59e0b';
                    }}
                />

                {/* Legend Panel */}
                <Panel position="bottom-left" className="bg-white/90 backdrop-blur p-3 rounded-lg shadow-lg border border-slate-100 flex flex-col gap-2">
                    <h4 className="text-xs font-bold text-slate-400 uppercase">Developers</h4>
                    <div className="flex flex-col gap-1">
                        {/* Dynamically list active devs? For now static example or empty state */}
                        <div className="text-xs text-slate-500 italic">Active developers will appear here</div>
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
            />
        </div>
    );
}
