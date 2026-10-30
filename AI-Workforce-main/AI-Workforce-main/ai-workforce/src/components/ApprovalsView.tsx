import React, { useCallback, useEffect, useState } from 'react';
import { Check, Info, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApprovalItemRecord } from '../types';

export function ApprovalsView() {
  const { apiFetch } = useAuth();
  const [approvals, setApprovals] = useState<ApprovalItemRecord[]>([]);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [editedSubject, setEditedSubject] = useState('');
  const [editedBody, setEditedBody] = useState('');
  const [decisionNotes, setDecisionNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ approvals: ApprovalItemRecord[] }>('/api/approvals');
      setApprovals(res.approvals);
    } catch (err: any) {
      setError(err?.message || 'Unable to load Approval Center.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const filteredItems = approvals.filter((item) =>
    filter === 'all' ? true : item.status === filter
  );

  const activeItem =
    filteredItems.find((a) => a.id === selectedId) || filteredItems[0] || null;

  useEffect(() => {
    if (activeItem) {
      setSelectedId(activeItem.id);
      setEditedSubject(activeItem.draft?.subject || '');
      setEditedBody(activeItem.draft?.body || '');
      setDecisionNotes(activeItem.decisionNotes || '');
    }
  }, [activeItem?.id]);

  const handleDecision = async (decision: 'approved' | 'rejected') => {
    if (!activeItem) return;
    setSubmitting(true);
    setError(null);
    setBanner(null);

    try {
      await apiFetch(`/api/approvals/${activeItem.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          editedSubject,
          editedBody,
          decisionNotes,
        }),
      });
      setBanner(
        decision === 'approved'
          ? 'Supervisor sign-off recorded. Paused DAG checkpoint released, webhook outbox event logged, and simulated safe delivery saved.'
          : 'Checkpoint rejected and logged. Held action was cancelled with zero external side effects.'
      );
      await loadApprovals();
    } catch (err: any) {
      setError(err?.message || 'Unable to submit review decision.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Supervisor Checkpoint & Safe Delivery Disclosure */}
      <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-700 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-slate-800 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-slate-900">
            Supervisor Checkpoint &amp; Human-in-the-Loop Webhook Gate:{' '}
          </span>
          <span>
            High-risk actions (external prospect emails and consequential CRM repairs) pause here
            automatically. One-click sign-off persists your edits, completes any waiting DAG task,
            and records an HMAC-verified dispatch in the Connected Tools &amp; Webhook Outbox.
          </span>
        </div>
      </div>

      {/* Filter Segmented Control */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {(
          [
            ['pending', `Pending (${approvals.filter((a) => a.status === 'pending').length})`],
            ['approved', `Approved (${approvals.filter((a) => a.status === 'approved').length})`],
            ['rejected', `Rejected (${approvals.filter((a) => a.status === 'rejected').length})`],
            ['all', `All (${approvals.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              filter === key
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          {error}
        </div>
      )}

      {banner && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
          {banner}
        </div>
      )}

      {loading ? (
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : filteredItems.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <h3 className="font-display text-base font-semibold text-slate-900">
            No items in "{filter}" view
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Run a coordinated workflow or trigger Agent B Outreach on a lead to generate
            personalized drafts for human review.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Queue List */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
            {filteredItems.map((item) => {
              const isSelected = activeItem?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left p-4 space-y-1 transition-colors cursor-pointer ${
                    isSelected ? 'bg-slate-100/90' : 'hover:bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-900 truncate">
                      {item.leadFirstName} {item.leadLastName}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                      {item.leadScore !== null ? `${item.leadScore}/100` : 'Unscored'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 truncate">
                    {item.leadCompany} · {item.leadIsDemo ? 'Demo Record' : 'Customer Record'}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate pt-0.5">
                    {item.approvalType === 'outreach_email'
                      ? item.draft?.subject || 'Outreach Email Draft'
                      : 'Consequential Data Repair Proposal'}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Review & Edit Workspace */}
          {activeItem && (
            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
              <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    {activeItem.leadFirstName} {activeItem.leadLastName} — {activeItem.leadCompany}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 font-mono">
                    Recipient: {activeItem.leadEmail} · Status: {activeItem.status}
                  </p>
                </div>
                <span className="text-xs text-slate-600 font-medium">
                  {activeItem.approvalType === 'outreach_email'
                    ? 'Outreach Email Review'
                    : 'Self-Healing Consequential Change'}
                </span>
              </div>

              {activeItem.approvalType === 'outreach_email' && activeItem.draft ? (
                <div className="p-6 space-y-5 text-xs">
                  {/* Rationale & Verified Facts */}
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                    <div>
                      <span className="font-semibold text-slate-900">
                        Personalization Rationale:{' '}
                      </span>
                      <span className="text-slate-700">
                        {activeItem.draft.personalizationRationale}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900">Suggested Next Step: </span>
                      <span className="text-slate-700">{activeItem.draft.suggestedNextStep}</span>
                    </div>
                    {activeItem.draft.verifiedFactsUsed &&
                      activeItem.draft.verifiedFactsUsed.length > 0 && (
                        <div>
                          <span className="font-semibold text-slate-900">
                            Verified CRM Facts Referenced:{' '}
                          </span>
                          <span className="text-slate-600">
                            {activeItem.draft.verifiedFactsUsed.join(' · ')}
                          </span>
                        </div>
                      )}
                  </div>

                  {/* Editable Subject & Body */}
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1.5">
                      Email Subject Line
                    </label>
                    <input
                      type="text"
                      value={editedSubject}
                      disabled={activeItem.status !== 'pending'}
                      onChange={(e) => setEditedSubject(e.target.value)}
                      className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-800 mb-1.5">
                      Email Message Body
                    </label>
                    <textarea
                      rows={9}
                      value={editedBody}
                      disabled={activeItem.status !== 'pending'}
                      onChange={(e) => setEditedBody(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-slate-900 leading-relaxed focus:outline-none focus:border-blue-600 disabled:bg-slate-50"
                    />
                  </div>

                  {activeItem.draft.deliveryNote && (
                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 flex items-center gap-2">
                      <Info className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>{activeItem.draft.deliveryNote}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 space-y-4 text-xs">
                  <p className="text-slate-700">
                    The Self-Healing Engine paused a workflow because the proposed data repair is
                    consequential and requires explicit human approval:
                  </p>
                  <pre className="font-mono text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-4 overflow-x-auto text-slate-800">
                    {JSON.stringify(activeItem.proposedChanges, null, 2)}
                  </pre>
                </div>
              )}

              {/* Decision Controls */}
              <div className="p-6 bg-slate-50/60 space-y-4 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Reviewer Audit Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={decisionNotes}
                    disabled={activeItem.status !== 'pending'}
                    onChange={(e) => setDecisionNotes(e.target.value)}
                    placeholder="Reason for approval, edit note, or rejection feedback..."
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600 disabled:bg-slate-100"
                  />
                </div>

                {activeItem.status === 'pending' ? (
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleDecision('rejected')}
                      className="px-4 py-2 text-xs font-medium bg-white border border-slate-300 text-slate-800 rounded-lg hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject Draft</span>
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleDecision('approved')}
                      className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>
                        {submitting
                          ? 'Recording Decision...'
                          : activeItem.approvalType === 'outreach_email'
                            ? 'Approve & Simulate Safe Delivery'
                            : 'Approve Proposed Repair'}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="text-slate-600 font-mono tabular-nums">
                    Finalized as <strong className="text-slate-900">{activeItem.status}</strong>
                    {activeItem.decidedAt
                      ? ` on ${new Date(activeItem.decidedAt).toLocaleString()}`
                      : ''}
                    .
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
