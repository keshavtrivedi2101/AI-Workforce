import React, { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, Play, RefreshCw, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AgentRunRecord, DashboardMetrics, LeadRecord } from '../types';

interface AgentsViewProps {
  onNavigate: (page: string) => void;
}

const AGENT_DESCRIPTIONS: Record<
  string,
  { role: string; responsibilities: string; safeguard: string }
> = {
  orchestrator_planner: {
    role: 'Natural-Language Directive & DAG Planner',
    responsibilities:
      'Breaks free-form business requests into Directed Acyclic Graph (DAG) task plans with explicit step dependencies, risk classifications, and structured inter-agent context handoffs.',
    safeguard: 'Routes high-risk outreach and consequential edits to Supervisor Human Checkpoints.',
  },
  crm_updater: {
    role: 'Function-Calling CRM & Tool Worker',
    responsibilities:
      'Uses Gemini Function Calling (upsert_crm_lead, update_crm_lifecycle_and_notes) and connected Sheet/Airtable adapters to create inbound prospects and synchronize deal stages.',
    safeguard: 'Writes strictly tenant-scoped records and logs every tool payload for auditability.',
  },
  lead_research: {
    role: 'Inbound Fit & Completeness Analyst',
    responsibilities:
      'Evaluates persisted lead records against your business qualification criteria, assigns a transparent 0–100 score across four weighted dimensions, and audits missing fields.',
    safeguard: 'Never invents missing revenue, headcount, or budget facts.',
  },
  sales_outreach: {
    role: 'Personalized B2B Communication Drafter',
    responsibilities:
      'Generates tailored follow-up emails with subject lines, message bodies, personalization rationales, and suggested next steps grounded strictly in verified CRM fields.',
    safeguard: 'Locked behind mandatory human review in Approval Center; zero autonomous dispatch.',
  },
  workflow_coordinator: {
    role: 'Idempotent Pipeline & Self-Healing Orchestrator',
    responsibilities:
      'Coordinates multi-step qualification and outreach workflows, tracks step timing, enforces idempotency keys, classifies errors, and applies bounded retries or deterministic repairs.',
    safeguard: 'Halts and escalates to humans when retry limits are reached or permissions fail.',
  },
  business_insights: {
    role: 'Audit-Grade Pipeline Intelligence Analyst',
    responsibilities:
      'Synthesizes exact SQL counts, conversion percentages, pending approval queues, and workflow health into executive recommendations.',
    safeguard: 'Labels estimates explicitly and flags low sample sizes (< 5 leads).',
  },
};

export function AgentsView({ onNavigate }: AgentsViewProps) {
  const { apiFetch } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [runs, setRuns] = useState<AgentRunRecord[]>([]);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashData, runsData, leadsData] = await Promise.all([
        apiFetch<DashboardMetrics>('/api/dashboard'),
        apiFetch<{ runs: AgentRunRecord[] }>('/api/agents/runs'),
        apiFetch<{ leads: LeadRecord[] }>('/api/leads'),
      ]);
      setMetrics(dashData);
      setRuns(runsData.runs);
      setLeads(leadsData.leads);
      if (leadsData.leads.length > 0 && !selectedLeadId) {
        setSelectedLeadId(leadsData.leads[0].id);
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load AI Workforce status.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, selectedLeadId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleTriggerAgent = async (agentKey: string) => {
    if (agentKey === 'orchestrator_planner' || agentKey === 'crm_updater') {
      onNavigate('mission_planner');
      return;
    }

    setBusyAgent(agentKey);
    setError(null);
    setBanner(null);
    try {
      if (agentKey === 'business_insights') {
        await apiFetch('/api/agents/insights', { method: 'POST' });
        setBanner('Agent D generated a new database-verified insights report.');
      } else {
        if (!selectedLeadId) {
          throw new Error('Select or import a lead first before running lead-scoped agents.');
        }
        if (agentKey === 'lead_research') {
          const res = await apiFetch<{ score: number; disposition: string }>(
            `/api/agents/qualify/${selectedLeadId}`,
            { method: 'POST' }
          );
          setBanner(`Agent A completed evaluation: ${res.score}/100 (${res.disposition}).`);
        } else if (agentKey === 'sales_outreach') {
          await apiFetch(`/api/agents/outreach/${selectedLeadId}`, { method: 'POST' });
          setBanner('Agent B saved a personalized draft to Approval Center.');
        } else if (agentKey === 'workflow_coordinator') {
          const res = await apiFetch<{ workflowRun: { outcome: string | null } }>(
            '/api/workflows/execute',
            {
              method: 'POST',
              body: JSON.stringify({ leadId: selectedLeadId }),
            }
          );
          setBanner(res.workflowRun.outcome || 'Agent C finished coordinating workflow.');
        }
      }
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Agent execution failed.');
    } finally {
      setBusyAgent(null);
    }
  };

  if (loading && !metrics) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-52 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Target Lead Selector Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Interactive Agent Dispatch Target
          </h2>
          <p className="text-xs text-slate-500">
            Choose a persisted lead record to test Agent A, Agent B, or Agent C directly from this
            roster.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {leads.length > 0 ? (
            <select
              value={selectedLeadId}
              onChange={(e) => setSelectedLeadId(e.target.value)}
              aria-label="Target lead for agent dispatch"
              className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600 max-w-xs"
            >
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.firstName} {lead.lastName} — {lead.companyName}{' '}
                  {lead.isDemo ? '(Demo)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('leads')}
              className="px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer"
            >
              Add or Import Leads First
            </button>
          )}
          <button
            type="button"
            onClick={loadData}
            aria-label="Refresh agent telemetry"
            className="p-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

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
            onClick={() => onNavigate('approvals')}
            className="font-medium underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Review Approvals
          </button>
        </div>
      )}

      {/* 4 Digital Agents Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(metrics?.agentSummary || []).map((agent) => {
          const meta = AGENT_DESCRIPTIONS[agent.agentKey];
          const isRunning = busyAgent === agent.agentKey;
          return (
            <div
              key={agent.agentKey}
              className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 flex flex-col justify-between"
            >
              <div className="p-6 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      {agent.agentName}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">{meta?.role}</p>
                  </div>
                  <Bot className="w-5 h-5 text-slate-400 shrink-0" />
                </div>

                <p className="text-xs text-slate-700 leading-relaxed">{meta?.responsibilities}</p>
                <p className="text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-700">Safety Policy:</span>{' '}
                  {meta?.safeguard}
                </p>
              </div>

              <div className="px-6 py-4 bg-slate-50/60 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-3 font-mono tabular-nums text-slate-600">
                  <span>Runs: {agent.totalRuns}</span>
                  <span aria-hidden="true">·</span>
                  <span>Succeeded: {agent.completedRuns}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Avg:{' '}
                    {agent.avgDurationMs !== null ? `${agent.avgDurationMs}ms` : '—'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleTriggerAgent(agent.agentKey)}
                  disabled={busyAgent !== null}
                  className="px-3.5 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3 h-3" />
                  <span>
                    {isRunning
                      ? 'Executing...'
                      : agent.agentKey === 'orchestrator_planner' ||
                          agent.agentKey === 'crm_updater'
                        ? 'Open DAG Planner'
                        : 'Run Agent'}
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {/* Persisted Agent Run History Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Persisted Agent Execution History
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Every server-side Gemini invocation recorded in PostgreSQL with model version and
            latency
          </p>
        </div>

        {runs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No AI agent runs recorded yet. Trigger an agent above or execute a workflow.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-600">
                  <th className="py-3 px-4">Agent</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Summary / Output</th>
                  <th className="py-3 px-4 text-right">Duration</th>
                  <th className="py-3 px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {runs.slice(0, 20).map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{run.agentName}</div>
                      <div className="font-mono text-[11px] text-slate-500">{run.modelUsed}</div>
                    </td>
                    <td className="py-3 px-4">
                      {run.status === 'completed' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Completed</span>
                        </span>
                      ) : run.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Failed</span>
                        </span>
                      ) : (
                        <span className="text-blue-700 font-medium">Running</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700 max-w-md">
                      {run.summary || run.errorMessage || 'Processing...'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                      {typeof run.durationMs === 'number' ? `${run.durationMs}ms` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500">
                      {new Date(run.startedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
