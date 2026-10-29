export interface QualificationCriteria {
  targetIndustries: string[];
  minBudgetUsd: number;
  minCompanySize: number;
  fitThresholdScore: number;
  autoDraftMinScore: number;
  maxWorkflowRetries: number;
  idealCustomerNotes: string;
  toneOfVoice: string;
}

export interface QualificationBreakdown {
  industryFitScore: number;
  budgetFitScore: number;
  companyScaleScore: number;
  dataCompletenessScore: number;
  strengths: string[];
  concerns: string[];
  missingInformation: string[];
  recommendedDisposition: 'qualified' | 'nurture' | 'disqualified';
}

export interface DagPlanNode {
  stepKey: string;
  stepOrder: number;
  title: string;
  description: string;
  agentKey:
    | 'orchestrator_planner'
    | 'crm_updater'
    | 'lead_research'
    | 'sheets_webhook_sync'
    | 'sales_outreach'
    | 'business_insights'
    | 'workflow_coordinator';
  toolName: string;
  dependsOn: string[];
  riskLevel: 'low' | 'medium' | 'high_checkpoint';
}

export interface ProfileRecord {
  id: string;
  uid: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface BusinessRecord {
  id: string;
  name: string;
  industry: string;
  website: string | null;
  valueProposition: string;
  senderName: string;
  senderRole: string;
  qualificationCriteria: QualificationCriteria;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipRecord {
  id: string;
  businessId: string;
  profileId: string;
  role: 'admin' | 'reviewer' | 'member';
  createdAt: string;
}

export type LeadStatus =
  | 'new'
  | 'qualifying'
  | 'qualified'
  | 'nurture'
  | 'disqualified'
  | 'outreach_pending'
  | 'contacted'
  | 'converted';

export type FaultMode =
  | 'none'
  | 'transient_network'
  | 'rate_limit'
  | 'malformed_email'
  | 'consequential_correction'
  | 'permission_denied';

export interface LeadRecord {
  id: string;
  businessId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  companyName: string;
  companyWebsite: string | null;
  industry: string | null;
  companySize: number | null;
  estimatedBudgetUsd: number | null;
  source: string;
  notes: string | null;
  painPoints: string | null;
  status: LeadStatus;
  qualificationScore: number | null;
  qualificationSummary: string | null;
  qualificationBreakdown: QualificationBreakdown | null;
  isDemo: boolean;
  simulatedFaultMode: FaultMode | string | null;
  lastEvaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepRecord {
  id: string;
  workflowRunId: string;
  businessId: string;
  stepOrder: number;
  stepKey: string;
  stepName: string;
  agentKey: string;
  toolName?: string | null;
  dependsOn?: string[] | null;
  riskLevel?: 'low' | 'medium' | 'high_checkpoint' | string | null;
  status:
    | 'pending'
    | 'running'
    | 'retrying'
    | 'healed'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'requires_approval';
  attemptCount: number;
  errorCategory: string | null;
  errorMessage: string | null;
  healingAction: string | null;
  inputPayload: Record<string, unknown> | null;
  outputPayload: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface WorkflowRunRecord {
  id: string;
  businessId: string;
  leadId: string | null;
  triggeredByProfileId: string | null;
  idempotencyKey: string;
  workflowType: string;
  directivePrompt?: string | null;
  dagPlan?: DagPlanNode[] | null;
  status:
    | 'queued'
    | 'running'
    | 'recovering'
    | 'awaiting_approval'
    | 'completed'
    | 'needs_human_intervention'
    | 'failed';
  currentStep: string | null;
  retryCount: number;
  maxRetries: number;
  errorCategory: string | null;
  errorMessage: string | null;
  recoverySummary: string | null;
  outcome: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  leadName?: string;
  leadCompany?: string;
  steps?: WorkflowStepRecord[];
}

export interface AgentRunRecord {
  id: string;
  businessId: string;
  workflowRunId: string | null;
  leadId: string | null;
  agentKey:
    | 'orchestrator_planner'
    | 'crm_updater'
    | 'lead_research'
    | 'sheets_webhook_sync'
    | 'sales_outreach'
    | 'workflow_coordinator'
    | 'business_insights'
    | string;
  agentName: string;
  modelUsed: string;
  status: 'running' | 'completed' | 'failed';
  durationMs: number | null;
  summary: string | null;
  structuredOutput: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface OutreachDraftRecord {
  id: string;
  businessId: string;
  leadId: string;
  workflowRunId: string | null;
  agentRunId: string | null;
  subject: string;
  body: string;
  personalizationRationale: string;
  suggestedNextStep: string;
  verifiedFactsUsed: string[] | null;
  status: 'pending_approval' | 'approved' | 'rejected' | 'simulated_sent';
  deliveryMode: string;
  deliveryNote: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalItemRecord {
  id: string;
  businessId: string;
  outreachDraftId: string | null;
  workflowRunId: string | null;
  leadId: string;
  approvalType: 'outreach_email' | 'data_correction';
  status: 'pending' | 'approved' | 'rejected';
  proposedChanges: Record<string, unknown> | null;
  reviewerProfileId: string | null;
  decisionNotes: string | null;
  decidedAt: string | null;
  createdAt: string;
  leadFirstName: string;
  leadLastName: string;
  leadEmail: string;
  leadCompany: string;
  leadScore: number | null;
  leadIsDemo: boolean;
  draft: OutreachDraftRecord | null;
}

export interface ToolInvocationRecord {
  id: string;
  businessId: string;
  workflowRunId: string | null;
  workflowStepId: string | null;
  leadId: string | null;
  agentName: string;
  connectorKey:
    | 'postgres_crm'
    | 'google_sheets_sync'
    | 'airtable_pipeline'
    | 'email_dispatcher'
    | 'webhook_outbox'
    | string;
  toolName: string;
  httpMethod: string;
  endpointPath: string;
  status: 'completed' | 'held_for_approval' | 'dispatched_after_approval' | 'failed' | string;
  durationMs: number;
  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityLogRecord {
  id: string;
  businessId: string;
  actorProfileId: string | null;
  actorType: 'user' | 'agent' | 'system' | 'self_healing';
  actorName: string;
  eventType: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  entityType: string | null;
  entityId: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface DashboardMetrics {
  counts: {
    totalLeads: number;
    realLeads: number;
    demoLeads: number;
    qualifiedLeads: number;
    nurtureLeads: number;
    disqualifiedLeads: number;
    contactedOrConvertedLeads: number;
    pendingApprovals: number;
    completedWorkflows: number;
    healedWorkflows: number;
    failedOrInterventionWorkflows: number;
    approvedDrafts: number;
    rejectedDrafts: number;
    toolInvocationsCount: number;
    directiveRunsCount: number;
  };
  rates: {
    qualificationRatePct: number | null;
    approvalConversionPct: number | null;
    averageQualificationScore: number | null;
    insufficientDataNotice: string | null;
  };
  pipelineByStatus: Array<{ status: string; label: string; count: number }>;
  scoreDistribution: Array<{ bucket: string; count: number }>;
  agentSummary: Array<{
    agentKey: string;
    agentName: string;
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    avgDurationMs: number | null;
    lastRunAt: string | null;
  }>;
  latestInsightRun: AgentRunRecord | null;
  recentLogs: ActivityLogRecord[];
}
