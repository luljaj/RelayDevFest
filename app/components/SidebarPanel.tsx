import React, { UIEvent, useEffect, useMemo, useRef, useState } from 'react';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { Activity, Clock, User } from 'lucide-react';
import { ActivityEvent, LockEntry } from '../hooks/useGraphData';

interface SidebarPanelProps {
    activities: ActivityEvent[];
    locks: Record<string, LockEntry>;
    isDark: boolean;
}

const ACTIVE_AGENT_TTL_MS = 20 * 60 * 1000;
const DEFAULT_AGENT_COUNT_SCALE = 1;
const MIN_AGENT_COUNT_SCALE = 0.7;
const MAX_AGENT_COUNT_SCALE = 1.8;
const AGENT_COUNT_SCALE_STEP = 0.1;
const AGENT_COUNT_SCALE_STORAGE_KEY = 'devfest_agent_count_scale';

export default function SidebarPanel({ activities, locks, isDark }: SidebarPanelProps) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const stickToTopRef = useRef(true);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [agentCountScale, setAgentCountScale] = useState(DEFAULT_AGENT_COUNT_SCALE);

    const activeDevelopers = useMemo(() => {
        const developers = new Map<string, { name: string; lockCount: number; lastActive: number }>();
        const activityCutoff = nowMs - ACTIVE_AGENT_TTL_MS;

        for (const lock of Object.values(locks)) {
            if (lock.timestamp < activityCutoff) {
                continue;
            }
            if (!developers.has(lock.user_id)) {
                developers.set(lock.user_id, {
                    name: lock.user_name,
                    lockCount: 0,
                    lastActive: lock.timestamp,
                });
            }

            const current = developers.get(lock.user_id)!;
            current.lockCount += 1;
            current.lastActive = Math.max(current.lastActive, lock.timestamp);
        }

        for (const event of activities.slice(0, 60)) {
            if (event.timestamp < activityCutoff) {
                continue;
            }
            const key = event.userId || event.userName;
            if (!developers.has(key)) {
                developers.set(key, { name: event.userName, lockCount: 0, lastActive: event.timestamp });
                continue;
            }
            const current = developers.get(key)!;
            current.lastActive = Math.max(current.lastActive, event.timestamp);
        }

        return Array.from(developers.entries())
            .map(([id, data]) => ({ id, ...data }))
            .sort((a, b) => b.lockCount - a.lockCount || b.lastActive - a.lastActive);
    }, [locks, activities, nowMs]);

    useEffect(() => {
        const interval = setInterval(() => {
            setNowMs(Date.now());
        }, 60_000);

        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const raw = window.localStorage.getItem(AGENT_COUNT_SCALE_STORAGE_KEY);
        if (!raw) {
            return;
        }

        const parsed = Number.parseFloat(raw);
        if (!Number.isFinite(parsed)) {
            return;
        }

        setAgentCountScale(clampAgentCountScale(parsed));
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        window.localStorage.setItem(AGENT_COUNT_SCALE_STORAGE_KEY, String(agentCountScale));
    }, [agentCountScale]);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport || !stickToTopRef.current) {
            return;
        }

        viewport.scrollTop = 0;
    }, [activities]);

    const onViewportScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        stickToTopRef.current = target.scrollTop < 28;
    };

    const countBadgeStyle = useMemo(
        () => ({
            fontSize: `${Math.round(10 * agentCountScale)}px`,
            lineHeight: '1',
            padding: `${Math.max(1, Math.round(2 * agentCountScale))}px ${Math.max(5, Math.round(8 * agentCountScale))}px`,
            minWidth: `${Math.max(18, Math.round(22 * agentCountScale))}px`,
        }),
        [agentCountScale],
    );

    return (
        <div className={`z-20 flex h-full flex-col rounded-l-[24px] border-l backdrop-blur-md ${isDark ? 'border-zinc-700 bg-zinc-900/85' : 'border-zinc-200 bg-white/80'}`}>
            <section className={`shrink-0 border-b p-4 ${isDark ? 'border-zinc-700/80 bg-zinc-900/65' : 'border-zinc-200/80 bg-zinc-50/70'}`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        <User className="h-3 w-3" />
                        Active Agents ({activeDevelopers.length})
                    </h3>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setAgentCountScale((previous) => clampAgentCountScale(previous - AGENT_COUNT_SCALE_STEP))}
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'}`}
                            title="Decrease agent count size"
                            aria-label="Decrease agent count size"
                        >
                            A-
                        </button>
                        <button
                            type="button"
                            onClick={() => setAgentCountScale((previous) => clampAgentCountScale(previous + AGENT_COUNT_SCALE_STEP))}
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'}`}
                            title="Increase agent count size"
                            aria-label="Increase agent count size"
                        >
                            A+
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-2">
                    {activeDevelopers.map(dev => {
                        const railColor = neutralTone(dev.id);
                        return (
                            <article key={dev.id} className={`relative flex items-center gap-3 overflow-hidden rounded-xl border px-3 py-2 shadow-sm ${isDark ? 'border-zinc-700 bg-zinc-800/80' : 'border-zinc-200 bg-white'}`}>
                                <div className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: railColor }} />
                                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${isDark ? 'border-zinc-700 bg-zinc-700 text-zinc-100' : 'border-zinc-200 bg-zinc-100 text-zinc-700'}`}>
                                    {dev.name.charAt(0)}
                                </div>
                                <div className="min-w-0 flex-1 overflow-hidden">
                                    <div className={`truncate text-xs font-semibold ${isDark ? 'text-zinc-100' : 'text-zinc-800'}`}>{dev.name}</div>
                                    <div className={`text-[10px] ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                        Last active {relativeTime(dev.lastActive)}
                                    </div>
                                </div>
                                <span
                                    className={`rounded-full border font-semibold text-center ${isDark ? 'border-zinc-700 bg-zinc-700/80 text-zinc-200' : 'border-zinc-200 bg-zinc-100 text-zinc-700'}`}
                                    style={countBadgeStyle}
                                >
                                    {dev.lockCount}
                                </span>
                            </article>
                        );
                    })}

                    {activeDevelopers.length === 0 && (
                        <div className={`py-4 text-center text-xs italic ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                            No active agents connected.
                        </div>
                    )}
                </div>
            </section>

            <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className={`z-10 flex items-center justify-between border-b p-3 backdrop-blur-md ${isDark ? 'border-zinc-700 bg-zinc-900/70' : 'border-zinc-100 bg-white/80'}`}>
                    <h3 className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        <Activity className="h-3 w-3" />
                        Live Feed
                    </h3>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${isDark ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}`}>
                        <span className="relative inline-flex h-2 w-2">
                            <span className={`absolute inline-flex h-full w-full rounded-full opacity-70 ${isDark ? 'bg-emerald-300/70' : 'bg-emerald-500/60'}`} />
                            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${isDark ? 'bg-emerald-300/45' : 'bg-emerald-500/35'}`} />
                            <span className={`relative inline-flex h-2 w-2 rounded-full ${isDark ? 'bg-emerald-300' : 'bg-emerald-500'}`} />
                        </span>
                        Real-time
                    </span>
                </div>

                <ScrollArea.Root className={`h-full w-full flex-1 overflow-hidden ${isDark ? 'bg-zinc-900/50' : 'bg-zinc-50/40'}`}>
                    <ScrollArea.Viewport ref={viewportRef} className="h-full w-full p-4" onScroll={onViewportScroll}>
                        {activities.map((activity) => {
                            const railColor = neutralTone(activity.userId || activity.userName);
                            const description = actionDescription(activity);
                            const statusTone = getStatusTone(activity.status, isDark);
                            const statusLabel = activity.status;

                            return (
                                <article key={activity.id} className={`mb-3 flex gap-3 rounded-xl border px-3 py-2 shadow-sm ${isDark ? 'border-zinc-700 bg-zinc-800/85' : 'border-zinc-200 bg-white/90'}`}>
                                    <div className="w-1 shrink-0 rounded-full" style={{ backgroundColor: railColor }} />
                                    <div className="min-w-0 flex-1">
                                        <div className="mb-1 flex items-center justify-between gap-2">
                                            <div className="min-w-0 flex items-center gap-2">
                                                <span className={`truncate text-xs font-semibold ${isDark ? 'text-zinc-100' : 'text-zinc-800'}`}>
                                                    {activity.userName}
                                                </span>
                                                <span
                                                    className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold"
                                                    style={statusTone}
                                                >
                                                    {statusLabel}
                                                </span>
                                            </div>
                                            <span className={`flex shrink-0 items-center gap-1 text-[10px] ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                                <Clock className="h-3 w-3" />
                                                {relativeTime(activity.timestamp)}
                                            </span>
                                        </div>

                                        <p className={`text-xs leading-snug ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`}>
                                            {description}{' '}
                                            <code className={`rounded border px-1 py-0.5 text-[10px] ${isDark ? 'border-zinc-600 bg-zinc-700 text-zinc-200' : 'border-zinc-200 bg-zinc-100 text-zinc-700'}`}>
                                                {activity.filePath}
                                            </code>
                                        </p>

                                        {activity.message && (
                                            <div className={`mt-1.5 rounded-md border px-2 py-1 text-[11px] italic ${isDark ? 'border-zinc-700 bg-zinc-900 text-zinc-400' : 'border-zinc-100 bg-zinc-50 text-zinc-500'}`}>
                                                "{activity.message}"
                                            </div>
                                        )}
                                    </div>
                                </article>
                            );
                        })}

                        {activities.length === 0 && (
                            <div className={`py-10 text-center text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                No recent activity recorded.
                            </div>
                        )}
                    </ScrollArea.Viewport>

                    <ScrollArea.Scrollbar orientation="vertical" className={`flex w-2.5 select-none touch-none p-0.5 transition-colors duration-150 ${isDark ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-zinc-100 hover:bg-zinc-200'}`}>
                        <ScrollArea.Thumb className={`relative flex-1 rounded-[10px] before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:min-w-[44px] before:w-full before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] ${isDark ? 'bg-zinc-600' : 'bg-zinc-300'}`} />
                    </ScrollArea.Scrollbar>
                </ScrollArea.Root>
            </section>
        </div>
    );
}

function relativeTime(timestamp: number): string {
    const delta = Date.now() - timestamp;
    if (delta < 1000 * 30) return 'now';
    if (delta < 1000 * 60 * 60) return `${Math.max(1, Math.floor(delta / (1000 * 60)))}m`;
    if (delta < 1000 * 60 * 60 * 24) return `${Math.floor(delta / (1000 * 60 * 60))}h`;
    return `${Math.floor(delta / (1000 * 60 * 60 * 24))}d`;
}

function actionDescription(activity: ActivityEvent): string {
    switch (activity.type) {
        case 'status_writing':
            return 'set status to writing on';
        case 'status_reading':
            return 'set status to reading on';
        case 'status_open':
            return 'set status to open on';
        case 'lock_acquired':
            return 'started working on';
        case 'lock_released':
            return 'finished';
        case 'message_updated':
            return 'updated intent for';
        case 'lock_reassigned':
            return 'reassigned work on';
        default:
            return 'touched';
    }
}

function neutralTone(seed: string): string {
    const tones = ['#3f3f46', '#52525b', '#71717a', '#a1a1aa'];
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
        hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }
    return tones[hash % tones.length];
}

function getStatusTone(
    status: ActivityEvent['status'],
    isDark: boolean,
): { borderColor: string; backgroundColor: string; color: string } {
    if (status === 'WRITING') {
        return isDark
            ? { borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.2)', color: '#fecaca' }
            : { borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.16)', color: '#b91c1c' };
    }

    if (status === 'READING') {
        return isDark
            ? { borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.2)', color: '#bae6fd' }
            : { borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.16)', color: '#0369a1' };
    }

    return isDark
        ? { borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.2)', color: '#bbf7d0' }
        : { borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.16)', color: '#047857' };
}

function clampAgentCountScale(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_AGENT_COUNT_SCALE;
    }

    return Math.min(MAX_AGENT_COUNT_SCALE, Math.max(MIN_AGENT_COUNT_SCALE, Number(value.toFixed(2))));
}
