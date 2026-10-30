import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CopyCheck,
  Play,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LeadRecord, WorkflowRunRecord } from '../types';

interface WorkflowsViewProps {
  onNavigate: (page: string) => void;
}

export function WorkflowsView({ onNavigate }: WorkflowsViewProps) {
  const { apiFetch } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowRunRecord[]>([]);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const [faultMode, setFaultMode] = useState<string>('default');
  const [customIdempotencyKey, setCustomIdempotencyKey] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wfRes, leadRes] = await Promise.all([
        apiFetch<{ workflows: WorkflowRunRecord[] }>('/api/workflows'),
        apiFetch<{ leads: LeadRecord[] }>('/api/leads'),
      ]);
      setWorkflows(wfRes.workflows);
      setLeads(leadRes.leads);

      if (leadRes.leads.length > 0 && !selectedLeadId) {
        setSelectedLeadId(leadRes.leads[0].id);
      }
      if (wfRes.workflows.length > 0 && !selectedRunId) {
        setSelectedRunId(wfRes.workflows[0].id);
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load workflows.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, selectedLeadId, selectedRunId]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleExecuteWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLeadId) {
      setError('Select or import a lead first before starting a workflow.');
      return;
    }
    setExecuting(true);
    setError(null);
    setBanner(null);

    try {
      const res = await apiFetch<{
        workflowRun: WorkflowRunRecord;
        deduplicated: boolean;
      }>('/api/workflows/execute', {
        method: 'POST',
        body: JSON.stringify({
          leadId: selectedLeadId,
          faultInjectionMode: faultMode,
          idempotencyKey: customIdempotencyKey.trim() || undefined,
        }),
      });

      setSelectedRunId(res.workflowRun.id);
      if (res.deduplicated) {
        setBanner(
          `Idempotency Safeguard Verified: Duplicate idempotency key "${res.workflowRun.idempotencyKey}" matched an existing run. Prevented duplicate AI execution and returned the original record.`
        );
      } else if (res.workflowRun.recoverySummary) {
        setBanner(`Self-Healing Recovery Complete: ${res.workflowRun.recoverySummary}`);
      } else {
        setBanner(res.workflowRun.outcome || 'Workflow execution finished.');
      }

      await loadWorkflows();
    } catch (err: any) {
      setError(err?.message || 'Workflow execution failed.');
    } finally {
      setExecuting(false);
    }
  };

  const activeRun = workflows.find((w) => w.id === selectedRunId) || workflows[0] || null;

  return (
    <div className="space-y-8">
      {/* Workflow Launcher & Self-Healing Fault Simulator */}
      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        <div className="p-6">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Agent C · Coordinated Workflow &amp; Self-Healing Runner
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Executes Load &amp; Validate → Agent A Qualification → Agent B Outreach Draft → Human
            Approval Gate with idempotency keys and bounded recovery.
          </p>
        </div>

        <form onSubmit={handleExecuteWorkflow} className="p-6 space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1.5">Target Lead Record</label>
              {leads.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onNavigate('leads')}
                  className="w-full py-2 px-3 bg-slate-100 text-slate-800 rounded-lg border border-slate-300 text-left cursor-pointer"
                >
                  Import or Add Leads in CRM →
                </button>
              ) : (
                <select
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                >
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.firstName} {l.lastName} · {l.companyName} {l.isDemo ? '(Demo)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1.5">
                Self-Healing Verification Mode
              </label>
              <select
                value={faultMode}
                onChange={(e) => setFaultMode(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="default">Standard Execution (Use Lead Default)</option>
                <option value="transient_network">
                  Test Recovery: Transient Network Drop (Bounded Retry)
                </option>
                <option value="rate_limit">
                  Test Recovery: Upstream 429 Rate Limit (Backoff Retry)
                </option>
                <option value="malformed_email">
                  Test Recovery: Malformed Contact Syntax (Deterministic Fix)
                </option>
                <option value="consequential_correction">
                  Test Safeguard: Consequential Contact Change (Require Approval)
                </option>
                <option value="permission_denied">
                  Test Safeguard: Permission Failure (Immediate Safe Stop)
                </option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1.5">
                Idempotency Key (Optional)
              </label>
              <input
                type="text"
                value={customIdempotencyKey}
                onChange={(e) => setCustomIdempotencyKey(e.target.value)}
                placeholder="Auto-generated if blank (re-use to test dedupe)"
                className="w-full px-3 py-2 font-mono bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="text-[11px] text-slate-500">
              {activeRun ? (
                <button
                  type="button"
                  onClick={() => setCustomIdempotencyKey(activeRun.idempotencyKey)}
                  className="text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <CopyCheck className="w-3.5 h-3.5" />
                  <span>Copy selected run's idempotency key to verify duplicate prevention</span>
                </button>
              ) : (
                <span>Retries are strictly bounded by your workspace Settings limit.</span>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={loadWorkflows}
                className="px-3 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
              <button
                type="submit"
                disabled={executing || leads.length === 0}
                className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{executing ? 'Executing & Verifying Steps...' : 'Run Workflow'}</span>
              </button>
            </div>
          </div>
        </form>
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
            onClick={() => onNavigate('approvals')}
            className="font-medium underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Open Approval Center
          </button>
        </div>
      )}

      {/* Split View: Workflow Run List + Step-by-Step Progress Inspector */}
      {loading && workflows.length === 0 ? (
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : workflows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <h3 className="font-display text-base font-semibold text-slate-900">
            No workflows executed yet
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Select a lead above and click "Run Workflow" to inspect step-by-step execution,
            idempotency keys, and self-healing recovery logs.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Runs List */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
            <div className="p-4 bg-slate-50/70">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Workflow Runs ({workflows.length})
              </h3>
            </div>
            <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
              {workflows.map((wf) => {
                const selected = activeRun?.id === wf.id;
                return (
                  <button
                    key={wf.id}
                    type="button"
                    onClick={() => setSelectedRunId(wf.id)}
                    className={`w-full text-left p-4 space-y-1.5 transition-colors cursor-pointer ${
                      selected ? 'bg-slate-100/90' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900 truncate">
                        {wf.leadName} · {wf.leadCompany}
                      </span>
                      <span
                        className={`font-medium shrink-0 ${
                          wf.status === 'completed' || wf.status === 'awaiting_approval'
                            ? 'text-emerald-700'
                            : wf.status === 'needs_human_intervention' || wf.status === 'failed'
                              ? 'text-red-700'
                              : 'text-blue-700'
                        }`}
                      >
                        {wf.status.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 font-mono tabular-nums flex items-center gap-2">
                      <span>{new Date(wf.startedAt).toLocaleString()}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Retries: {wf.retryCount}/{wf.maxRetries}
                      </span>
                    </div>

                    {wf.recoverySummary && (
                      <p className="text-[11px] text-emerald-800 flex items-center gap-1">
                        <Wrench className="w-3 h-3 shrink-0" />
                        <span className="truncate">{wf.recoverySummary}</span>
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Step-by-Step Progress Inspector */}
          {activeRun && (
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
              <div className="p-6 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    {activeRun.leadName} — {activeRun.leadCompany}
                  </h3>
                  <span className="font-mono text-xs text-slate-600 tabular-nums">
                    Status: {activeRun.status}
                  </span>
                </div>

                <div className="text-xs text-slate-500 font-mono tabular-nums space-y-1">
                  <div>Idempotency Key: {activeRun.idempotencyKey}</div>
                  <div>
                    Started: {new Date(activeRun.startedAt).toLocaleString()}
                    {activeRun.completedAt
                      ? ` · Completed: ${new Date(activeRun.completedAt).toLocaleString()}`
                      : ' · Waiting on Human Approval Gate'}
                  </div>
                </div>

                {activeRun.outcome && (
                  <p className="text-xs text-slate-800 pt-1">{activeRun.outcome}</p>
                )}

                {activeRun.recoverySummary && (
                  <div className="mt-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
                    <Wrench className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold">Self-Healing Recovery Log: </span>
                      <span>{activeRun.recoverySummary}</span>
                    </div>
                  </div>
                )}

                {activeRun.status === 'needs_human_intervention' && (
                  <div className="mt-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold">
                          Human Intervention Requested ({activeRun.errorCategory || 'policy'}):{' '}
                        </span>
                        <span>{activeRun.errorMessage}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('approvals')}
                      className="px-2.5 py-1 bg-white border border-red-200 rounded font-medium whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Review Queue
                    </button>
                  </div>
                )}
              </div>

              {/* Step Timeline */}
              <div className="divide-y divide-slate-100">
                {(activeRun.steps || []).map((step) => (
                  <div key={step.id} className="p-5 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {step.status === 'completed' || step.status === 'healed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : step.status === 'failed' ? (
                          <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                        ) : step.status === 'requires_approval' ? (
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        ) : (
                          <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <span className="font-semibold text-slate-900">
                          0{step.stepOrder}. {step.stepName}
                        </span>
                      </div>

                      <div className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                        {step.status} · Attempts: {step.attemptCount}
                      </div>
                    </div>

                    {step.healingAction && (
                      <p className="text-emerald-800 bg-emerald-50/70 border border-emerald-200 rounded-lg px-3 py-2">
                        <span className="font-semibold">Verified Self-Healing: </span>
                        {step.healingAction}
                      </p>
                    )}

                    {step.errorMessage && (
                      <p className="text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        <span className="font-semibold">
                          Error [{step.errorCategory || 'unknown'}]:{' '}
                        </span>
                        {step.errorMessage}
                      </p>
                    )}

                    {step.outputPayload && (
                      <pre className="font-mono text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto">
                        {JSON.stringify(step.outputPayload, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
