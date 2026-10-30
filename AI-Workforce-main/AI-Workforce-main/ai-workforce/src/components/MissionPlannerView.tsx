import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  GitMerge,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  ApprovalItemRecord,
  LeadRecord,
  WorkflowRunRecord,
  WorkflowStepRecord,
} from '../types';

interface MissionPlannerViewProps {
  onNavigate: (page: string, leadId?: string) => void;
  initialDirective?: string | null;
  onConsumeInitialDirective?: () => void;
}

const STARTER_DIRECTIVES: Array<{
  id: string;
  label: string;
  summary: string;
  prompt: string;
}> = [
  {
    id: 'inbound_onboard',
    label: 'Onboard New Inbound Prospect',
    summary: 'Function-calls CRM upsert -> scores fit -> syncs Sheets -> stages follow-up checkpoint',
    prompt:
      'Onboard inbound inquiry from Apex Logistics (Maya Lin, maya@apexlogistics.io, VP Operations, Logistics & Supply Chain, 85 employees, $28,000 budget, struggling with manual warehouse dispatch spreadsheets): create the CRM record, evaluate fit score, sync to Google Sheets, and draft a personalized follow-up held for my sign-off.',
  },
  {
    id: 'qualify_and_sync',
    label: 'Qualify CRM Lead & Sync Deal Trackers',
    summary: 'Evaluates existing CRM lead -> syncs Google Sheets & Airtable -> drafts outreach',
    prompt:
      'Evaluate our selected CRM prospect against workspace qualification criteria, sync the scored deal card to Google Sheets and Airtable, update CRM lifecycle notes, and prepare a personalized follow-up email for human approval.',
  },
  {
    id: 'self_healing_audit',
    label: 'Self-Healing Contact Repair & Outreach',
    summary: 'Repairs malformed contact formatting -> scores lead -> pauses at human checkpoint',
    prompt:
      'Audit prospect contact formatting and repair any malformed email syntax, run transparent qualification scoring, sync pipeline records, and stage a verified outreach email for supervisor review.',
  },
  {
    id: 'executive_audit',
    label: 'Executive Pipeline & Bottleneck Audit',
    summary: 'Analyzes SQL pipeline metrics -> generates verified executive insights briefing',
    prompt:
      'Analyze our stored CRM pipeline counts, qualification conversion rates, and pending human checkpoints to produce an audit-grade executive briefing with concrete next steps.',
  },
];

const AGENT_DISPLAY_LABELS: Record<string, string> = {
  orchestrator_planner: 'Orchestrator Planner',
  crm_updater: 'CRM Updater (Function Calling)',
  lead_research: 'Agent A · Lead Qualifier',
  sheets_webhook_sync: 'Connected Tool Worker',
  sales_outreach: 'Agent B · Outreach Dispatcher',
  business_insights: 'Agent D · Insights Analyst',
  workflow_coordinator: 'Agent C · Coordinator',
};

export function MissionPlannerView({
  onNavigate,
  initialDirective,
  onConsumeInitialDirective,
}: MissionPlannerViewProps) {
  const { apiFetch } = useAuth();
  const [directive, setDirective] = useState<string>(STARTER_DIRECTIVES[0].prompt);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [targetLeadId, setTargetLeadId] = useState<string>('');
  const [faultMode, setFaultMode] = useState<string>('none');
  const [customIdempotencyKey, setCustomIdempotencyKey] = useState<string>('');

  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItemRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});

  const [editedSubject, setEditedSubject] = useState<string>('');
  const [editedBody, setEditedBody] = useState<string>('');
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [executing, setExecuting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadWorkspaceRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wfRes, leadsRes, approvalsRes] = await Promise.all([
        apiFetch<{ workflows: WorkflowRunRecord[] }>('/api/workflows'),
        apiFetch<{ leads: LeadRecord[] }>('/api/leads'),
        apiFetch<{ approvals: ApprovalItemRecord[] }>('/api/approvals'),
      ]);
      setRuns(wfRes.workflows);
      setLeads(leadsRes.leads);
      setApprovals(approvalsRes.approvals);

      const directiveRuns = wfRes.workflows.filter(
        (r) => r.workflowType === 'directive_dag' || Boolean(r.directivePrompt)
      );
      if (!selectedRunId) {
        if (directiveRuns.length > 0) {
          setSelectedRunId(directiveRuns[0].id);
        } else if (wfRes.workflows.length > 0) {
          setSelectedRunId(wfRes.workflows[0].id);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load Orchestrator DAG workspace.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, selectedRunId]);

  useEffect(() => {
    loadWorkspaceRuns();
  }, [loadWorkspaceRuns]);

  useEffect(() => {
    if (initialDirective && initialDirective.trim()) {
      setDirective(initialDirective.trim());
      if (onConsumeInitialDirective) {
        onConsumeInitialDirective();
      }
    }
  }, [initialDirective, onConsumeInitialDirective]);

  const activeRun = runs.find((r) => r.id === selectedRunId) || runs[0] || null;

  const pendingCheckpoint = activeRun
    ? approvals.find((a) => a.workflowRunId === activeRun.id && a.status === 'pending') || null
    : null;

  useEffect(() => {
    if (pendingCheckpoint?.draft) {
      setEditedSubject(pendingCheckpoint.draft.subject);
      setEditedBody(pendingCheckpoint.draft.body);
    }
  }, [pendingCheckpoint?.id]);

  const handleExecuteDirective = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directive.trim()) {
      setError('Enter a business request for the Orchestrator Agent to plan and execute.');
      return;
    }

    setExecuting(true);
    setError(null);
    setBanner(null);

    try {
      const res = await apiFetch<{
        workflowRun: WorkflowRunRecord;
        deduplicated: boolean;
      }>('/api/directives/execute', {
        method: 'POST',
        body: JSON.stringify({
          directive: directive.trim(),
          targetLeadId: targetLeadId || undefined,
          faultInjectionMode: faultMode,
          idempotencyKey: customIdempotencyKey.trim() || undefined,
        }),
      });

      setSelectedRunId(res.workflowRun.id);
      setBanner(
        res.deduplicated
          ? 'Idempotency guard matched an existing DAG execution key — duplicate side effects prevented.'
          : res.workflowRun.outcome ||
              'Orchestrator decomposed your business request into DAG tasks and completed execution.'
      );
      await loadWorkspaceRuns();
    } catch (err: any) {
      setError(err?.message || 'Orchestrator failed to execute directive.');
    } finally {
      setExecuting(false);
    }
  };

  const handleInlineCheckpointDecision = async (
    approval: ApprovalItemRecord,
    decision: 'approved' | 'rejected'
  ) => {
    setApprovingId(approval.id);
    setError(null);
    setBanner(null);
    try {
      await apiFetch(`/api/approvals/${approval.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          editedSubject: approval.draft ? editedSubject : undefined,
          editedBody: approval.draft ? editedBody : undefined,
          decisionNotes:
            decision === 'approved'
              ? 'One-click supervisor sign-off from DAG Mission Planner'
              : 'Rejected at DAG Supervisor Checkpoint',
        }),
      });
      setBanner(
        decision === 'approved'
          ? 'Supervisor checkpoint signed off. Outreach released in safe simulated mode and webhook event logged.'
          : 'Supervisor checkpoint rejected. Held action was cancelled safely.'
      );
      await loadWorkspaceRuns();
    } catch (err: any) {
      setError(err?.message || 'Unable to finalize checkpoint decision.');
    } finally {
      setApprovingId(null);
    }
  };

  const toggleStepPayload = (stepId: string) => {
    setExpandedStepIds((prev) => ({ ...prev, [stepId]: !prev[stepId] }));
  };

  const renderStepIcon = (status: WorkflowStepRecord['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
      case 'healed':
        return <Wrench className="w-4 h-4 text-blue-600 shrink-0" />;
      case 'requires_approval':
        return <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600 shrink-0" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400 shrink-0" />;
    }
  };

  return (
    <div className="space-y-8">
      {/* 4-Stage Architecture Flow Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200 text-xs">
        <div className="p-4 space-y-1">
          <div className="font-mono text-[11px] font-semibold text-blue-700 tabular-nums">
            STAGE 01 · ORCHESTRATOR
          </div>
          <div className="font-semibold text-slate-900">DAG Task Planner</div>
          <p className="text-slate-500 leading-relaxed">
            Decomposes natural-language requests into ordered tasks with explicit dependencies.
          </p>
        </div>
        <div className="p-4 space-y-1">
          <div className="font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
            STAGE 02 · WORKER AGENTS
          </div>
          <div className="font-semibold text-slate-900">Specialized Specialists</div>
          <p className="text-slate-500 leading-relaxed">
            CRM Updater, Lead Qualifier, Connected Tool Sync, Outreach Drafter, and Insights.
          </p>
        </div>
        <div className="p-4 space-y-1">
          <div className="font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
            STAGE 03 · TOOL LAYER
          </div>
          <div className="font-semibold text-slate-900">Function Calling &amp; Connectors</div>
          <p className="text-slate-500 leading-relaxed">
            Executes PostgreSQL CRM mutations, Google Sheets rows, and Airtable deal syncs.
          </p>
        </div>
        <div className="p-4 space-y-1">
          <div className="font-mono text-[11px] font-semibold text-amber-700 tabular-nums">
            STAGE 04 · SUPERVISOR
          </div>
          <div className="font-semibold text-slate-900">Human Checkpoint</div>
          <p className="text-slate-500 leading-relaxed">
            Pauses external emails and consequential changes for one-click human sign-off.
          </p>
        </div>
      </section>

      {/* Natural-Language Business Directive Composer */}
      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        <div className="p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Submit a Business Request to the Orchestrator Agent
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Describe an operational goal in plain English or load a starter scenario below. The
                Orchestrator builds a multi-agent DAG, exchanges structured context across tasks,
                and pauses high-risk actions for your sign-off.
              </p>
            </div>
            <button
              type="button"
              onClick={loadWorkspaceRuns}
              aria-label="Refresh DAG runs"
              className="self-start sm:self-auto p-2 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-slate-700 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Starter Directive Presets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {STARTER_DIRECTIVES.map((preset) => {
              const isSelected = directive === preset.prompt;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setDirective(preset.prompt)}
                  className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/40'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-900">{preset.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{preset.summary}</div>
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={handleExecuteDirective} className="p-6 space-y-5">
          <div>
            <label
              htmlFor="business-directive-input"
              className="block text-xs font-semibold text-slate-800 mb-1.5"
            >
              Business Request / Natural-Language Directive
            </label>
            <textarea
              id="business-directive-input"
              rows={3}
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              placeholder="Example: Onboard inbound lead from Horizon Freight, qualify fit against our criteria, sync to Google Sheets, and draft a personalized follow-up email..."
              className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 leading-relaxed focus:bg-white focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-4">
              <label
                htmlFor="directive-target-lead"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Optional Existing CRM Lead Context
              </label>
              <select
                id="directive-target-lead"
                value={targetLeadId}
                onChange={(e) => setTargetLeadId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="">Auto-detect or create from directive</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.firstName} {l.lastName} — {l.companyName} ({l.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4">
              <label
                htmlFor="directive-fault-mode"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Resilience / Fault Simulation
              </label>
              <select
                id="directive-fault-mode"
                value={faultMode}
                onChange={(e) => setFaultMode(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="none">Standard Live Execution (No Injected Fault)</option>
                <option value="transient_network">Transient Connector Timeout (Auto-Retry)</option>
                <option value="rate_limit">429 Rate Limit Backoff (Auto-Retry)</option>
                <option value="malformed_email">Malformed Email Syntax (Auto-Heal)</option>
                <option value="permission_denied">403 Permission Failure (Safe Escalation)</option>
              </select>
            </div>

            <div className="md:col-span-4">
              <label
                htmlFor="directive-idem-key"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Idempotency Key (Optional)
              </label>
              <input
                id="directive-idem-key"
                type="text"
                value={customIdempotencyKey}
                onChange={(e) => setCustomIdempotencyKey(e.target.value)}
                placeholder="Auto-generated if blank"
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="text-[11px] text-slate-500">
              Executes server-side with Gemini Function Calling, PostgreSQL persistence, and
              Connector Relay audit logging.
            </div>
            <button
              type="submit"
              disabled={executing}
              className="px-5 py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>
                {executing ? 'Planning & Executing Multi-Agent DAG...' : 'Plan & Execute Directive'}
              </span>
            </button>
          </div>
        </form>
      </section>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800"
        >
          {error}
        </div>
      )}

      {banner && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex flex-wrap items-center justify-between gap-4">
          <span>{banner}</span>
          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('tools_relay')}
              className="font-medium underline cursor-pointer"
            >
              Inspect Tool Calls
            </button>
            <button
              type="button"
              onClick={() => onNavigate('approvals')}
              className="font-medium underline cursor-pointer"
            >
              Open Approval Center
            </button>
          </div>
        </div>
      )}

      {/* Live DAG History & Task Dependency Inspector */}
      {loading && runs.length === 0 ? (
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : runs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <h3 className="font-display text-base font-semibold text-slate-900">
            No multi-agent plans executed yet
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Click "Plan &amp; Execute Directive" above to watch the Orchestrator break a business
            request into DAG tasks, invoke CRM &amp; Sheet tools, and stage an outreach draft for
            your approval.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Execution History */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200">
            <div className="p-4 bg-slate-50/80 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800">
                Execution Runs ({runs.length})
              </span>
              <span className="font-mono text-[11px] text-slate-500">Latest first</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
              {runs.map((r) => {
                const isSelected = activeRun?.id === r.id;
                const isDirective =
                  r.workflowType === 'directive_dag' || Boolean(r.directivePrompt);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRunId(r.id)}
                    className={`w-full text-left p-4 space-y-1.5 transition-colors cursor-pointer ${
                      isSelected ? 'bg-slate-100/90' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900 truncate">
                        {r.leadName || 'Workspace Directive'}
                      </span>
                      <span
                        className={`font-mono text-[11px] font-medium shrink-0 ${
                          r.status === 'completed'
                            ? 'text-emerald-700'
                            : r.status === 'awaiting_approval'
                              ? 'text-amber-700'
                              : r.status === 'needs_human_intervention' || r.status === 'failed'
                                ? 'text-red-700'
                                : 'text-blue-700'
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                      {r.directivePrompt || `${r.leadCompany || 'Lead'} · Coordinated pipeline`}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                      <span>{isDirective ? 'DAG Plan' : 'Standard Flow'}</span>
                      <span>
                        {new Date(r.startedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Active DAG Task Graph & Supervisor Checkpoint */}
          {activeRun && (
            <div className="lg:col-span-8 space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
                {/* Run Summary Header */}
                <div className="p-6 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <GitMerge className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                        <span className="font-medium text-slate-700">
                          {activeRun.workflowType === 'directive_dag' || activeRun.directivePrompt
                            ? 'Orchestrated Multi-Agent DAG'
                            : 'Coordinated Lead Workflow'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          Retries: {activeRun.retryCount}/{activeRun.maxRetries}
                        </span>
                      </div>
                      <h3 className="font-display text-base font-semibold text-slate-900">
                        {activeRun.leadName || 'Workspace Directive'} —{' '}
                        {activeRun.leadCompany || 'Multi-Agent Execution'}
                      </h3>
                    </div>

                    <div className="flex items-center gap-3">
                      {activeRun.leadId && (
                        <button
                          type="button"
                          onClick={() => onNavigate('lead_detail', activeRun.leadId!)}
                          className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          <span>Inspect CRM Record</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {activeRun.directivePrompt && (
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 leading-relaxed">
                      <span className="font-semibold text-slate-900">Business Directive: </span>
                      <span>{activeRun.directivePrompt}</span>
                    </div>
                  )}

                  <div className="text-xs text-slate-500 font-mono break-all">
                    Idempotency Key: {activeRun.idempotencyKey}
                  </div>

                  {activeRun.outcome && (
                    <p className="text-xs text-slate-700 leading-relaxed">{activeRun.outcome}</p>
                  )}

                  {activeRun.recoverySummary && (
                    <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900">
                      <span className="font-semibold">Self-Healing Recovery Log: </span>
                      <span>{activeRun.recoverySummary}</span>
                    </div>
                  )}

                  {activeRun.errorMessage && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900">
                      <span className="font-semibold">
                        Escalation ({activeRun.errorCategory || 'error'}):{' '}
                      </span>
                      <span>{activeRun.errorMessage}</span>
                    </div>
                  )}
                </div>

                {/* Inline One-Click Supervisor Human Checkpoint (Stage 4) */}
                {pendingCheckpoint && (
                  <div className="p-6 bg-amber-50/50 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-display text-sm font-semibold text-slate-900">
                            Supervisor Checkpoint · Human One-Click Sign-Off Required
                          </h4>
                          <p className="text-xs text-slate-600 mt-0.5">
                            High-risk external outreach for{' '}
                            <strong className="text-slate-900">
                              {pendingCheckpoint.leadFirstName} {pendingCheckpoint.leadLastName} (
                              {pendingCheckpoint.leadEmail})
                            </strong>{' '}
                            is paused. Review or edit below and sign off to complete this DAG run.
                          </p>
                        </div>
                      </div>
                    </div>

                    {pendingCheckpoint.draft ? (
                      <div className="space-y-3 bg-white border border-amber-200 rounded-lg p-4 text-xs">
                        <div>
                          <label className="block font-semibold text-slate-800 mb-1">
                            Subject Line
                          </label>
                          <input
                            type="text"
                            value={editedSubject}
                            onChange={(e) => setEditedSubject(e.target.value)}
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-800 mb-1">
                            Draft Body (Grounded in Verified CRM Fields)
                          </label>
                          <textarea
                            rows={5}
                            value={editedBody}
                            onChange={(e) => setEditedBody(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 leading-relaxed focus:outline-none focus:border-blue-600"
                          />
                        </div>
                        <div className="text-[11px] text-slate-500">
                          <strong className="text-slate-700">Rationale:</strong>{' '}
                          {pendingCheckpoint.draft.personalizationRationale}
                        </div>
                      </div>
                    ) : (
                      <pre className="font-mono text-[11px] bg-white border border-amber-200 rounded-lg p-3 overflow-x-auto text-slate-800">
                        {JSON.stringify(pendingCheckpoint.proposedChanges, null, 2)}
                      </pre>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <button
                        type="button"
                        disabled={approvingId === pendingCheckpoint.id}
                        onClick={() => handleInlineCheckpointDecision(pendingCheckpoint, 'rejected')}
                        className="px-3.5 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-800 rounded-lg hover:bg-red-50 hover:text-red-700 transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Reject Action</span>
                      </button>
                      <button
                        type="button"
                        disabled={approvingId === pendingCheckpoint.id}
                        onClick={() => handleInlineCheckpointDecision(pendingCheckpoint, 'approved')}
                        className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>
                          {approvingId === pendingCheckpoint.id
                            ? 'Signing Off...'
                            : 'One-Click Sign-Off & Dispatch Safe Relay'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {/* DAG Task Nodes & Inter-Agent Payload Exchange */}
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <h4 className="text-xs font-semibold text-slate-900">
                      DAG Task Execution &amp; Inter-Agent Context Handoff (
                      {(activeRun.steps || []).length} nodes)
                    </h4>
                    <span className="text-[11px] text-slate-500">
                      Click any task to inspect upstream/downstream payloads
                    </span>
                  </div>

                  {(activeRun.steps || []).map((step) => {
                    const isExpanded = Boolean(expandedStepIds[step.id]);
                    const deps = Array.isArray(step.dependsOn) ? step.dependsOn : [];
                    return (
                      <div
                        key={step.id}
                        className="border border-slate-200 rounded-lg overflow-hidden bg-white"
                      >
                        <button
                          type="button"
                          onClick={() => toggleStepPayload(step.id)}
                          className="w-full text-left p-4 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            {renderStepIcon(step.status)}
                            <div className="space-y-1 min-w-0">
                              <div className="text-xs font-semibold text-slate-900 flex flex-wrap items-center gap-2">
                                <span className="font-mono text-slate-400 tabular-nums">
                                  {String(step.stepOrder).padStart(2, '0')}
                                </span>
                                <span>{step.stepName}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-medium text-slate-700">
                                  {AGENT_DISPLAY_LABELS[step.agentKey] || step.agentKey}
                                </span>
                                {step.toolName && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono text-slate-600">
                                      Tool: {step.toolName}
                                    </span>
                                  </>
                                )}
                                <span aria-hidden="true">·</span>
                                <span className="font-mono">
                                  {deps.length > 0
                                    ? `Depends on: ${deps.join(', ')}`
                                    : 'Root task'}
                                </span>
                                {step.riskLevel === 'high_checkpoint' && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-amber-700 font-medium">
                                      Supervisor Gate
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] text-slate-600 tabular-nums">
                            <span>
                              {step.status} ({step.attemptCount}x)
                            </span>
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </div>
                        </button>

                        {(step.healingAction || step.errorMessage || isExpanded) && (
                          <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50/50 space-y-3 text-xs">
                            {step.healingAction && (
                              <div className="text-blue-800 flex items-start gap-2">
                                <Wrench className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                                <span>{step.healingAction}</span>
                              </div>
                            )}

                            {step.errorMessage && (
                              <div className="text-red-700 flex items-start gap-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                                <span>
                                  [{step.errorCategory || 'error'}] {step.errorMessage}
                                </span>
                              </div>
                            )}

                            {isExpanded && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                <div>
                                  <div className="text-[11px] font-semibold text-slate-700 mb-1">
                                    Task Input &amp; Upstream Agent Handoff
                                  </div>
                                  <pre className="font-mono text-[11px] bg-white border border-slate-200 rounded p-3 overflow-x-auto text-slate-700 max-h-52">
                                    {JSON.stringify(step.inputPayload || {}, null, 2)}
                                  </pre>
                                </div>
                                <div>
                                  <div className="text-[11px] font-semibold text-slate-700 mb-1">
                                    Structured Task Output
                                  </div>
                                  <pre className="font-mono text-[11px] bg-white border border-slate-200 rounded p-3 overflow-x-auto text-slate-700 max-h-52">
                                    {JSON.stringify(step.outputPayload || {}, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
