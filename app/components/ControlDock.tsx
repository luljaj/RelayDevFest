import React from 'react';
import { GitBranch, Github, RefreshCw, Search } from 'lucide-react';

interface ControlDockProps {
    repoUrl: string;
    setRepoUrl: (url: string) => void;
    branch: string;
    setBranch: (branch: string) => void;
    onRefresh: () => void;
    refreshing: boolean;
}

export default function ControlDock({
    repoUrl,
    setRepoUrl,
    branch,
    setBranch,
    onRefresh,
    refreshing,
}: ControlDockProps) {
    return (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 p-2 bg-white/80 backdrop-blur-md border border-white/20 rounded-full shadow-lg hover:shadow-xl transition-all duration-300">

            <div className="flex items-center gap-2 px-3 py-1 bg-slate-100/50 rounded-full border border-slate-200/50">
                <Github className="w-4 h-4 text-slate-500" />
                <input
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    className="bg-transparent border-none outline-none text-sm text-slate-700 w-48 placeholder:text-slate-400"
                    placeholder="github.com/owner/repo"
                />
            </div>

            <div className="flex items-center gap-2 px-3 py-1 bg-slate-100/50 rounded-full border border-slate-200/50">
                <GitBranch className="w-4 h-4 text-slate-500" />
                <input
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="bg-transparent border-none outline-none text-sm text-slate-700 w-24 placeholder:text-slate-400"
                    placeholder="main"
                />
            </div>

            <div className="h-6 w-px bg-slate-200 mx-1" />

            <button
                onClick={onRefresh}
                className={`p-2 rounded-full hover:bg-slate-100 transition-colors ${refreshing ? 'animate-spin text-indigo-600' : 'text-slate-600'}`}
                title="Refresh Graph"
            >
                <RefreshCw className="w-4 h-4" />
            </button>

            <button
                className="p-2 rounded-full hover:bg-slate-100 text-slate-600 transition-colors"
                title="Global Search (Coming Soon)"
            >
                <Search className="w-4 h-4" />
            </button>

        </div>
    );
}
