import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckSquare,
  Download,
  GitBranch,
  GitMerge,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Settings,
  Users,
  Webhook,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { downloadWindowsDesktopApp } from './lib/https';
import { AuthScreen } from './components/AuthScreen';
import { DashboardView } from './components/DashboardView';
import { MissionPlannerView } from './components/MissionPlannerView';
import { LeadsCrmView } from './components/LeadsCrmView';
import { LeadDetailView } from './components/LeadDetailView';
import { AgentsView } from './components/AgentsView';
import { WorkflowsView } from './components/WorkflowsView';
import { ApprovalsView } from './components/ApprovalsView';
import { ToolsRelayView } from './components/ToolsRelayView';
import { ActivityLogsView } from './components/ActivityLogsView';
import { SettingsView } from './components/SettingsView';

type ActivePage =
  | 'dashboard'
  | 'mission_planner'
  | 'leads'
  | 'lead_detail'
  | 'agents'
  | 'workflows'
  | 'approvals'
  | 'tools_relay'
  | 'logs'
  | 'settings';

const NAV_ITEMS: Array<{
  key: ActivePage;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'mission_planner', label: 'Mission Planner (DAG)', icon: GitMerge },
  { key: 'leads', label: 'Leads CRM', icon: Users },
  { key: 'agents', label: 'AI Workforce', icon: Bot },
  { key: 'workflows', label: 'Lead Workflows', icon: GitBranch },
  { key: 'approvals', label: 'Approval Checkpoint', icon: CheckSquare },
  { key: 'tools_relay', label: 'Connected Tools', icon: Webhook },
  { key: 'logs', label: 'Activity Logs', icon: Activity },
  { key: 'settings', label: 'Settings', icon: Settings },
];

const PAGE_TITLES: Record<ActivePage, string> = {
  dashboard: 'Executive Dashboard',
  mission_planner: 'Orchestrator · Directive & Multi-Agent DAG Planner',
  leads: 'Leads CRM',
  lead_detail: 'Lead Profile & Qualification',
  agents: 'AI Workforce Roster',
  workflows: 'Lead Workflow Execution & Self-Healing',
  approvals: 'Supervisor Checkpoint & Approval Center',
  tools_relay: 'Connected Business Tools & Webhook Outbox',
  logs: 'Activity & Error Logs',
  settings: 'Workspace Settings',
};

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class WorkspaceErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected UI error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Workspace view render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white border border-red-200 rounded-xl p-8 max-w-lg mx-auto my-8 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="font-display text-base font-semibold text-slate-900">
                View interrupted
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">{this.state.message}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                this.props.onReset();
              }}
              className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function WorkspaceShell() {
  const {
    loading,
    workspaceLoading,
    isAuthenticated,
    workspace,
    authError,
    refreshWorkspace,
    signOut,
  } = useAuth();
  const [activePage, setActivePage] = useState<ActivePage>('dashboard');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [pendingDirective, setPendingDirective] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [downloadingExe, setDownloadingExe] = useState(false);

  const handleDownloadExe = async () => {
    setDownloadingExe(true);
    try {
      await downloadWindowsDesktopApp();
    } finally {
      setDownloadingExe(false);
    }
  };

  if (loading || (isAuthenticated && workspaceLoading && !workspace)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-sm w-full space-y-3 text-center">
          <div className="h-5 w-36 bg-slate-200 rounded mx-auto animate-pulse" />
          <p className="text-xs text-slate-500">Loading your isolated business workspace...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated && !workspace) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full space-y-4">
          <div className="space-y-1.5">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Connect to Workspace
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              {authError ||
                'Your account is signed in, but the workspace connection was interrupted. Retry or return to sign in.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={refreshWorkspace}
              className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Workspace</span>
            </button>
            <button
              type="button"
              onClick={signOut}
              className="px-4 py-2 text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !workspace) {
    return <AuthScreen />;
  }

  const handleNavigate = (page: string, leadId?: string) => {
    if (leadId) {
      setSelectedLeadId(leadId);
      setActivePage('lead_detail');
    } else {
      setActivePage(page as ActivePage);
    }
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar (256px) */}
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-white border-r border-slate-200 justify-between">
        <div className="p-5 space-y-6">
          <div className="px-2">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 block">
              AI Workforce
            </span>
            <span className="text-xs text-slate-500 truncate block mt-0.5">
              {workspace.business.name}
            </span>
          </div>

          <nav aria-label="Workspace Navigation" className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isCurrent =
                activePage === item.key ||
                (activePage === 'lead_detail' && item.key === 'leads');
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleNavigate(item.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isCurrent
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-200 space-y-2 text-xs">
          <div className="px-2 pb-1">
            <p className="font-medium text-slate-900 truncate">{workspace.profile.fullName}</p>
            <p className="text-[11px] text-slate-500 truncate">
              {workspace.profile.email} · {workspace.membership.role}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadExe}
            disabled={downloadingExe}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>{downloadingExe ? 'Preparing .exe...' : 'Download Windows (.exe)'}</span>
          </button>
          <button
            type="button"
            onClick={signOut}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-64 bg-white h-full border-r border-slate-200 p-5 flex flex-col justify-between">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="font-display text-base font-bold text-slate-900">
                  AI Workforce
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close navigation menu"
                  className="p-1 text-slate-500 hover:text-slate-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isCurrent =
                    activePage === item.key ||
                    (activePage === 'lead_detail' && item.key === 'leads');
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleNavigate(item.key)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-medium rounded-lg ${
                        isCurrent
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            <button
              type="button"
              onClick={signOut}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* SaaS Contextual Top Bar Contract: Breadcrumb on Left, Primary Action on Right */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-6 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-lg"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
              <span className="font-medium text-slate-700 truncate max-w-[180px]">
                {workspace.business.name}
              </span>
              <span aria-hidden="true">/</span>
              <h1 className="font-display text-sm font-semibold text-slate-900 truncate">
                {PAGE_TITLES[activePage]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => handleNavigate('mission_planner')}
              className="px-3.5 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              New Business Directive
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <WorkspaceErrorBoundary onReset={() => setActivePage('dashboard')}>
            {activePage === 'dashboard' && (
              <DashboardView
                onNavigate={handleNavigate}
                onLaunchDirective={(prompt) => {
                  setPendingDirective(prompt);
                  setActivePage('mission_planner');
                }}
              />
            )}
            {activePage === 'mission_planner' && (
              <MissionPlannerView
                onNavigate={handleNavigate}
                initialDirective={pendingDirective}
                onConsumeInitialDirective={() => setPendingDirective(null)}
              />
            )}
            {activePage === 'leads' && (
              <LeadsCrmView
                onSelectLead={(id) => handleNavigate('lead_detail', id)}
                onNavigate={handleNavigate}
              />
            )}
            {activePage === 'lead_detail' && selectedLeadId && (
              <LeadDetailView
                leadId={selectedLeadId}
                onBack={() => handleNavigate('leads')}
                onNavigate={handleNavigate}
              />
            )}
            {activePage === 'agents' && <AgentsView onNavigate={handleNavigate} />}
            {activePage === 'workflows' && <WorkflowsView onNavigate={handleNavigate} />}
            {activePage === 'approvals' && <ApprovalsView />}
            {activePage === 'tools_relay' && <ToolsRelayView onNavigate={handleNavigate} />}
            {activePage === 'logs' && <ActivityLogsView />}
            {activePage === 'settings' && <SettingsView />}
          </WorkspaceErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceShell />
    </AuthProvider>
  );
}
