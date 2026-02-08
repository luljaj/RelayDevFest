import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';

interface FileNodeProps {
    data: {
        fileName: string;
        path?: string;
        lockStatus?: 'READING' | 'WRITING';
        isUpdated?: boolean;
        isDark?: boolean;
    };
}

const FileNode = ({ data }: FileNodeProps) => {
    const { fileName, lockStatus, isUpdated, path, isDark } = data;

    const isTaken = !!lockStatus;
    const resolvedPath = path ?? fileName;
    const displayName = getDisplayFileName(resolvedPath);
    const folderPath = getFolderPath(resolvedPath);
    const folderLabel = folderPath || '(repo root)';

    const borderColor = isTaken ? '#000000' : isDark ? '#71717a' : '#a1a1aa';
    const borderWidth = isTaken ? 6 : 1.5;

    return (
        <div className="relative group">
            <div
                className={`relative min-w-[210px] overflow-hidden rounded-2xl px-4 py-3 transition-all duration-200 ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}
                style={{
                    borderColor,
                    borderStyle: 'solid',
                    borderWidth,
                    backgroundColor: isDark ? '#18181b' : '#fafafa',
                    boxShadow: isUpdated
                        ? (isDark ? '0 0 0 1px rgba(161,161,170,0.55)' : '0 0 0 1px rgba(113,113,122,0.35)')
                        : 'none',
                }}
            >
                {isUpdated && (
                    <div
                        className={`pointer-events-none absolute inset-0 rounded-2xl border ${isDark ? 'border-zinc-500/60' : 'border-zinc-400/55'}`}
                    />
                )}

                <div className="truncate font-mono text-[12px] font-semibold" title={resolvedPath}>
                    {displayName}
                </div>
                <div
                    className={`mt-1 truncate text-[10px] ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}
                    title={folderLabel}
                >
                    Folder: {folderLabel}
                </div>
            </div>

            <Handle type="target" position={Position.Top} className={`!w-2 !h-1 !rounded-sm opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? '!bg-zinc-600' : '!bg-zinc-300'}`} />
            <Handle type="source" position={Position.Bottom} className={`!w-2 !h-1 !rounded-sm opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? '!bg-zinc-600' : '!bg-zinc-300'}`} />
        </div>
    );
};

function getDisplayFileName(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) {
        return path;
    }
    return path.slice(lastSlash + 1);
}

function getFolderPath(path: string): string {
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) {
        return '';
    }
    return path.slice(0, lastSlash);
}

export default memo(FileNode);
