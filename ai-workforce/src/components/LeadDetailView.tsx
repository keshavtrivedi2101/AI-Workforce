import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  HelpCircle,
  Mail,
  Play,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  AgentRunRecord,
  LeadRecord,
  OutreachDraftRecord,
  WorkflowRunRecord,
} from '../types';

interface LeadDetailViewProps {
  leadId: string;
  onBack: () => void;
  onNavigate: (page: string) => void;
}

interface LeadBundleResponse {
  lead: LeadRecord;
  drafts: OutreachDraftRecord[];
  workflowRuns: WorkflowRunRecord[];
  agentRuns: AgentRunRecord[];
}

export function LeadDetailView({ leadId, onBack, onNavigate }: LeadDetailViewProps) {
  const { apiFetch } = useAuth();
  const [bundle, setBundle] = useState<LeadBundleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<'qualify' | 'outreach' | 'workflow' | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadBundle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<LeadBundleResponse>(`/api/leads/${leadId}`);
      setBundle(data);
    } catch (err: any) {
      setError(err?.message || 'Unable to load lead details.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, leadId]);

  useEffect(() => {
    loadBundle();
  }, [loadBundle]);

  const handleRunAgentA = async () => {
    setActionBusy('qualify');
    setError(null);
    setBanner(null);
    try {
      const res = await apiFetch<{ score: number; disposition: string }>(
        `/api/agents/qualify/${leadId}`,
        { method: 'POST' }
      );
      setBanner(`Agent A saved qualification score ${res.score}/100 (${res.disposition}).`);
      await loadBundle();
    } catch (err: any) {
      setError(err?.message || 'Qualification failed.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleRunAgentB = async () => {
    setActionBusy('outreach');
    setError(null);
    setBanner(null);
    try {
      await apiFetch(`/api/agents/outreach/${leadId}`, { method: 'POST' });
      setBanner(
        'Agent B generated a personalized follow-up draft and placed it in Approval Center.'
      );
      await loadBundle();
    } catch (err: any) {
      setError(err?.message || 'Outreach drafting failed.');
    } finally {
      setActionBusy(null);
    }
  };

  const handleRunFullWorkflow = async () => {
    setActionBusy('workflow');
    setError(null);
    setBanner(null);
    try {
      const res = await apiFetch<{ workflowRun: { outcome: string | null } }>(
        '/api/workflows/execute',
        {
          method: 'POST',
          body: JSON.stringify({ leadId }),
        }
      );
      setBanner(res.workflowRun.outcome || 'Coordinated workflow finished.');
      await loadBundle();
    } catch (err: any) {
      setError(err?.message || 'Coordinated workflow failed.');
    } finally {
      setActionBusy(null);
    }
  };

  if (loading && !bundle) {
    return (
      <div className="space-y-6">
        <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-4">
        <p className="text-sm text-red-700">{error || 'Lead record not found.'}</p>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg cursor-pointer"
        >
          Back to Leads CRM
        </button>
      </div>
    );
  }

  const { lead, drafts, workflowRuns } = bundle;
  const breakdown = lead.qualificationBreakdown;

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 w-fit cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Leads CRM</span>
        </button>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleRunAgentA}
            disabled={actionBusy !== null}
            className="px-3.5 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {actionBusy === 'qualify' ? 'Evaluating Fit...' : 'Run Agent A · Qualification'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleRunAgentB}
            disabled={actionBusy !== null}
            className="px-3.5 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-800 rounded-lg hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>
              {actionBusy === 'outreach' ? 'Drafting Email...' : 'Run Agent B · Outreach Draft'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleRunFullWorkflow}
            disabled={actionBusy !== null}
            className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Play className="w-3.5 h-3.5" />
            <span>
              {actionBusy === 'workflow' ? 'Coordinating...' : 'Execute Full AI Workflow'}
            </span>
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
            Go to Approval Center
          </button>
        </div>
      )}

      {/* Lead Header & Verified Facts */}
      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        <div className="p-6 flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-1.5">
            <h2 className="font-display text-2xl font-bold text-slate-900">
              {lead.firstName} {lead.lastName}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span>{lead.jobTitle || 'Role unverified'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-slate-900">{lead.companyName}</span>
              <span aria-hidden="true">·</span>
              <span className={lead.isDemo ? 'text-amber-700 font-medium' : 'text-slate-600'}>
                {lead.isDemo ? 'Demo Sample Record' : 'Customer Record'}
              </span>
              <span aria-hidden="true">·</span>
              <span>Status: {lead.status}</span>
            </div>
          </div>

          <div className="text-left md:text-right shrink-0">
            <p className="text-xs text-slate-500">Qualification Fit Score</p>
            <p className="font-mono text-3xl font-bold text-slate-900 tabular-nums mt-0.5">
              {typeof lead.qualificationScore === 'number' ? `${lead.qualificationScore}/100` : '—'}
            </p>
            {lead.lastEvaluatedAt && (
              <p className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
                Evaluated {new Date(lead.lastEvaluatedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-xs">
          <div>
            <p className="text-slate-500 mb-1">Email Address</p>
            <p className="font-mono text-slate-900 break-all">{lead.email}</p>
          </div>
          <div>
            <p className="text-slate-500 mb-1">Phone Number</p>
            <p className="font-mono text-slate-900">{lead.phone || 'Missing (not provided)'}</p>
          </div>
          <div>
            <p className="text-slate-500 mb-1">Industry &amp; Headcount</p>
            <p className="text-slate-900">
              {lead.industry || 'Missing'} ·{' '}
              <span className="font-mono tabular-nums">
                {lead.companySize ? `${lead.companySize} employees` : 'Size unknown'}
              </span>
            </p>
          </div>
          <div>
            <p className="text-slate-500 mb-1">Estimated Budget</p>
            <p className="font-mono tabular-nums text-slate-900">
              {typeof lead.estimatedBudgetUsd === 'number'
                ? `$${lead.estimatedBudgetUsd.toLocaleString()} USD`
                : 'Missing (unverified)'}
            </p>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          <div>
            <p className="font-semibold text-slate-900 mb-1.5">Stated Pain Points</p>
            <p className="text-slate-600 leading-relaxed">
              {lead.painPoints || 'No pain points recorded yet.'}
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900 mb-1.5">CRM Context &amp; Notes</p>
            <p className="text-slate-600 leading-relaxed">
              {lead.notes || 'No internal notes recorded.'}
            </p>
          </div>
        </div>
      </section>

      {/* Transparent Qualification Breakdown & Missing Data Audit */}
      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        <div className="p-6">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Agent A · Transparent Qualification Explanation
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Scores are computed strictly from persisted database fields without inventing missing
            facts.
          </p>
        </div>

        {!breakdown ? (
          <div className="p-6 text-xs text-slate-600 flex items-center justify-between gap-4">
            <span>
              This lead has not been evaluated yet. Run Agent A Qualification to generate a
              transparent 0–100 score and missing-information audit.
            </span>
            <button
              type="button"
              onClick={handleRunAgentA}
              disabled={actionBusy !== null}
              className="px-3.5 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Score Lead Now
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            <p className="text-sm text-slate-800 leading-relaxed">{lead.qualificationSummary}</p>

            {/* Sub-score Bars */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 pt-2">
              {[
                { label: 'Industry Fit', val: breakdown.industryFitScore, max: 30 },
                { label: 'Budget Alignment', val: breakdown.budgetFitScore, max: 30 },
                { label: 'Company Scale', val: breakdown.companyScaleScore, max: 20 },
                { label: 'Data Completeness', val: breakdown.dataCompletenessScore, max: 20 },
              ].map((item) => {
                const pct = Math.round((item.val / item.max) * 100);
                return (
                  <div key={item.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{item.label}</span>
                      <span className="font-mono tabular-nums text-slate-900 font-semibold">
                        {item.val}/{item.max}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-slate-200 text-xs">
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Verified Strengths</span>
                </h4>
                <ul className="space-y-1.5 text-slate-600 list-disc pl-4">
                  {breakdown.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  <span>Fit Cautions</span>
                </h4>
                {breakdown.concerns.length === 0 ? (
                  <p className="text-slate-500">No material disqualifiers identified.</p>
                ) : (
                  <ul className="space-y-1.5 text-slate-600 list-disc pl-4">
                    {breakdown.concerns.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-blue-600" />
                  <span>Missing Information (Not Invented)</span>
                </h4>
                {breakdown.missingInformation.length === 0 ? (
                  <p className="text-emerald-700">All core qualification fields verified.</p>
                ) : (
                  <ul className="space-y-1.5 text-slate-600 list-disc pl-4">
                    {breakdown.missingInformation.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Persisted Outreach Drafts & Workflow History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
          <div className="p-5 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              AI Outreach Drafts ({drafts.length})
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('approvals')}
              className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
            >
              Open Approval Center
            </button>
          </div>
          {drafts.length === 0 ? (
            <div className="p-5 text-xs text-slate-500">
              No outreach drafts generated for this lead yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {drafts.map((d) => (
                <div key={d.id} className="p-5 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{d.subject}</span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                      {d.status}
                    </span>
                  </div>
                  <p className="text-slate-600 line-clamp-3 whitespace-pre-line">{d.body}</p>
                  {d.deliveryNote && (
                    <p className="text-[11px] text-slate-500 pt-1">{d.deliveryNote}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
          <div className="p-5 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Workflow Execution Runs ({workflowRuns.length})
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('workflows')}
              className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
            >
              Inspect Workflows
            </button>
          </div>
          {workflowRuns.length === 0 ? (
            <div className="p-5 text-xs text-slate-500">
              No coordinated workflows executed for this lead yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {workflowRuns.map((w) => (
                <div key={w.id} className="p-5 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{w.status}</span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      Retries: {w.retryCount}/{w.maxRetries} ·{' '}
                      {new Date(w.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-slate-600">{w.outcome || w.errorMessage || 'In progress'}</p>
                  {w.recoverySummary && (
                    <p className="text-emerald-700 text-[11px]">{w.recoverySummary}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
