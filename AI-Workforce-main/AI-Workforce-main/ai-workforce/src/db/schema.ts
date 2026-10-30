import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    avatarUrl: text('avatar_url'),
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('profiles_email_idx').on(table.email)]
);

export const businesses = pgTable('businesses', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  industry: text('industry').notNull().default('B2B Operations & Advisory'),
  website: text('website'),
  valueProposition: text('value_proposition').notNull(),
  senderName: text('sender_name').notNull(),
  senderRole: text('sender_role').notNull(),
  qualificationCriteria: jsonb('qualification_criteria').$type<QualificationCriteria>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const businessMembers = pgTable(
  'business_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .references(() => businesses.id, { onDelete: 'cascade' })
      .notNull(),
    profileId: uuid('profile_id')
      .references(() => profiles.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull().default('admin'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('business_members_business_profile_uidx').on(table.businessId, table.profileId),
    index('business_members_profile_idx').on(table.profileId),
  ]
);

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .references(() => businesses.id, { onDelete: 'cascade' })
      .notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    jobTitle: text('job_title'),
    companyName: text('company_name').notNull(),
    companyWebsite: text('company_website'),
    industry: text('industry'),
    companySize: integer('company_size'),
    estimatedBudgetUsd: integer('estimated_budget_usd'),
    source: text('source').notNull().default('Inbound Web'),
    notes: text('notes'),
    painPoints: text('pain_points'),
    status: text('status').notNull().default('new'),
    qualificationScore: integer('qualification_score'),
    qualificationSummary: text('qualification_summary'),
    qualificationBreakdown: jsonb('qualification_breakdown').$type<QualificationBreakdown>(),
    isDemo: boolean('is_demo').notNull().default(false),
    simulatedFaultMode: text('simulated_fault_mode').default('none'),
    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('leads_business_idx').on(table.businessId),
    index('leads_status_idx').on(table.businessId, table.status),
    index('leads_score_idx').on(table.businessId, table.qualificationScore),
  ]
);

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .references(() => businesses.id, { onDelete: 'cascade' })
      .notNull(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    triggeredByProfileId: uuid('triggered_by_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    workflowType: text('workflow_type').notNull().default('lead_to_outreach'),
    directivePrompt: text('directive_prompt'),
    dagPlan: jsonb('dag_plan').$type<DagPlanNode[]>(),
    status: text('status').notNull().default('running'),
    currentStep: text('current_step'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(2),
    errorCategory: text('error_category'),
    errorMessage: text('error_message'),
    recoverySummary: text('recovery_summary'),
    outcome: text('outcome'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('workflow_runs_business_idx').on(table.businessId),
    index('workflow_runs_lead_idx').on(table.leadId),
  ]
);

export const workflowSteps = pgTable(
  'workflow_steps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workflowRunId: uuid('workflow_run_id')
      .references(() => workflowRuns.id, { onDelete: 'cascade' })
      .notNull(),
    businessId: uuid('business_id')
      .references(() => businesses.id, { onDelete: 'cascade' })
      .notNull(),
    stepOrder: integer('step_order').notNull(),
    stepKey: text('step_key').notNull(),
    stepName: text('step_name').notNull(),
    agentKey: text('agent_key').notNull(),
    toolName: text('tool_name'),
    dependsOn: jsonb('depends_on').$type<string[]>(),
    riskLevel: text('risk_level').default('low'),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    errorCategory: text('error_category'),
    errorMessage: text('error_message'),
    healingAction: text('healing_action'),
    inputPayload: jsonb('input_payload').$type<Record<string, unknown>>(),
    outputPayload: jsonb('output_payload').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('workflow_steps_run_idx').on(table.workflowRunId),
    index('workflow_steps_business_idx').on(table.businessId),
  ]
);

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .references(() => businesses.id, { onDelete: 'cascade' })
      .notNull(),
    workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    agentKey: text('agent_key').notNull(),
    agentName: text('agent_name').notNull(),
    modelUsed: text('model_used').notNull(),
    status: text('status').notNull(),
    durationMs: integer('duration_ms'),
    summary: text('summary'),
    structuredOutput: jsonb('structured_output').$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('agent_runs_business_idx').on(table.businessId),
    index('agent_runs_agent_key_idx').on(table.businessId, table.agentKey),
  ]
);

export const outreachDrafts = pgTable(
  'outreach_drafts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .references(() => businesses.id, { onDelete: 'cascade' })
      .notNull(),
    leadId: uuid('lead_id')
      .references(() => leads.id, { onDelete: 'cascade' })
      .notNull(),
    workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, {
      onDelete: 'set null',
    }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    personalizationRationale: text('personalization_rationale').notNull(),
    suggestedNextStep: text('suggested_next_step').notNull(),
    verifiedFactsUsed: jsonb('verified_facts_used').$type<string[]>(),
    status: text('status').notNull().default('pending_approval'),
    deliveryMode: text('delivery_mode').notNull().default('simulated_safe_mode'),
    deliveryNote: text('delivery_note'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('outreach_drafts_business_idx').on(table.businessId),
    index('outreach_drafts_lead_idx').on(table.leadId),
  ]
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .references(() => businesses.id, { onDelete: 'cascade' })
      .notNull(),
    outreachDraftId: uuid('outreach_draft_id').references(() => outreachDrafts.id, {
      onDelete: 'cascade',
    }),
    workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'cascade',
    }),
    leadId: uuid('lead_id')
      .references(() => leads.id, { onDelete: 'cascade' })
      .notNull(),
    approvalType: text('approval_type').notNull().default('outreach_email'),
    status: text('status').notNull().default('pending'),
    proposedChanges: jsonb('proposed_changes').$type<Record<string, unknown>>(),
    reviewerProfileId: uuid('reviewer_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    decisionNotes: text('decision_notes'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('approvals_business_idx').on(table.businessId),
    index('approvals_status_idx').on(table.businessId, table.status),
  ]
);

export const toolInvocations = pgTable(
  'tool_invocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .references(() => businesses.id, { onDelete: 'cascade' })
      .notNull(),
    workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id, {
      onDelete: 'set null',
    }),
    workflowStepId: uuid('workflow_step_id').references(() => workflowSteps.id, {
      onDelete: 'set null',
    }),
    leadId: uuid('lead_id').references(() => leads.id, {
      onDelete: 'set null',
    }),
    agentName: text('agent_name').notNull(),
    connectorKey: text('connector_key').notNull(),
    toolName: text('tool_name').notNull(),
    httpMethod: text('http_method').notNull().default('POST'),
    endpointPath: text('endpoint_path').notNull(),
    status: text('status').notNull().default('completed'),
    durationMs: integer('duration_ms').notNull().default(0),
    requestPayload: jsonb('request_payload').$type<Record<string, unknown>>(),
    responsePayload: jsonb('response_payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('tool_invocations_business_idx').on(table.businessId),
    index('tool_invocations_workflow_idx').on(table.workflowRunId),
  ]
);

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .references(() => businesses.id, { onDelete: 'cascade' })
      .notNull(),
    actorProfileId: uuid('actor_profile_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    actorType: text('actor_type').notNull(),
    actorName: text('actor_name').notNull(),
    eventType: text('event_type').notNull(),
    severity: text('severity').notNull().default('info'),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    message: text('message').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('activity_logs_business_idx').on(table.businessId),
    index('activity_logs_severity_idx').on(table.businessId, table.severity),
  ]
);

// Relations
export const profilesRelations = relations(profiles, ({ many }) => ({
  memberships: many(businessMembers),
}));

export const businessesRelations = relations(businesses, ({ many }) => ({
  members: many(businessMembers),
  leads: many(leads),
  workflowRuns: many(workflowRuns),
  agentRuns: many(agentRuns),
  outreachDrafts: many(outreachDrafts),
  approvals: many(approvals),
  toolInvocations: many(toolInvocations),
  activityLogs: many(activityLogs),
}));

export const businessMembersRelations = relations(businessMembers, ({ one }) => ({
  business: one(businesses, {
    fields: [businessMembers.businessId],
    references: [businesses.id],
  }),
  profile: one(profiles, {
    fields: [businessMembers.profileId],
    references: [profiles.id],
  }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  business: one(businesses, {
    fields: [leads.businessId],
    references: [businesses.id],
  }),
  workflowRuns: many(workflowRuns),
  outreachDrafts: many(outreachDrafts),
  approvals: many(approvals),
  toolInvocations: many(toolInvocations),
}));

export const workflowRunsRelations = relations(workflowRuns, ({ one, many }) => ({
  business: one(businesses, {
    fields: [workflowRuns.businessId],
    references: [businesses.id],
  }),
  lead: one(leads, {
    fields: [workflowRuns.leadId],
    references: [leads.id],
  }),
  steps: many(workflowSteps),
  toolInvocations: many(toolInvocations),
}));

export const workflowStepsRelations = relations(workflowSteps, ({ one }) => ({
  workflowRun: one(workflowRuns, {
    fields: [workflowSteps.workflowRunId],
    references: [workflowRuns.id],
  }),
}));

export const outreachDraftsRelations = relations(outreachDrafts, ({ one }) => ({
  lead: one(leads, {
    fields: [outreachDrafts.leadId],
    references: [leads.id],
  }),
  workflowRun: one(workflowRuns, {
    fields: [outreachDrafts.workflowRunId],
    references: [workflowRuns.id],
  }),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  lead: one(leads, {
    fields: [approvals.leadId],
    references: [leads.id],
  }),
  draft: one(outreachDrafts, {
    fields: [approvals.outreachDraftId],
    references: [outreachDrafts.id],
  }),
  workflowRun: one(workflowRuns, {
    fields: [approvals.workflowRunId],
    references: [workflowRuns.id],
  }),
}));
