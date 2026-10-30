import React, { useEffect, useState } from 'react';
import { CheckCircle2, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function SettingsView() {
  const { workspace, apiFetch, refreshWorkspace } = useAuth();
  const business = workspace?.business;
  const membership = workspace?.membership;

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [website, setWebsite] = useState('');
  const [valueProposition, setValueProposition] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderRole, setSenderRole] = useState('');

  const [targetIndustriesText, setTargetIndustriesText] = useState('');
  const [minBudgetUsd, setMinBudgetUsd] = useState(12000);
  const [minCompanySize, setMinCompanySize] = useState(15);
  const [fitThresholdScore, setFitThresholdScore] = useState(70);
  const [autoDraftMinScore, setAutoDraftMinScore] = useState(55);
  const [maxWorkflowRetries, setMaxWorkflowRetries] = useState(2);
  const [toneOfVoice, setToneOfVoice] = useState('');
  const [idealCustomerNotes, setIdealCustomerNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  useEffect(() => {
    if (business) {
      setName(business.name);
      setIndustry(business.industry);
      setWebsite(business.website || '');
      setValueProposition(business.valueProposition);
      setSenderName(business.senderName);
      setSenderRole(business.senderRole);

      const c = business.qualificationCriteria;
      setTargetIndustriesText((c.targetIndustries || []).join(', '));
      setMinBudgetUsd(c.minBudgetUsd ?? 12000);
      setMinCompanySize(c.minCompanySize ?? 15);
      setFitThresholdScore(c.fitThresholdScore ?? 70);
      setAutoDraftMinScore(c.autoDraftMinScore ?? 55);
      setMaxWorkflowRetries(c.maxWorkflowRetries ?? 2);
      setToneOfVoice(c.toneOfVoice || '');
      setIdealCustomerNotes(c.idealCustomerNotes || '');
    }
  }, [business]);

  const isAdmin = membership?.role === 'admin';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedBanner(null);

    try {
      const targetIndustries = targetIndustriesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          name,
          industry,
          website: website || null,
          valueProposition,
          senderName,
          senderRole,
          qualificationCriteria: {
            targetIndustries,
            minBudgetUsd: Number(minBudgetUsd),
            minCompanySize: Number(minCompanySize),
            fitThresholdScore: Number(fitThresholdScore),
            autoDraftMinScore: Number(autoDraftMinScore),
            maxWorkflowRetries: Number(maxWorkflowRetries),
            toneOfVoice,
            idealCustomerNotes,
          },
        }),
      });

      await refreshWorkspace();
      setSavedBanner(
        'Saved business profile, qualification scoring thresholds, and self-healing retry limits.'
      );
    } catch (err: any) {
      setError(err?.message || 'Unable to save workspace settings.');
    } finally {
      setSaving(false);
    }
  };

  if (!business) {
    return <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  return (
    <form onSubmit={handleSave} className="space-y-8 max-w-4xl">
      {/* Workspace Isolation & Role Banner */}
      <div className="p-4 rounded-xl bg-white border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5 text-slate-700">
          <ShieldCheck className="w-4 h-4 text-slate-900 shrink-0" />
          <span>
            Isolated Tenant ID:{' '}
            <code className="font-mono text-slate-900">{business.id}</code> · Server-Verified Role:{' '}
            <strong className="text-slate-900">{membership?.role}</strong>
          </span>
        </div>
        <span className="text-slate-500">
          {isAdmin ? 'Administrator editing enabled' : 'Read-only member access'}
        </span>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      {savedBanner && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{savedBanner}</span>
        </div>
      )}

      {/* Section 1: Business & Outreach Sender Identity */}
      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 text-xs">
        <div className="p-6">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Business Identity &amp; Outreach Sender Profile
          </h2>
          <p className="text-slate-500 mt-0.5">
            Used by Agent B when signing personalized follow-up email drafts.
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Business Name *</label>
              <input
                type="text"
                required
                disabled={!isAdmin}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Primary Industry *</label>
              <input
                type="text"
                required
                disabled={!isAdmin}
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Outreach Sender Name *</label>
              <input
                type="text"
                required
                disabled={!isAdmin}
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Outreach Sender Role *</label>
              <input
                type="text"
                required
                disabled={!isAdmin}
                value={senderRole}
                onChange={(e) => setSenderRole(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Business Website</label>
            <input
              type="text"
              disabled={!isAdmin}
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Core Value Proposition *
            </label>
            <textarea
              rows={3}
              required
              disabled={!isAdmin}
              value={valueProposition}
              onChange={(e) => setValueProposition(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
            />
          </div>
        </div>
      </section>

      {/* Section 2: Agent A Qualification & Agent C Self-Healing Thresholds */}
      <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 text-xs">
        <div className="p-6">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Qualification Criteria &amp; Self-Healing Limits
          </h2>
          <p className="text-slate-500 mt-0.5">
            Configures how Agent A scores incoming leads and how Agent C bounds automated retries.
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Target Industries (comma-separated)
            </label>
            <input
              type="text"
              disabled={!isAdmin}
              value={targetIndustriesText}
              onChange={(e) => setTargetIndustriesText(e.target.value)}
              placeholder="SaaS, FinTech, Healthcare, Logistics..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Target Min Budget (USD)
              </label>
              <input
                type="number"
                min={0}
                disabled={!isAdmin}
                value={minBudgetUsd}
                onChange={(e) => setMinBudgetUsd(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Target Min Headcount
              </label>
              <input
                type="number"
                min={1}
                disabled={!isAdmin}
                value={minCompanySize}
                onChange={(e) => setMinCompanySize(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Qualified Threshold (0–95)
              </label>
              <input
                type="number"
                min={10}
                max={95}
                disabled={!isAdmin}
                value={fitThresholdScore}
                onChange={(e) => setFitThresholdScore(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Minimum Score to Auto-Draft Outreach (0–95)
              </label>
              <input
                type="number"
                min={0}
                max={95}
                disabled={!isAdmin}
                value={autoDraftMinScore}
                onChange={(e) => setAutoDraftMinScore(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Max Self-Healing Workflow Retries (0–5)
              </label>
              <input
                type="number"
                min={0}
                max={5}
                disabled={!isAdmin}
                value={maxWorkflowRetries}
                onChange={(e) => setMaxWorkflowRetries(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">Outreach Tone of Voice</label>
            <input
              type="text"
              disabled={!isAdmin}
              value={toneOfVoice}
              onChange={(e) => setToneOfVoice(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Ideal Customer Profile Guidance
            </label>
            <textarea
              rows={3}
              disabled={!isAdmin}
              value={idealCustomerNotes}
              onChange={(e) => setIdealCustomerNotes(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
            />
          </div>
        </div>

        {isAdmin && (
          <div className="px-6 py-4 bg-slate-50/70 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving Preferences...' : 'Save Settings'}</span>
            </button>
          </div>
        )}
      </section>
    </form>
  );
}
