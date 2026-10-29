import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ActivityLogRecord } from '../types';

export function ActivityLogsView() {
  const { apiFetch } = useAuth();
  const [logs, setLogs] = useState<ActivityLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [severityFilter, setSeverityFilter] = useState<
    'all' | 'info' | 'success' | 'warning' | 'error'
  >('all');
  const [actorFilter, setActorFilter] = useState<
    'all' | 'user' | 'agent' | 'self_healing' | 'system'
  >('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ logs: ActivityLogRecord[] }>('/api/logs');
      setLogs(res.logs);
    } catch (err: any) {
      setError(err?.message || 'Unable to load activity logs.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (severityFilter !== 'all' && log.severity !== severityFilter) return false;
      if (actorFilter !== 'all' && log.actorType !== actorFilter) return false;
      if (!q) return true;
      return (
        log.message.toLowerCase().includes(q) ||
        log.actorName.toLowerCase().includes(q) ||
        log.eventType.toLowerCase().includes(q)
      );
    });
  }, [logs, severityFilter, actorFilter, search]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search audit messages..."
              aria-label="Search audit logs"
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['all', 'All Severities'],
                ['info', 'Info'],
                ['success', 'Success'],
                ['warning', 'Warning'],
                ['error', 'Error'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSeverityFilter(key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  severityFilter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value as any)}
            aria-label="Filter by actor type"
            className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-700 focus:outline-none focus:border-blue-600"
          >
            <option value="all">All Actors</option>
            <option value="user">Human Reviewer / User</option>
            <option value="agent">AI Agents</option>
            <option value="self_healing">Self-Healing Engine</option>
            <option value="system">Workspace System</option>
          </select>
        </div>

        <button
          type="button"
          onClick={loadLogs}
          className="px-3.5 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 w-fit cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Logs</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-9 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            No audit or error log records match your current filter criteria.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 text-xs">
            {filteredLogs.map((log) => {
              const isExpanded = expandedId === log.id;
              return (
                <div key={log.id} className="p-4 hover:bg-slate-50/70 transition-colors space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      {log.severity === 'error' ? (
                        <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      ) : log.severity === 'warning' ? (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      ) : log.severity === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      )}

                      <div className="space-y-0.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-800">{log.actorName}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{log.eventType}</span>
                          <span aria-hidden="true">·</span>
                          <span>Severity: {log.severity}</span>
                        </div>
                        <p className="text-slate-800 leading-relaxed">{log.message}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                      {log.metadata && Object.keys(log.metadata).length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : log.id)}
                          className="text-[11px] font-medium text-blue-700 hover:underline cursor-pointer"
                        >
                          {isExpanded ? 'Hide Context' : 'Inspect Context'}
                        </button>
                      )}
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {isExpanded && log.metadata && (
                    <pre className="font-mono text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
