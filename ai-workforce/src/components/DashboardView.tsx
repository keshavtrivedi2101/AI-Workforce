import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { DashboardMetrics } from '../types';

interface DashboardViewProps {
  onNavigate: (page: string, leadId?: string) => void;
  onLaunchDirective?: (directivePrompt: string) => void;
}

export function DashboardView({ onNavigate, onLaunchDirective }: DashboardViewProps) {
  const { apiFetch } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importingDemo, setImportingDemo] = useState(false);
  const [runningInsights, setRunningInsights] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [quickDirective, setQuickDirective] = useState(
    'Onboard inbound inquiry from Apex Logistics (Maya Lin, maya@apexlogistics.io, VP Operations, 85 employees, $28,000 budget, manual dispatch spreadsheets): create CRM record, score fit, sync Google Sheets, and draft follow-up for my approval.'
  );

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<DashboardMetrics>('/api/dashboard');
      setMetrics(data);
    } catch (err: any) {
      setError(err?.message || 'Unable to load dashboard analytics.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  const handleImportDemo = async () => {
    setImportingDemo(true);
    setError(null);
    setFeedbackBanner(null);
    try {
      const res = await apiFetch<{ importedCount: number }>('/api/leads/import-demo', {
        method: 'POST',
      });
      setFeedbackBanner(
        res.importedCount > 0
          ? `Imported ${res.importedCount} sample demo leads. Select Leads CRM or Workflows to run end-to-end qualification and outreach.`
          : 'All sample demo leads are already present in your workspace.'
      );
      await loadMetrics();
    } catch (err: any) {
      setError(err?.message || 'Unable to import demo leads.');
    } finally {
      setImportingDemo(false);
    }
  };

  const handleRunInsightsAgent = async () => {
    setRunningInsights(true);
    setError(null);
    try {
      await apiFetch('/api/agents/insights', { method: 'POST' });
      await loadMetrics();
    } catch (err: any) {
      setError(err?.message || 'Business Insights agent encountered an error.');
    } finally {
      setRunningInsights(false);
    }
  };

  if (loading && !metrics) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-5 border border-slate-200 rounded-xl bg-white divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-5 space-y-2 animate-pulse">
              <div className="h-3 w-24 bg-slate-200 rounded" />
              <div className="h-7 w-16 bg-slate-200 rounded" />
              <div className="h-3 w-32 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 bg-white border border-slate-200 rounded-xl p-6 animate-pulse" />
          <div className="h-72 bg-white border border-slate-200 rounded-xl p-6 animate-pulse" />
        </div>
      </div>
    );
  }

  const counts = metrics?.counts;
  const rates = metrics?.rates;
  const insightOutput = metrics?.latestInsightRun?.structuredOutput as
    | {
        executiveHeadline?: string;
        dataConfidenceLabel?: string;
        keyFindings?: string[];
        operationalBottlenecks?: string[];
        recommendedActions?: string[];
      }
    | undefined;

  return (
    <div className="space-y-8">
      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-center justify-between gap-4"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={loadMetrics}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-red-200 rounded-lg hover:bg-red-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {feedbackBanner && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-center justify-between gap-4">
          <span>{feedbackBanner}</span>
          <button
            type="button"
            onClick={() => onNavigate('leads')}
            className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Open Leads CRM
          </button>
        </div>
      )}

      {/* Natural-Language Orchestrator Quick Launch Bar */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Orchestrator · Natural-Language Business Directive
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Give your AI Workforce a business goal. The Orchestrator breaks it into DAG tasks,
              calls CRM &amp; Sheet tools, and pauses external outreach at your human checkpoint.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('tools_relay')}
            className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Connected Tools ({counts?.toolInvocationsCount ?? 0} calls)</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (onLaunchDirective) {
              onLaunchDirective(quickDirective);
            } else {
              onNavigate('mission_planner');
            }
          }}
          className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
        >
          <input
            type="text"
            value={quickDirective}
            onChange={(e) => setQuickDirective(e.target.value)}
            aria-label="Business request for Orchestrator Agent"
            placeholder="Describe a business task (e.g., onboard a prospect, score fit, sync Google Sheets, draft outreach)..."
            className="flex-1 px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:border-blue-600"
          />
          <button
            type="submit"
            className="px-4 py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Open in DAG Planner</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </section>

      {/* Empty State / Sample Size Notice */}
      {counts && counts.totalLeads === 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-7 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1.5 max-w-2xl">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Your workspace currently has zero persisted leads
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Import 5 clearly labeled sample B2B leads (including missing-budget and email-healing
              cases) to run the end-to-end qualification, drafting, self-healing, and human approval
              pipeline, or add your own customer lead directly.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleImportDemo}
              disabled={importingDemo}
              className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{importingDemo ? 'Importing...' : 'Import Sample Leads'}</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('leads')}
              className="px-4 py-2 text-xs font-medium bg-white text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Add Customer Lead
            </button>
          </div>
        </section>
      )}

      {rates?.insufficientDataNotice && counts && counts.totalLeads > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-900 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
          <span>{rates.insufficientDataNotice}</span>
        </div>
      )}

      {/* Primary KPI Strip (Single-Elevation, Hairline Divided, Tabular Figures) */}
      {counts && rates && (
        <section
          aria-label="Verified Operational Metrics"
          className="grid grid-cols-2 lg:grid-cols-5 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 lg:divide-x divide-slate-200"
        >
          <div className="p-5 space-y-1.5">
            <p className="text-xs font-medium text-slate-500">Total Persisted Leads</p>
            <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {counts.totalLeads}
            </p>
            <p className="text-xs text-slate-500 tabular-nums">
              {counts.realLeads} customer · {counts.demoLeads} demo
            </p>
          </div>

          <div className="p-5 space-y-1.5">
            <p className="text-xs font-medium text-slate-500">Qualification Fit Rate</p>
            <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {rates.qualificationRatePct !== null ? `${rates.qualificationRatePct}%` : '—'}
            </p>
            <p className="text-xs text-slate-500 tabular-nums">
              Avg score:{' '}
              {rates.averageQualificationScore !== null
                ? `${rates.averageQualificationScore}/100`
                : 'Not yet scored'}
            </p>
          </div>

          <div className="p-5 space-y-1.5">
            <p className="text-xs font-medium text-slate-500">Pending Human Approvals</p>
            <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {counts.pendingApprovals}
            </p>
            <button
              type="button"
              onClick={() => onNavigate('approvals')}
              className="text-xs font-medium text-blue-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Review Approval Queue</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="p-5 space-y-1.5">
            <p className="text-xs font-medium text-slate-500">Completed Workflows</p>
            <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {counts.completedWorkflows}
            </p>
            <p className="text-xs text-slate-500 tabular-nums">
              {counts.directiveRunsCount} DAG plans · {counts.approvedDrafts} signed off
            </p>
          </div>

          <div className="p-5 space-y-1.5 col-span-2 lg:col-span-1">
            <p className="text-xs font-medium text-slate-500">Tool Calls &amp; Self-Healing</p>
            <p className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {counts.toolInvocationsCount}
            </p>
            <p className="text-xs text-slate-500 tabular-nums">
              {counts.healedWorkflows} healed · {counts.failedOrInterventionWorkflows} escalated
            </p>
          </div>
        </section>
      )}

      {/* Charts Row */}
      {metrics && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-baseline justify-between gap-4 mb-5">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Lead Pipeline by Lifecycle Stage
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Exact record count per status in your isolated business workspace
                </p>
              </div>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                n = {metrics.counts.totalLeads}
              </span>
            </div>

            <div className="h-60 w-full min-w-0">
              <ResponsiveContainer width="100%" height={240} minWidth={0}>
                <BarChart
                  data={metrics.pipelineByStatus}
                  margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#475569' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#f1f5f9' }}
                    contentStyle={{
                      fontSize: '12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                  <Bar dataKey="count" name="Leads" radius={[4, 4, 0, 0]} maxBarSize={42}>
                    {metrics.pipelineByStatus.map((entry, idx) => (
                      <Cell
                        key={`cell-${idx}`}
                        fill={
                          entry.status === 'qualified' || entry.status === 'contacted'
                            ? '#1d4ed8'
                            : entry.status === 'disqualified'
                              ? '#94a3b8'
                              : '#0f172a'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-baseline justify-between gap-4 mb-5">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  AI Qualification Score Distribution
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Evaluated leads grouped by Agent A fit score (0–100)
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('workflows')}
                className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Run Workflow
              </button>
            </div>

            <div className="h-60 w-full min-w-0">
              <ResponsiveContainer width="100%" height={240} minWidth={0}>
                <BarChart
                  data={metrics.scoreDistribution}
                  margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="bucket"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#475569' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#f1f5f9' }}
                    contentStyle={{
                      fontSize: '12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                  <Bar
                    dataKey="count"
                    name="Evaluated Leads"
                    fill="#2563eb"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {/* Agent D · Business Insights Executive Section */}
      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Agent D · Business Insights Briefing
            </h2>
            <p className="text-xs text-slate-500">
              Synthesizes persisted lead counts, qualification scores, approval bottlenecks, and
              sample-size confidence labels.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunInsightsAgent}
            disabled={runningInsights}
            className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${runningInsights ? 'animate-spin' : ''}`} />
            <span>
              {runningInsights ? 'Analyzing Database...' : 'Generate Insights Briefing'}
            </span>
          </button>
        </div>

        {insightOutput ? (
          <div className="p-6 space-y-5">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <TrendingUp className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                <span className="font-medium text-slate-700">
                  Confidence: {insightOutput.dataConfidenceLabel || 'Database-verified'}
                </span>
                {metrics?.latestInsightRun?.createdAt && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Generated {new Date(metrics.latestInsightRun.createdAt).toLocaleString()}
                    </span>
                  </>
                )}
              </div>
              <p className="text-sm font-semibold text-slate-900 leading-relaxed">
                {insightOutput.executiveHeadline}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-slate-200 text-xs">
              <div className="space-y-2">
                <h3 className="font-semibold text-slate-900">Verified Findings</h3>
                <ul className="space-y-1.5 text-slate-600 leading-relaxed list-disc pl-4">
                  {(insightOutput.keyFindings || []).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-slate-900">Operational Bottlenecks</h3>
                <ul className="space-y-1.5 text-slate-600 leading-relaxed list-disc pl-4">
                  {(insightOutput.operationalBottlenecks || []).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-slate-900">Recommended Next Actions</h3>
                <ul className="space-y-1.5 text-slate-600 leading-relaxed list-disc pl-4">
                  {(insightOutput.recommendedActions || []).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 text-xs text-slate-500 flex items-center justify-between gap-4">
            <span>
              No AI insights briefing has been generated yet for this workspace. Click "Generate
              Insights Briefing" to analyze your stored SQL records.
            </span>
          </div>
        )}
      </section>

      {/* Recent Activity Stream */}
      {metrics && (
        <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
          <div className="p-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Recent Audit &amp; Agent Activity
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Latest verified actions across leads, workflows, approvals, and self-healing steps
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('logs')}
              className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              View Full Audit Log
            </button>
          </div>

          {metrics.recentLogs.length === 0 ? (
            <div className="p-6 text-xs text-slate-500">No activity recorded yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {metrics.recentLogs.slice(0, 6).map((log) => (
                <div
                  key={log.id}
                  className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {log.severity === 'error' ? (
                      <ShieldAlert className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
                    ) : log.severity === 'warning' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    ) : log.severity === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <span className="font-medium text-slate-900">{log.actorName}</span>
                      <span className="text-slate-400 mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-slate-700">{log.message}</span>
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                    {new Date(log.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
