import React, { useMemo } from 'react';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { Activity, Clock, User } from 'lucide-react';
import { ActivityEvent, LockEntry } from '../hooks/useGraphData';
import { getUserColor, getUserColorName } from '../utils/colors';

interface SidebarPanelProps {
    activities: ActivityEvent[];
    locks: Record<string, LockEntry>;
}

export default function SidebarPanel({ activities, locks }: SidebarPanelProps) {

    // Derive active developers from locks and recent activity
    const activeDevelopers = useMemo(() => {
        const devs = new Map<string, { name: string; lockCount: number; lastActive: number }>();

        // From valid locks
        Object.values(locks).forEach(lock => {
            if (!devs.has(lock.user_id)) {
                devs.set(lock.user_id, { name: lock.user_name, lockCount: 0, lastActive: lock.timestamp });
            }
            const dev = devs.get(lock.user_id)!;
            dev.lockCount++;
            dev.lastActive = Math.max(dev.lastActive, lock.timestamp);
        });

        // From recent activity (if not in locks)
        activities.forEach(act => {
            // We don't have user_id in activity easily unless we parse it or change backend, 
            // but let's assume userName is unique enough for display or we used user_id in checking
            // For now, let's just use the locks for the "Connected Developers" list to be accurate to "Active Agents"
        });

        return Array.from(devs.entries()).map(([id, data]) => ({ id, ...data }));
    }, [locks, activities]);

    return (
        <div className="h-full flex flex-col bg-white border-l border-slate-200 shadow-xl z-20">

            {/* Top Section: Connected Developers */}
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <User className="w-3 h-3" />
                    Active Agents ({activeDevelopers.length})
                </h3>

                <div className="grid grid-cols-2 gap-2">
                    {activeDevelopers.map(dev => {
                        const colors = getUserColor(dev.id);
                        return (
                            <div key={dev.id} className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200 shadow-sm relative overflow-hidden group">
                                <div className="absolute left-0 top-0 bottom-0 w-1 transition-colors" style={{ backgroundColor: Object.values(colors)[8] }} />
                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold shrink-0 text-slate-600">
                                    {dev.name.charAt(0)}
                                </div>
                                <div className="overflow-hidden">
                                    <div className="text-xs font-bold text-slate-700 truncate">{dev.name}</div>
                                    <div className="text-[10px] text-slate-400 flex items-center gap-1">
                                        <span className={dev.lockCount > 0 ? 'text-amber-600 font-semibold' : ''}>{dev.lockCount} Locks</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {activeDevelopers.length === 0 && (
                        <div className="col-span-2 text-xs text-slate-400 italic text-center py-4">
                            No active agents connected.
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Section: Activity Feed */}
            <div className="flex-1 overflow-hidden flex flex-col relative">
                <div className="p-3 bg-white border-b border-slate-100 flex items-center justify-between z-10">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <Activity className="w-3 h-3" />
                        Live Feed
                    </h3>
                    <span className="text-[10px] text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">Real-time</span>
                </div>

                <ScrollArea.Root className="flex-1 w-full h-full overflow-hidden bg-slate-50/30">
                    <ScrollArea.Viewport className="w-full h-full p-4 space-y-4">
                        {activities.map((activity) => {
                            // Try to generate a color from the user name or ID (simulated since activity doesn't have ID yet in this version, or update backend)
                            // We'll hash the userName for now
                            const userColor = getUserColor(activity.userName);
                            const timeAgo = relativeTime(activity.timestamp);

                            return (
                                <div key={activity.id} className="relative pl-4 group">
                                    <div
                                        className="absolute left-0 top-2 bottom-0 w-0.5 rounded-full transition-colors group-hover:w-1"
                                        style={{ backgroundColor: Object.values(userColor)[8] }}
                                    />

                                    <div className="flex items-baseline justify-between mb-0.5">
                                        <span
                                            className="text-xs font-bold truncate max-w-[120px]"
                                            style={{ color: Object.values(userColor)[10] }}
                                        >
                                            {activity.userName}
                                        </span>
                                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                            <Clock className="w-2.5 h-2.5" />
                                            {timeAgo}
                                        </span>
                                    </div>

                                    <div className="text-xs text-slate-600 leading-snug">
                                        <span className="font-medium">
                                            {activity.type === 'lock_acquired' ? 'Available' :
                                                activity.type === 'lock_released' ? 'Finished' : 'Updated'}
                                        </span>
                                        <span className="mx-1 text-slate-400">&bull;</span>
                                        <code className="bg-slate-100 text-slate-600 px-1 py-0.5 rounded border border-slate-200 text-[10px]">{activity.filePath}</code>
                                    </div>

                                    {activity.message && (
                                        <div className="mt-1.5 text-xs text-slate-500 bg-white p-2 rounded border border-slate-100 shadow-sm italic relative">
                                            "{activity.message}"
                                            <div className="absolute -top-1 left-3 w-2 h-2 bg-white border-t border-l border-slate-100 rotate-45" />
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {activities.length === 0 && (
                            <div className="text-center py-10 text-slate-400 text-xs">
                                No recent activity recorded.
                            </div>
                        )}
                    </ScrollArea.Viewport>
                    <ScrollArea.Scrollbar orientation="vertical" className="flex select-none touch-none p-0.5 bg-slate-100 transition-colors duration-[160ms] ease-out hover:bg-slate-200 data-[orientation=vertical]:w-2.5 data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:h-2.5">
                        <ScrollArea.Thumb className="flex-1 bg-slate-300 rounded-[10px] relative before:content-[''] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:w-full before:h-full before:min-w-[44px] before:min-h-[44px]" />
                    </ScrollArea.Scrollbar>
                </ScrollArea.Root>
            </div>
        </div>
    );
}

function relativeTime(timestamp: number): string {
    const delta = Date.now() - timestamp;
    if (delta < 1000 * 60) return `${Math.floor(delta / 1000)}s`;
    if (delta < 1000 * 60 * 60) return `${Math.floor(delta / (1000 * 60))}m`;
    return `${Math.floor(delta / (1000 * 60 * 60))}h`;
}
