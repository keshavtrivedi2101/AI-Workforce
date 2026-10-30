import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  Table,
  Webhook,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { buildHttpsCollectionTemplate, downloadWindowsDesktopApp } from '../lib/https';
import { ToolInvocationRecord } from '../types';

interface ToolsRelayViewProps {
  onNavigate: (page: string) => void;
}

const CONNECTOR_CARDS: Array<{
  key: 'postgres_crm' | 'google_sheets_sync' | 'airtable_pipeline' | 'webhook_outbox';
  name: string;
  protocol: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: 'postgres_crm',
    name: 'PostgreSQL CRM · Function Calling',
    protocol: 'POST /internal/tools/crm/*',
    description:
      'Live relational CRM mutations invoked by Gemini Function Declarations (upsert_crm_lead & update_crm_lifecycle_and_notes).',
    icon: Database,
  },
  {
    key: 'google_sheets_sync',
    name: 'Google Sheets · RevOps Pipeline',
    protocol: 'POST /connectors/google-sheets/v4/...',
    description:
      'Simulated business spreadsheet relay appending scored B2B prospect rows and fit dispositions to Qualified_Pipeline.',
    icon: Table,
  },
  {
    key: 'airtable_pipeline',
    name: 'Airtable · Deal Cards Base',
    protocol: 'POST /connectors/airtable/v0/appRevOps/Deals',
    description:
      'Simulated deal-desk tracker synchronizing lifecycle stages, estimated budgets, and assigned AI workforce owners.',
    icon: Send,
  },
  {
    key: 'webhook_outbox',
    name: 'Supervisor Mailer & Webhook Outbox',
    protocol: 'POST /connectors/webhook/outbox/*',
    description:
      'Holds high-risk outreach payloads at the Supervisor Checkpoint and dispatches HMAC-signed events only after human sign-off.',
    icon: Webhook,
  },
];

export function ToolsRelayView({ onNavigate }: ToolsRelayViewProps) {
  const { apiFetch } = useAuth();
  const [invocations, setInvocations] = useState<ToolInvocationRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'completed' | 'held_for_approval' | 'dispatched_after_approval'
  >('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadInvocations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ invocations: ToolInvocationRecord[] }>('/api/tools/invocations');
      setInvocations(res.invocations);
    } catch (err: any) {
      setError(err?.message || 'Unable to load Connected Business Tools & Webhook Relay logs.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadInvocations();
  }, [loadInvocations]);

  const handleTestRelay = async (
    connectorKey: 'postgres_crm' | 'google_sheets_sync' | 'airtable_pipeline' | 'webhook_outbox'
  ) => {
    setTestingKey(connectorKey);
    setError(null);
    setBanner(null);
    try {
      const res = await apiFetch<{ invocation: ToolInvocationRecord }>('/api/tools/test-relay', {
        method: 'POST',
        body: JSON.stringify({ connectorKey }),
      });
      setBanner(
        `Connector "${connectorKey}" responded in ${res.invocation.durationMs}ms (${res.invocation.toolName}).`
      );
      await loadInvocations();
      if (res.invocation?.id) {
        setExpandedId(res.invocation.id);
      }
    } catch (err: any) {
      setError(err?.message || 'Connector relay test failed.');
    } finally {
      setTestingKey(null);
    }
  };

  const handleDownloadHttpFile = () => {
    const content = buildHttpsCollectionTemplate(window.location.origin);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'api.http';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setBanner('Downloaded api.http pre-configured with your workspace HTTPS URL.');
  };

  const handleDownloadWindowsExe = async () => {
    setError(null);
    try {
      await downloadWindowsDesktopApp();
      setBanner('Downloaded AI-Workforce.exe (64-bit Windows Desktop App).');
    } catch (err: any) {
      setError(err?.message || 'Unable to download AI-Workforce.exe.');
    }
  };

  const filtered = invocations.filter((inv) =>
    statusFilter === 'all' ? true : inv.status === statusFilter
  );

  return (
    <div className="space-y-8">
      {/* Connected Business Tools Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {CONNECTOR_CARDS.map((card) => {
          const Icon = card.icon;
          const callCount = invocations.filter(
            (i) =>
              i.connectorKey === card.key ||
              (card.key === 'webhook_outbox' && i.connectorKey === 'email_dispatcher')
          ).length;
          const isTesting = testingKey === card.key;

          return (
            <div
              key={card.key}
              className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 flex flex-col justify-between"
            >
              <div className="p-6 space-y-2.5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-base font-semibold text-slate-900">
                      {card.name}
                    </h2>
                    <p className="font-mono text-[11px] text-slate-500 mt-0.5">{card.protocol}</p>
                  </div>
                  <Icon className="w-5 h-5 text-slate-400 shrink-0" />
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{card.description}</p>
              </div>

              <div className="px-6 py-3.5 bg-slate-50/70 flex items-center justify-between gap-4 text-xs">
                <span className="font-mono text-slate-600 tabular-nums">
                  Recorded calls: {callCount}
                </span>
                <button
                  type="button"
                  disabled={testingKey !== null}
                  onClick={() => handleTestRelay(card.key)}
                  className="px-3.5 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3 h-3" />
                  <span>{isTesting ? 'Verifying...' : 'Test Relay'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      {banner && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-4">
          <span>{banner}</span>
          <button
            type="button"
            onClick={() => onNavigate('mission_planner')}
            className="font-medium underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Run Full Multi-Agent Directive
          </button>
        </div>
      )}

      {/* Webhook & Function-Call Outbox Inspector */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Persisted Tool Calling &amp; Webhook Outbox Ledger
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Inspect every database tool invocation, connected spreadsheet sync, and human-gated
              webhook payload
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['all', `All (${invocations.length})`],
                  [
                    'completed',
                    `Completed (${invocations.filter((i) => i.status === 'completed').length})`,
                  ],
                  [
                    'held_for_approval',
                    `Held at Gate (${
                      invocations.filter((i) => i.status === 'held_for_approval').length
                    })`,
                  ],
                  [
                    'dispatched_after_approval',
                    `Signed Off (${
                      invocations.filter((i) => i.status === 'dispatched_after_approval').length
                    })`,
                  ],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleDownloadWindowsExe}
              className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download AI-Workforce.exe</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadHttpFile}
              className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download api.http</span>
            </button>

            <button
              type="button"
              onClick={loadInvocations}
              aria-label="Refresh tool ledger"
              className="p-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {loading && invocations.length === 0 ? (
          <div className="p-8 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <h4 className="font-display text-sm font-semibold text-slate-900">
              No tool calls match this filter yet
            </h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Execute a natural-language business directive in Mission Planner or click "Test Relay"
              on any connector card above to populate the ledger.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filtered.map((inv) => {
              const isExpanded = expandedId === inv.id;
              return (
                <div key={inv.id} className="text-xs">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                    className="w-full text-left px-5 py-3.5 hover:bg-slate-50/70 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                      {inv.status === 'held_for_approval' ? (
                        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
                      )}
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-semibold text-slate-900">
                            {inv.toolName}
                          </span>
                          <span className="text-slate-400" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-slate-600">{inv.agentName}</span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 truncate">
                          {inv.httpMethod} {inv.endpointPath}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0 font-mono text-[11px] tabular-nums">
                      <span
                        className={
                          inv.status === 'held_for_approval'
                            ? 'text-amber-700 font-medium'
                            : inv.status === 'dispatched_after_approval'
                              ? 'text-blue-700 font-medium'
                              : 'text-emerald-700 font-medium'
                        }
                      >
                        {inv.status}
                      </span>
                      <span className="text-slate-600">{inv.durationMs}ms</span>
                      <span className="text-slate-400">
                        {new Date(inv.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-4 pt-2 bg-slate-50/60 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-[11px] font-semibold text-slate-700 mb-1">
                          Request Payload
                        </div>
                        <pre className="font-mono text-[11px] bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto text-slate-700 max-h-56">
                          {JSON.stringify(inv.requestPayload || {}, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-slate-700 mb-1">
                          Connector / Supervisor Response
                        </div>
                        <pre className="font-mono text-[11px] bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto text-slate-700 max-h-56">
                          {JSON.stringify(inv.responsePayload || {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
