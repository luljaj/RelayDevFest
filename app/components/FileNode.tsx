import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { motion, AnimatePresence } from 'framer-motion';
import { FileCode, FileJson, FileType, Lock } from 'lucide-react';
import { getUserColor } from '../utils/colors';

interface FileNodeProps {
    data: {
        label: string;
        fileName: string;
        lockStatus?: 'READING' | 'WRITING';
        lockedBy?: string;
        lockedByName?: string;
        intentMessage?: string;
        isUpdated?: boolean;
        language?: string;
    };
}

const FileNode = ({ data }: FileNodeProps) => {
    const { fileName, lockStatus, lockedBy, lockedByName, intentMessage, isUpdated, language } = data;

    const isLocked = !!lockStatus;
    const isWriting = lockStatus === 'WRITING';
    const userColor = lockedBy ? getUserColor(lockedBy) : null;

    // Determine border color
    const borderColor = isLocked && userColor
        ? isWriting
            ? Object.values(userColor)[8] // Step 9 (Solid) for Writing
            : Object.values(userColor)[8]
        : isUpdated
            ? '#cbd5e1' // Slate-300
            : '#94a3b8'; // Slate-400

    const borderStyle = isLocked ? 'solid' : 'dashed';
    const borderWidth = isLocked ? 3 : 1;

    // Background color
    const backgroundColor = isUpdated && userColor
        ? Object.values(userColor)[2] // Step 3 (Light tint)
        : 'white';

    const Icon = getIconForFile(fileName);

    return (
        <div className="relative group">
            {/* Intent Bubble */}
            <AnimatePresence>
                {intentMessage && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 5, scale: 0.95 }}
                        className="absolute -top-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
                    >
                        <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-xl whitespace-nowrap max-w-[200px] truncate relative">
                            {intentMessage}
                            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 rotate-45" />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Node Body */}
            <div
                className="rounded-xl transition-all duration-300 overflow-hidden min-w-[180px]"
                style={{
                    borderColor,
                    borderStyle,
                    borderWidth,
                    backgroundColor,
                    boxShadow: isLocked ? `0 4px 12px ${userColor ? Object.values(userColor)[3] : 'rgba(0,0,0,0.1)'}` : 'none'
                }}
            >
                <div className="px-3 py-2 flex items-center gap-2">
                    <Icon className="w-4 h-4 text-slate-500 shrink-0" />
                    <div className="flex-1 overflow-hidden">
                        <div className="font-mono text-xs font-semibold text-slate-700 truncate" title={fileName}>
                            {fileName}
                        </div>
                        {lockedByName && (
                            <div className="text-[10px] uppercase font-bold tracking-wider truncate" style={{ color: userColor ? Object.values(userColor)[10] : '#64748b' }}>
                                {lockedByName}
                            </div>
                        )}
                    </div>
                    {isLocked && <Lock className="w-3 h-3 text-slate-400" />}
                </div>
            </div>

            <Handle type="target" position={Position.Top} className="!bg-slate-300 !w-2 !h-1 !rounded-sm opacity-0 group-hover:opacity-100 transition-opacity" />
            <Handle type="source" position={Position.Bottom} className="!bg-slate-300 !w-2 !h-1 !rounded-sm opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
    );
};

function getIconForFile(fileName: string) {
    if (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) return FileCode;
    if (fileName.endsWith('.json')) return FileJson;
    return FileType;
}

export default memo(FileNode);
