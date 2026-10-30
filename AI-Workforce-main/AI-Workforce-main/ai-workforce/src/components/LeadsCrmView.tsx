import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LeadRecord, LeadStatus } from '../types';

interface LeadsCrmViewProps {
  onSelectLead: (leadId: string) => void;
  onNavigate: (page: string) => void;
}

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  qualifying: 'Qualifying',
  qualified: 'Qualified',
  nurture: 'Nurture',
  disqualified: 'Disqualified',
  outreach_pending: 'Draft Pending',
  contacted: 'Contacted',
  converted: 'Converted',
};

const PAGE_SIZE = 8;

interface LeadFormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  companyName: string;
  companyWebsite: string;
  industry: string;
  companySize: string;
  estimatedBudgetUsd: string;
  source: string;
  painPoints: string;
  notes: string;
}

const EMPTY_FORM: LeadFormState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  jobTitle: '',
  companyName: '',
  companyWebsite: '',
  industry: '',
  companySize: '',
  estimatedBudgetUsd: '',
  source: 'Inbound Web',
  painPoints: '',
  notes: '',
};

export function LeadsCrmView({ onSelectLead, onNavigate }: LeadsCrmViewProps) {
  const { apiFetch } = useAuth();
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LeadStatus>('all');
  const [originFilter, setOriginFilter] = useState<'all' | 'customer' | 'demo'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'score_desc' | 'budget_desc' | 'company_asc'>(
    'newest'
  );
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<LeadRecord | null>(null);
  const [form, setForm] = useState<LeadFormState>(EMPTY_FORM);
  const [savingForm, setSavingForm] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const [importingDemo, setImportingDemo] = useState(false);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ leads: LeadRecord[] }>('/api/leads');
      setLeads(res.leads);
    } catch (err: any) {
      setError(err?.message || 'Unable to load leads.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = leads.filter((lead) => {
      if (statusFilter !== 'all' && lead.status !== statusFilter) return false;
      if (originFilter === 'customer' && lead.isDemo) return false;
      if (originFilter === 'demo' && !lead.isDemo) return false;
      if (!q) return true;
      return (
        `${lead.firstName} ${lead.lastName}`.toLowerCase().includes(q) ||
        lead.companyName.toLowerCase().includes(q) ||
        lead.email.toLowerCase().includes(q) ||
        (lead.industry || '').toLowerCase().includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'score_desc') {
        return (b.qualificationScore ?? -1) - (a.qualificationScore ?? -1);
      }
      if (sortBy === 'budget_desc') {
        return (b.estimatedBudgetUsd ?? -1) - (a.estimatedBudgetUsd ?? -1);
      }
      if (sortBy === 'company_asc') {
        return a.companyName.localeCompare(b.companyName);
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [leads, searchQuery, statusFilter, originFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedLeads = filteredAndSorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const openCreateModal = () => {
    setEditingLead(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEditModal = (lead: LeadRecord) => {
    setEditingLead(lead);
    setForm({
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone || '',
      jobTitle: lead.jobTitle || '',
      companyName: lead.companyName,
      companyWebsite: lead.companyWebsite || '',
      industry: lead.industry || '',
      companySize: lead.companySize !== null ? String(lead.companySize) : '',
      estimatedBudgetUsd: lead.estimatedBudgetUsd !== null ? String(lead.estimatedBudgetUsd) : '',
      source: lead.source || 'Inbound Web',
      painPoints: lead.painPoints || '',
      notes: lead.notes || '',
    });
    setModalOpen(true);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingForm(true);
    setError(null);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        jobTitle: form.jobTitle.trim() || null,
        companyName: form.companyName.trim(),
        companyWebsite: form.companyWebsite.trim() || null,
        industry: form.industry.trim() || null,
        companySize: form.companySize.trim() ? Number(form.companySize) : null,
        estimatedBudgetUsd: form.estimatedBudgetUsd.trim()
          ? Number(form.estimatedBudgetUsd)
          : null,
        source: form.source.trim() || 'Manual Entry',
        painPoints: form.painPoints.trim() || null,
        notes: form.notes.trim() || null,
      };

      if (editingLead) {
        await apiFetch(`/api/leads/${editingLead.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setNotice(`Updated ${payload.firstName} ${payload.lastName} (${payload.companyName}).`);
      } else {
        await apiFetch('/api/leads', {
          method: 'POST',
          body: JSON.stringify({ ...payload, isDemo: false }),
        });
        setNotice(`Created customer lead ${payload.firstName} ${payload.lastName}.`);
      }
      setModalOpen(false);
      await loadLeads();
    } catch (err: any) {
      setError(err?.message || 'Unable to save lead.');
    } finally {
      setSavingForm(false);
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    setBusyLeadId(leadId);
    setError(null);
    try {
      await apiFetch(`/api/leads/${leadId}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      setNotice('Lead deleted from workspace.');
      await loadLeads();
    } catch (err: any) {
      setError(err?.message || 'Unable to delete lead.');
    } finally {
      setBusyLeadId(null);
    }
  };

  const handleQuickQualify = async (lead: LeadRecord) => {
    setBusyLeadId(lead.id);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ score: number; disposition: string }>(
        `/api/agents/qualify/${lead.id}`,
        { method: 'POST' }
      );
      setNotice(
        `Agent A scored ${lead.firstName} ${lead.lastName} at ${res.score}/100 (${res.disposition}).`
      );
      await loadLeads();
    } catch (err: any) {
      setError(err?.message || 'Qualification agent failed.');
    } finally {
      setBusyLeadId(null);
    }
  };

  const handleRunWorkflow = async (lead: LeadRecord) => {
    setBusyLeadId(lead.id);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ workflowRun: { status: string; outcome: string | null } }>(
        '/api/workflows/execute',
        {
          method: 'POST',
          body: JSON.stringify({ leadId: lead.id }),
        }
      );
      setNotice(
        res.workflowRun.outcome ||
          `Workflow completed with status: ${res.workflowRun.status}. Check Approval Center to review drafts.`
      );
      await loadLeads();
    } catch (err: any) {
      setError(err?.message || 'Workflow execution failed.');
    } finally {
      setBusyLeadId(null);
    }
  };

  const handleImportDemo = async () => {
    setImportingDemo(true);
    setError(null);
    try {
      const res = await apiFetch<{ importedCount: number }>('/api/leads/import-demo', {
        method: 'POST',
      });
      setNotice(
        res.importedCount > 0
          ? `Imported ${res.importedCount} sample demo leads (marked "Demo Record").`
          : 'Sample demo leads are already present in this workspace.'
      );
      await loadLeads();
    } catch (err: any) {
      setError(err?.message || 'Unable to import demo leads.');
    } finally {
      setImportingDemo(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, company, industry..."
              aria-label="Search leads"
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
            />
          </div>

          {/* Interactive Record Origin Segmented Control */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['all', 'All Records'],
                ['customer', 'Customer Data'],
                ['demo', 'Demo Sample'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setOriginFilter(key);
                  setPage(1);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  originFilter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            aria-label="Sort leads"
            className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-700 focus:outline-none focus:border-blue-600"
          >
            <option value="newest">Sort: Newest Added</option>
            <option value="score_desc">Sort: Highest Qualification Score</option>
            <option value="budget_desc">Sort: Highest Budget</option>
            <option value="company_asc">Sort: Company A–Z</option>
          </select>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleImportDemo}
            disabled={importingDemo}
            className="px-3.5 py-2 text-xs font-medium bg-white text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{importingDemo ? 'Importing...' : 'Import Sample Leads'}</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Lead</span>
          </button>
        </div>
      </div>

      {/* Interactive Status Filter Bar */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto w-fit max-w-full">
        {(
          [
            ['all', 'All Stages'],
            ['new', 'New'],
            ['qualified', 'Qualified'],
            ['nurture', 'Nurture'],
            ['outreach_pending', 'Draft Pending'],
            ['contacted', 'Contacted'],
            ['disqualified', 'Disqualified'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setStatusFilter(key);
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              statusFilter === key
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

      {notice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-4">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => onNavigate('approvals')}
            className="font-medium underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Open Approval Center
          </button>
        </div>
      )}

      {/* High-Density Data Grid */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : paginatedLeads.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <h3 className="font-display text-base font-semibold text-slate-900">
              No leads match the current view
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Add a new B2B prospect manually or import the 5 sample demo leads to evaluate AI
              qualification scoring and outreach drafting.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={openCreateModal}
                className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Add First Lead
              </button>
              <button
                type="button"
                onClick={handleImportDemo}
                className="px-4 py-2 text-xs font-medium bg-white text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Import Sample Leads
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-600">
                  <th className="py-3 px-4">Prospect &amp; Origin</th>
                  <th className="py-3 px-4">Company &amp; Industry</th>
                  <th className="py-3 px-4">Stage</th>
                  <th className="py-3 px-4 text-right">Fit Score</th>
                  <th className="py-3 px-4 text-right">Est. Budget</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {paginatedLeads.map((lead) => {
                  const isBusy = busyLeadId === lead.id;
                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-slate-50/80 transition-colors group"
                    >
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => onSelectLead(lead.id)}
                          className="font-semibold text-slate-900 hover:text-blue-700 text-left block cursor-pointer"
                        >
                          {lead.firstName} {lead.lastName}
                        </button>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <span className="truncate max-w-[180px]">{lead.email}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              lead.isDemo
                                ? 'text-amber-700 font-medium'
                                : 'text-slate-600'
                            }
                          >
                            {lead.isDemo ? 'Demo Record' : 'Customer Record'}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{lead.companyName}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {lead.industry || 'Industry unverified'}
                          {lead.companySize ? ` · ${lead.companySize} emp` : ''}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`font-medium ${
                            lead.status === 'qualified' || lead.status === 'contacted'
                              ? 'text-emerald-700'
                              : lead.status === 'outreach_pending'
                                ? 'text-blue-700'
                                : lead.status === 'disqualified'
                                  ? 'text-slate-500'
                                  : 'text-slate-800'
                          }`}
                        >
                          {STATUS_LABELS[lead.status] || lead.status}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {typeof lead.qualificationScore === 'number' ? (
                          <span
                            className={`font-semibold ${
                              lead.qualificationScore >= 70
                                ? 'text-emerald-700'
                                : lead.qualificationScore >= 45
                                  ? 'text-amber-700'
                                  : 'text-slate-600'
                            }`}
                          >
                            {lead.qualificationScore}/100
                          </span>
                        ) : (
                          <span className="text-slate-400">Unscored</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                        {typeof lead.estimatedBudgetUsd === 'number'
                          ? `$${lead.estimatedBudgetUsd.toLocaleString()}`
                          : 'Missing'}
                      </td>

                      <td className="py-3 px-4 text-right">
                        {confirmDeleteId === lead.id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleDeleteLead(lead.id)}
                              disabled={isBusy}
                              className="px-2.5 py-1 text-[11px] font-medium bg-red-600 text-white rounded hover:bg-red-700 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Confirm Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 text-[11px] text-slate-600 hover:text-slate-900 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => onSelectLead(lead.id)}
                              title="View lead details"
                              className="px-2 py-1 text-[11px] font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Details</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickQualify(lead)}
                              disabled={isBusy}
                              title="Run Agent A Qualification"
                              className="px-2 py-1 text-[11px] font-medium text-slate-700 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>{isBusy ? 'Running...' : 'Score'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRunWorkflow(lead)}
                              disabled={isBusy}
                              title="Run Coordinated Workflow (Qualify + Draft Outreach)"
                              className="px-2.5 py-1 text-[11px] font-medium bg-slate-900 text-white hover:bg-slate-800 rounded transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                            >
                              <Play className="w-3 h-3" />
                              <span>Workflow</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(lead)}
                              aria-label={`Edit ${lead.firstName} ${lead.lastName}`}
                              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(lead.id)}
                              aria-label={`Delete ${lead.firstName} ${lead.lastName}`}
                              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {filteredAndSorted.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-between text-xs text-slate-600">
            <span className="font-mono tabular-nums">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, filteredAndSorted.length)} of{' '}
              {filteredAndSorted.length} leads
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="font-mono tabular-nums px-2">
                Page {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                aria-label="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Lead Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="lead-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/45 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 space-y-5 shadow-lg my-8">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <h2 id="lead-modal-title" className="font-display text-lg font-semibold text-slate-900">
                {editingLead ? 'Edit Lead Record' : 'Create Customer Lead'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">First name *</label>
                  <input
                    type="text"
                    required
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Last name *</label>
                  <input
                    type="text"
                    required
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Work email *</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="Optional (flagged if missing)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Company name *</label>
                  <input
                    type="text"
                    required
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Job title</label>
                  <input
                    type="text"
                    value={form.jobTitle}
                    onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                    placeholder="e.g. VP of Operations"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Industry</label>
                  <input
                    type="text"
                    value={form.industry}
                    onChange={(e) => setForm({ ...form, industry: e.target.value })}
                    placeholder="e.g. SaaS, FinTech, Logistics"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Company website</label>
                  <input
                    type="text"
                    value={form.companyWebsite}
                    onChange={(e) => setForm({ ...form, companyWebsite: e.target.value })}
                    placeholder="https://company.com"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Company size (employees)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.companySize}
                    onChange={(e) => setForm({ ...form, companySize: e.target.value })}
                    placeholder="Leave blank if unknown"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Estimated annual budget (USD)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.estimatedBudgetUsd}
                    onChange={(e) => setForm({ ...form, estimatedBudgetUsd: e.target.value })}
                    placeholder="Leave blank if unverified"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Stated Pain Points / Requirements
                </label>
                <textarea
                  rows={2}
                  value={form.painPoints}
                  onChange={(e) => setForm({ ...form, painPoints: e.target.value })}
                  placeholder="Describe verified challenges shared by the prospect..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">CRM Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Call context, referral source, or timeline notes..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingForm}
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {savingForm ? 'Saving...' : editingLead ? 'Save Changes' : 'Create Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
