import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FileCode, GitCommit, Lock, Users, X } from 'lucide-react';
import { GraphNode, LockEntry } from '../hooks/useGraphData';
import { getUserColor } from '../utils/colors';

interface NodeDetailsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    node: GraphNode | null;
    lock: LockEntry | undefined;
    dependencies: string[];
    dependents: string[];
}

export default function NodeDetailsDialog({
    isOpen,
    onClose,
    node,
    lock,
    dependencies,
    dependents,
}: NodeDetailsDialogProps) {
    if (!node) return null;

    const userColor = lock ? getUserColor(lock.user_id) : null;
    const statusColor = lock
        ? (lock.status === 'WRITING' ? 'text-red-600 bg-red-50 border-red-200' : 'text-amber-600 bg-amber-50 border-amber-200')
        : 'text-emerald-600 bg-emerald-50 border-emerald-200';

    return (
        <Dialog.Root open={isOpen} onOpenChange={onClose}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 animate-fade-in" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl w-full max-w-md z-50 p-0 overflow-hidden outline-none animate-scale-in border border-slate-100">

                    {/* Header */}
                    <div className="bg-slate-50 p-6 border-b border-slate-100 flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-white rounded-xl shadow-sm border border-slate-200">
                                <FileCode className="w-6 h-6 text-indigo-500" />
                            </div>
                            <div>
                                <Dialog.Title className="text-lg font-bold text-slate-800 break-all leading-tight">
                                    {node.id}
                                </Dialog.Title>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${statusColor}`}>
                                        {lock ? lock.status : 'AVAILABLE'}
                                    </span>
                                    <span className="text-xs text-slate-400 font-mono">
                                        {node.language || 'text'} • {node.size ? `${(node.size / 1024).toFixed(1)} KB` : '0 KB'}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="p-6 space-y-6">

                        {/* Lock Info */}
                        {lock && (
                            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: userColor ? Object.values(userColor)[9] : '#cbd5e1' }} />
                                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                    <Users className="w-4 h-4" />
                                    <span>Locked by {lock.user_name}</span>
                                </div>
                                <p className="text-sm text-slate-600 italic">"{lock.message}"</p>
                                <div className="text-xs text-slate-400 flex items-center gap-1 mt-2">
                                    <Lock className="w-3 h-3" />
                                    Expires in {Math.round((lock.expiry - Date.now()) / 1000)}s
                                </div>
                            </div>
                        )}

                        {/* Dependencies */}
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Imports ({dependencies.length})</h4>
                                <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                                    {dependencies.length === 0 && <li className="text-xs text-slate-400 italic">None</li>}
                                    {dependencies.map(dep => (
                                        <li key={dep} className="text-xs text-slate-600 flex items-center gap-2 bg-slate-50 px-2 py-1.5 rounded border border-slate-100 truncate" title={dep}>
                                            <GitCommit className="w-3 h-3 text-slate-300" />
                                            {dep}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div>
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Imported By ({dependents.length})</h4>
                                <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                                    {dependents.length === 0 && <li className="text-xs text-slate-400 italic">None</li>}
                                    {dependents.map(dep => (
                                        <li key={dep} className="text-xs text-slate-600 flex items-center gap-2 bg-slate-50 px-2 py-1.5 rounded border border-slate-100 truncate" title={dep}>
                                            <GitCommit className="w-3 h-3 text-slate-300" />
                                            {dep}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                    </div>

                    {/* Footer */}
                    <div className="bg-slate-50 p-4 border-t border-slate-100 text-center">
                        <button className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline">
                            View File History on GitHub
                        </button>
                    </div>

                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
