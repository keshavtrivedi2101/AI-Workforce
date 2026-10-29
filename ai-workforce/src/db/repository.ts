import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  activityLogs,
  agentRuns,
  approvals,
  businesses,
  businessMembers,
  leads,
  outreachDrafts,
  profiles,
  type QualificationBreakdown,
  type QualificationCriteria,
  toolInvocations,
  workflowRuns,
  workflowSteps,
} from './schema.ts';
import { SAMPLE_DEMO_LEADS } from '../server/demoData.ts';

export const DEFAULT_QUALIFICATION_CRITERIA: QualificationCriteria = {
  targetIndustries: [
    'SaaS',
    'FinTech',
    'Healthcare',
    'Logistics',
    'Manufacturing',
    'Professional Services',
  ],
  minBudgetUsd: 12000,
  minCompanySize: 15,
  fitThresholdScore: 70,
  autoDraftMinScore: 55,
  maxWorkflowRetries: 2,
  idealCustomerNotes:
    'Growth-stage B2B companies seeking faster inbound lead qualification, human-approved sales follow-ups, and auditable workflow automation.',
  toneOfVoice: 'Consultative, concise, factual, and executive-ready',
};

function sanitizeDbError(contextMessage: string, error: unknown): never {
  console.error(`[DB Error] ${contextMessage}:`, error);
  throw new Error(`${contextMessage}. Please try again.`, { cause: error });
}

export async function ensureUserWorkspace(params: {
  uid: string;
  email: string;
  fullName?: string | null;
  avatarUrl?: string | null;
}) {
  try {
    const cleanEmail = params.email.trim().toLowerCase();
    const fallbackName =
      params.fullName?.trim() ||
      cleanEmail.split('@')[0]?.replace(/[._-]+/g, ' ') ||
      'Workspace Admin';

    const upsertedProfiles = await db
      .insert(profiles)
      .values({
        uid: params.uid,
        email: cleanEmail,
        fullName: fallbackName,
        avatarUrl: params.avatarUrl || null,
      })
      .onConflictDoUpdate({
        target: profiles.uid,
        set: {
          email: cleanEmail,
          avatarUrl: params.avatarUrl || null,
          updatedAt: new Date(),
        },
      })
      .returning();

    const profile = upsertedProfiles[0];

    const existingMemberships = await db
      .select({
        membership: businessMembers,
        business: businesses,
      })
      .from(businessMembers)
      .innerJoin(businesses, eq(businessMembers.businessId, businesses.id))
      .where(eq(businessMembers.profileId, profile.id))
      .limit(1);

    if (existingMemberships.length > 0) {
      return {
        profile,
        business: existingMemberships[0].business,
        membership: existingMemberships[0].membership,
      };
    }

    const insertedBusinesses = await db
      .insert(businesses)
      .values({
        name: `${profile.fullName}'s Operations`,
        industry: 'B2B Revenue & Operations',
        website: 'https://example-business.io',
        valueProposition:
          'We help B2B organizations qualify inbound leads transparently, eliminate manual CRM bottlenecks, and deliver human-verified client outreach.',
        senderName: profile.fullName,
        senderRole: 'Managing Director',
        qualificationCriteria: DEFAULT_QUALIFICATION_CRITERIA,
      })
      .returning();

    const business = insertedBusinesses[0];

    const insertedMemberships = await db
      .insert(businessMembers)
      .values({
        businessId: business.id,
        profileId: profile.id,
        role: 'admin',
      })
      .onConflictDoNothing()
      .returning();

    let membership = insertedMemberships[0];
    if (!membership) {
      const refetched = await db
        .select()
        .from(businessMembers)
        .where(
          and(
            eq(businessMembers.businessId, business.id),
            eq(businessMembers.profileId, profile.id)
          )
        )
        .limit(1);
      membership = refetched[0];
    }

    await db.insert(leads).values(
      SAMPLE_DEMO_LEADS.map((sample) => ({
        businessId: business.id,
        firstName: sample.firstName,
        lastName: sample.lastName,
        email: sample.email,
        phone: sample.phone,
        jobTitle: sample.jobTitle,
        companyName: sample.companyName,
        companyWebsite: sample.companyWebsite,
        industry: sample.industry,
        companySize: sample.companySize,
        estimatedBudgetUsd: sample.estimatedBudgetUsd,
        source: sample.source,
        notes: sample.notes,
        painPoints: sample.painPoints,
        status: 'new',
        isDemo: true,
        simulatedFaultMode: sample.simulatedFaultMode,
      }))
    );

    await db.insert(activityLogs).values({
      businessId: business.id,
      actorProfileId: profile.id,
      actorType: 'system',
      actorName: 'Workspace Security',
      eventType: 'workspace.provisioned',
      severity: 'success',
      entityType: 'settings',
      entityId: business.id,
      message: `Initialized isolated business workspace "${business.name}", seeded starter CRM pipeline, and assigned server-verified administrator role.`,
      metadata: { role: 'admin', isolatedTenant: true, seededLeads: SAMPLE_DEMO_LEADS.length },
    });

    return { profile, business, membership };
  } catch (error) {
    sanitizeDbError('Unable to initialize or load user workspace', error);
  }
}

export async function logActivity(params: {
  businessId: string;
  actorProfileId?: string | null;
  actorType: 'user' | 'agent' | 'system' | 'self_healing';
  actorName: string;
  eventType: string;
  severity?: 'info' | 'success' | 'warning' | 'error';
  entityType?: string | null;
  entityId?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const inserted = await db
      .insert(activityLogs)
      .values({
        businessId: params.businessId,
        actorProfileId: params.actorProfileId || null,
        actorType: params.actorType,
        actorName: params.actorName,
        eventType: params.eventType,
        severity: params.severity || 'info',
        entityType: params.entityType || null,
        entityId: params.entityId || null,
        message: params.message,
        metadata: params.metadata || null,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('[Audit Log Warning] Failed to record activity log:', error);
    return null;
  }
}

export async function recordToolInvocation(params: {
  businessId: string;
  workflowRunId?: string | null;
  workflowStepId?: string | null;
  leadId?: string | null;
  agentName: string;
  connectorKey:
    | 'postgres_crm'
    | 'google_sheets_sync'
    | 'airtable_pipeline'
    | 'email_dispatcher'
    | 'webhook_outbox';
  toolName: string;
  httpMethod?: string;
  endpointPath: string;
  status?: 'completed' | 'held_for_approval' | 'dispatched_after_approval' | 'failed';
  durationMs: number;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
}) {
  try {
    const rows = await db
      .insert(toolInvocations)
      .values({
        businessId: params.businessId,
        workflowRunId: params.workflowRunId || null,
        workflowStepId: params.workflowStepId || null,
        leadId: params.leadId || null,
        agentName: params.agentName,
        connectorKey: params.connectorKey,
        toolName: params.toolName,
        httpMethod: params.httpMethod || 'POST',
        endpointPath: params.endpointPath,
        status: params.status || 'completed',
        durationMs: Math.max(1, Math.round(params.durationMs)),
        requestPayload: params.requestPayload || null,
        responsePayload: params.responsePayload || null,
      })
      .returning();
    return rows[0];
  } catch (error) {
    console.error('[Tool Invocation Log Warning]:', error);
    return null;
  }
}

export async function listToolInvocations(businessId: string) {
  try {
    return await db
      .select()
      .from(toolInvocations)
      .where(eq(toolInvocations.businessId, businessId))
      .orderBy(desc(toolInvocations.createdAt))
      .limit(80);
  } catch (error) {
    sanitizeDbError('Unable to load connected tool and webhook invocations', error);
  }
}

export async function listBusinessLeads(businessId: string) {
  try {
    return await db
      .select()
      .from(leads)
      .where(eq(leads.businessId, businessId))
      .orderBy(desc(leads.createdAt));
  } catch (error) {
    sanitizeDbError('Unable to retrieve leads for business', error);
  }
}

export async function getLeadById(businessId: string, leadId: string) {
  try {
    const rows = await db
      .select()
      .from(leads)
      .where(and(eq(leads.businessId, businessId), eq(leads.id, leadId)))
      .limit(1);
    return rows[0] || null;
  } catch (error) {
    sanitizeDbError('Unable to retrieve lead record', error);
  }
}

export async function getLeadDetailsBundle(businessId: string, leadId: string) {
  try {
    const lead = await getLeadById(businessId, leadId);
    if (!lead) return null;

    const drafts = await db
      .select()
      .from(outreachDrafts)
      .where(and(eq(outreachDrafts.businessId, businessId), eq(outreachDrafts.leadId, leadId)))
      .orderBy(desc(outreachDrafts.createdAt));

    const runs = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.businessId, businessId), eq(workflowRuns.leadId, leadId)))
      .orderBy(desc(workflowRuns.createdAt));

    const agentHistory = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.businessId, businessId), eq(agentRuns.leadId, leadId)))
      .orderBy(desc(agentRuns.createdAt));

    return { lead, drafts, workflowRuns: runs, agentRuns: agentHistory };
  } catch (error) {
    sanitizeDbError('Unable to load full lead profile', error);
  }
}

export async function createLeadRecord(
  businessId: string,
  actorProfileId: string,
  actorName: string,
  payload: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    jobTitle?: string | null;
    companyName: string;
    companyWebsite?: string | null;
    industry?: string | null;
    companySize?: number | null;
    estimatedBudgetUsd?: number | null;
    source?: string;
    notes?: string | null;
    painPoints?: string | null;
    isDemo?: boolean;
    simulatedFaultMode?: string | null;
  }
) {
  try {
    const inserted = await db
      .insert(leads)
      .values({
        businessId,
        firstName: payload.firstName.trim(),
        lastName: payload.lastName.trim(),
        email: payload.email.trim(),
        phone: payload.phone?.trim() || null,
        jobTitle: payload.jobTitle?.trim() || null,
        companyName: payload.companyName.trim(),
        companyWebsite: payload.companyWebsite?.trim() || null,
        industry: payload.industry?.trim() || null,
        companySize:
          typeof payload.companySize === 'number' && !Number.isNaN(payload.companySize)
            ? payload.companySize
            : null,
        estimatedBudgetUsd:
          typeof payload.estimatedBudgetUsd === 'number' && !Number.isNaN(payload.estimatedBudgetUsd)
            ? payload.estimatedBudgetUsd
            : null,
        source: payload.source?.trim() || 'Manual Entry',
        notes: payload.notes?.trim() || null,
        painPoints: payload.painPoints?.trim() || null,
        status: 'new',
        isDemo: Boolean(payload.isDemo),
        simulatedFaultMode: payload.simulatedFaultMode || 'none',
      })
      .returning();

    const created = inserted[0];

    await logActivity({
      businessId,
      actorProfileId,
      actorType: 'user',
      actorName,
      eventType: 'lead.created',
      severity: 'info',
      entityType: 'lead',
      entityId: created.id,
      message: `Added lead ${created.firstName} ${created.lastName} (${created.companyName}).`,
      metadata: { isDemo: created.isDemo, source: created.source },
    });

    return created;
  } catch (error) {
    sanitizeDbError('Unable to create lead record', error);
  }
}

export async function updateLeadRecord(
  businessId: string,
  leadId: string,
  actorProfileId: string,
  actorName: string,
  updates: Partial<{
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
    status: string;
    simulatedFaultMode: string | null;
  }>
) {
  try {
    const updatedRows = await db
      .update(leads)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(eq(leads.businessId, businessId), eq(leads.id, leadId)))
      .returning();

    const updated = updatedRows[0];
    if (!updated) return null;

    await logActivity({
      businessId,
      actorProfileId,
      actorType: 'user',
      actorName,
      eventType: 'lead.updated',
      severity: 'info',
      entityType: 'lead',
      entityId: updated.id,
      message: `Updated lead details for ${updated.firstName} ${updated.lastName} (${updated.companyName}).`,
    });

    return updated;
  } catch (error) {
    sanitizeDbError('Unable to update lead record', error);
  }
}

export async function deleteLeadRecord(
  businessId: string,
  leadId: string,
  actorProfileId: string,
  actorName: string
) {
  try {
    const deletedRows = await db
      .delete(leads)
      .where(and(eq(leads.businessId, businessId), eq(leads.id, leadId)))
      .returning();

    const deleted = deletedRows[0];
    if (!deleted) return false;

    await logActivity({
      businessId,
      actorProfileId,
      actorType: 'user',
      actorName,
      eventType: 'lead.deleted',
      severity: 'warning',
      entityType: 'lead',
      entityId: deleted.id,
      message: `Deleted lead ${deleted.firstName} ${deleted.lastName} (${deleted.companyName}).`,
    });

    return true;
  } catch (error) {
    sanitizeDbError('Unable to delete lead record', error);
  }
}

export async function importSampleDemoLeads(
  businessId: string,
  actorProfileId: string,
  actorName: string
) {
  try {
    const existing = await db
      .select({ email: leads.email, companyName: leads.companyName })
      .from(leads)
      .where(eq(leads.businessId, businessId));

    const existingKeys = new Set(
      existing.map(
        (r) => `${r.companyName.toLowerCase()}::${r.email.replace(/\s+/g, '').toLowerCase()}`
      )
    );

    const toInsert = SAMPLE_DEMO_LEADS.filter(
      (seed) =>
        !existingKeys.has(
          `${seed.companyName.toLowerCase()}::${seed.email.replace(/\s+/g, '').toLowerCase()}`
        )
    );

    if (toInsert.length === 0) {
      return { importedCount: 0, leads: [] };
    }

    const inserted = await db
      .insert(leads)
      .values(
        toInsert.map((seed) => ({
          businessId,
          firstName: seed.firstName,
          lastName: seed.lastName,
          email: seed.email,
          phone: seed.phone,
          jobTitle: seed.jobTitle,
          companyName: seed.companyName,
          companyWebsite: seed.companyWebsite,
          industry: seed.industry,
          companySize: seed.companySize,
          estimatedBudgetUsd: seed.estimatedBudgetUsd,
          source: seed.source,
          notes: seed.notes,
          painPoints: seed.painPoints,
          status: 'new',
          isDemo: true,
          simulatedFaultMode: seed.simulatedFaultMode,
        }))
      )
      .returning();

    await logActivity({
      businessId,
      actorProfileId,
      actorType: 'user',
      actorName,
      eventType: 'leads.demo_imported',
      severity: 'success',
      entityType: 'lead',
      message: `Imported ${inserted.length} clearly labeled sample demo leads into workspace.`,
      metadata: { importedCount: inserted.length, isDemoBatch: true },
    });

    return { importedCount: inserted.length, leads: inserted };
  } catch (error) {
    sanitizeDbError('Unable to import sample demo leads', error);
  }
}

export async function saveLeadQualificationResult(params: {
  businessId: string;
  leadId: string;
  score: number;
  summary: string;
  breakdown: QualificationBreakdown;
  status: string;
}) {
  try {
    const rows = await db
      .update(leads)
      .set({
        qualificationScore: params.score,
        qualificationSummary: params.summary,
        qualificationBreakdown: params.breakdown,
        status: params.status,
        lastEvaluatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(leads.businessId, params.businessId), eq(leads.id, params.leadId)))
      .returning();
    return rows[0] || null;
  } catch (error) {
    sanitizeDbError('Unable to persist lead qualification score', error);
  }
}

export async function listWorkflowRunsWithSteps(businessId: string) {
  try {
    const runs = await db
      .select({
        run: workflowRuns,
        leadFirstName: leads.firstName,
        leadLastName: leads.lastName,
        leadCompany: leads.companyName,
      })
      .from(workflowRuns)
      .leftJoin(leads, eq(workflowRuns.leadId, leads.id))
      .where(eq(workflowRuns.businessId, businessId))
      .orderBy(desc(workflowRuns.createdAt))
      .limit(50);

    const steps = await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.businessId, businessId));

    const stepsByRun = new Map<string, typeof steps>();
    for (const step of steps) {
      const arr = stepsByRun.get(step.workflowRunId) || [];
      arr.push(step);
      stepsByRun.set(step.workflowRunId, arr);
    }

    return runs.map(({ run, leadFirstName, leadLastName, leadCompany }) => ({
      ...run,
      leadName:
        leadFirstName && leadLastName
          ? `${leadFirstName} ${leadLastName}`
          : 'Workspace Directive',
      leadCompany: leadCompany || 'Multi-Agent DAG',
      steps: (stepsByRun.get(run.id) || []).sort((a, b) => a.stepOrder - b.stepOrder),
    }));
  } catch (error) {
    sanitizeDbError('Unable to retrieve workflow runs', error);
  }
}

export async function listApprovalsBundle(businessId: string) {
  try {
    const approvalRows = await db
      .select({
        approval: approvals,
        leadFirstName: leads.firstName,
        leadLastName: leads.lastName,
        leadEmail: leads.email,
        leadCompany: leads.companyName,
        leadScore: leads.qualificationScore,
        leadIsDemo: leads.isDemo,
      })
      .from(approvals)
      .innerJoin(leads, eq(approvals.leadId, leads.id))
      .where(eq(approvals.businessId, businessId))
      .orderBy(desc(approvals.createdAt));

    const draftRows = await db
      .select()
      .from(outreachDrafts)
      .where(eq(outreachDrafts.businessId, businessId));

    const draftMap = new Map(draftRows.map((d) => [d.id, d]));

    return approvalRows.map((row) => ({
      ...row.approval,
      leadFirstName: row.leadFirstName,
      leadLastName: row.leadLastName,
      leadEmail: row.leadEmail,
      leadCompany: row.leadCompany,
      leadScore: row.leadScore,
      leadIsDemo: row.leadIsDemo,
      draft: row.approval.outreachDraftId ? draftMap.get(row.approval.outreachDraftId) || null : null,
    }));
  } catch (error) {
    sanitizeDbError('Unable to retrieve approval queue', error);
  }
}

export async function decideApprovalItem(params: {
  businessId: string;
  approvalId: string;
  reviewerProfileId: string;
  reviewerName: string;
  decision: 'approved' | 'rejected';
  editedSubject?: string;
  editedBody?: string;
  decisionNotes?: string;
}) {
  try {
    const existingRows = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.businessId, params.businessId), eq(approvals.id, params.approvalId)))
      .limit(1);

    const approval = existingRows[0];
    if (!approval) {
      throw new Error('Approval item not found');
    }
    if (approval.status !== 'pending') {
      throw new Error('This approval item has already been finalized');
    }

    const now = new Date();

    const updatedApprovalRows = await db
      .update(approvals)
      .set({
        status: params.decision,
        reviewerProfileId: params.reviewerProfileId,
        decisionNotes: params.decisionNotes?.trim() || null,
        decidedAt: now,
      })
      .where(and(eq(approvals.businessId, params.businessId), eq(approvals.id, params.approvalId)))
      .returning();

    if (approval.approvalType === 'outreach_email' && approval.outreachDraftId) {
      const currentDraftRows = await db
        .select()
        .from(outreachDrafts)
        .where(
          and(
            eq(outreachDrafts.businessId, params.businessId),
            eq(outreachDrafts.id, approval.outreachDraftId)
          )
        )
        .limit(1);
      const currentDraft = currentDraftRows[0];

      if (currentDraft) {
        const finalSubject = params.editedSubject?.trim() || currentDraft.subject;
        const finalBody = params.editedBody?.trim() || currentDraft.body;
        const isApproved = params.decision === 'approved';

        await db
          .update(outreachDrafts)
          .set({
            subject: finalSubject,
            body: finalBody,
            status: isApproved ? 'simulated_sent' : 'rejected',
            deliveryMode: 'simulated_safe_mode',
            deliveryNote: isApproved
              ? 'Approved by human reviewer. Simulated safe webhook & mailer dispatch recorded (no external email sent).'
              : 'Rejected during human approval review. No external message was sent.',
            sentAt: isApproved ? now : null,
            updatedAt: now,
          })
          .where(eq(outreachDrafts.id, currentDraft.id));

        if (isApproved) {
          await db
            .update(leads)
            .set({
              status: 'contacted',
              updatedAt: now,
            })
            .where(and(eq(leads.businessId, params.businessId), eq(leads.id, approval.leadId)));

          await recordToolInvocation({
            businessId: params.businessId,
            workflowRunId: approval.workflowRunId || null,
            leadId: approval.leadId,
            agentName: 'Supervisor & Human Checkpoint',
            connectorKey: 'webhook_outbox',
            toolName: 'webhook.release_approved_outreach',
            httpMethod: 'POST',
            endpointPath: '/connectors/webhook/outbox/dispatch',
            status: 'dispatched_after_approval',
            durationMs: 38,
            requestPayload: {
              approvalId: approval.id,
              draftId: currentDraft.id,
              subject: finalSubject,
              reviewer: params.reviewerName,
            },
            responsePayload: {
              ok: true,
              deliveryMode: 'simulated_safe_mode',
              checkpointVerifiedBy: params.reviewerName,
              dispatchedAt: now.toISOString(),
            },
          });
        }
      }
    }

    if (approval.approvalType === 'data_correction' && approval.proposedChanges) {
      if (params.decision === 'approved') {
        const patch: Record<string, unknown> = { updatedAt: now };
        if (typeof approval.proposedChanges.correctedEmail === 'string') {
          patch.email = approval.proposedChanges.correctedEmail;
        }
        if (typeof approval.proposedChanges.suggestedIndustry === 'string') {
          patch.industry = approval.proposedChanges.suggestedIndustry;
        }
        await db
          .update(leads)
          .set(patch)
          .where(and(eq(leads.businessId, params.businessId), eq(leads.id, approval.leadId)));
      }
    }

    if (approval.workflowRunId) {
      // Update any step waiting at requires_approval in this workflow
      await db
        .update(workflowSteps)
        .set({
          status: params.decision === 'approved' ? 'completed' : 'skipped',
          completedAt: now,
          outputPayload: {
            decision: params.decision,
            reviewer: params.reviewerName,
            simulatedDelivery: params.decision === 'approved',
            externalEmailDispatched: false,
          },
        })
        .where(
          and(
            eq(workflowSteps.workflowRunId, approval.workflowRunId),
            eq(workflowSteps.status, 'requires_approval')
          )
        );

      // Check if any pending approvals remain for this workflowRunId
      const remainingPending = await db
        .select()
        .from(approvals)
        .where(
          and(
            eq(approvals.workflowRunId, approval.workflowRunId),
            eq(approvals.status, 'pending')
          )
        );

      if (remainingPending.length === 0) {
        await db
          .update(workflowRuns)
          .set({
            status: params.decision === 'approved' ? 'completed' : 'needs_human_intervention',
            currentStep: null,
            outcome:
              params.decision === 'approved'
                ? 'Human checkpoint signed off; simulated safe webhook & outreach delivery completed.'
                : 'Checkpoint rejected by human reviewer; workflow closed without external dispatch.',
            completedAt: now,
          })
          .where(
            and(
              eq(workflowRuns.businessId, params.businessId),
              eq(workflowRuns.id, approval.workflowRunId)
            )
          );
      }
    }

    await logActivity({
      businessId: params.businessId,
      actorProfileId: params.reviewerProfileId,
      actorType: 'user',
      actorName: params.reviewerName,
      eventType: `approval.${params.decision}`,
      severity: params.decision === 'approved' ? 'success' : 'warning',
      entityType: 'approval',
      entityId: approval.id,
      message:
        params.decision === 'approved'
          ? `Signed off on ${approval.approvalType.replace('_', ' ')} checkpoint. Released simulated safe webhook delivery.`
          : `Rejected ${approval.approvalType.replace('_', ' ')} checkpoint.`,
      metadata: {
        decision: params.decision,
        decisionNotes: params.decisionNotes || null,
        externalEmailSent: false,
      },
    });

    return updatedApprovalRows[0];
  } catch (error) {
    if (error instanceof Error && error.message.includes('Approval item')) {
      throw error;
    }
    sanitizeDbError('Unable to record approval decision', error);
  }
}

export async function updateBusinessSettings(params: {
  businessId: string;
  actorProfileId: string;
  actorName: string;
  role: string;
  name: string;
  industry: string;
  website: string | null;
  valueProposition: string;
  senderName: string;
  senderRole: string;
  qualificationCriteria: QualificationCriteria;
}) {
  if (params.role !== 'admin') {
    throw new Error('Permission denied: Only business administrators can modify settings.');
  }

  try {
    const updatedRows = await db
      .update(businesses)
      .set({
        name: params.name.trim(),
        industry: params.industry.trim(),
        website: params.website?.trim() || null,
        valueProposition: params.valueProposition.trim(),
        senderName: params.senderName.trim(),
        senderRole: params.senderRole.trim(),
        qualificationCriteria: params.qualificationCriteria,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, params.businessId))
      .returning();

    const updated = updatedRows[0];

    await logActivity({
      businessId: params.businessId,
      actorProfileId: params.actorProfileId,
      actorType: 'user',
      actorName: params.actorName,
      eventType: 'settings.updated',
      severity: 'info',
      entityType: 'settings',
      entityId: params.businessId,
      message: `Updated business profile and AI qualification thresholds (fit threshold: ${params.qualificationCriteria.fitThresholdScore}/100, max retries: ${params.qualificationCriteria.maxWorkflowRetries}).`,
    });

    return updated;
  } catch (error) {
    sanitizeDbError('Unable to update business settings', error);
  }
}

export async function listAgentRuns(businessId: string) {
  try {
    return await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.businessId, businessId))
      .orderBy(desc(agentRuns.createdAt))
      .limit(80);
  } catch (error) {
    sanitizeDbError('Unable to load AI agent execution history', error);
  }
}

export async function listActivityLogs(businessId: string) {
  try {
    return await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.businessId, businessId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(120);
  } catch (error) {
    sanitizeDbError('Unable to load activity and error logs', error);
  }
}

export async function computeDashboardMetrics(businessId: string) {
  try {
    const [allLeads, allWorkflows, allApprovals, allDrafts, allAgentRuns, allTools, recentLogs] =
      await Promise.all([
        db.select().from(leads).where(eq(leads.businessId, businessId)),
        db.select().from(workflowRuns).where(eq(workflowRuns.businessId, businessId)),
        db.select().from(approvals).where(eq(approvals.businessId, businessId)),
        db.select().from(outreachDrafts).where(eq(outreachDrafts.businessId, businessId)),
        db
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.businessId, businessId))
          .orderBy(desc(agentRuns.createdAt)),
        db.select().from(toolInvocations).where(eq(toolInvocations.businessId, businessId)),
        db
          .select()
          .from(activityLogs)
          .where(eq(activityLogs.businessId, businessId))
          .orderBy(desc(activityLogs.createdAt))
          .limit(15),
      ]);

    const totalLeads = allLeads.length;
    const demoLeads = allLeads.filter((l) => l.isDemo).length;
    const realLeads = totalLeads - demoLeads;

    const evaluatedLeads = allLeads.filter((l) => typeof l.qualificationScore === 'number');
    const qualifiedLeads = allLeads.filter(
      (l) =>
        l.status === 'qualified' ||
        l.status === 'outreach_pending' ||
        l.status === 'contacted' ||
        l.status === 'converted'
    ).length;
    const nurtureLeads = allLeads.filter((l) => l.status === 'nurture').length;
    const disqualifiedLeads = allLeads.filter((l) => l.status === 'disqualified').length;
    const contactedOrConvertedLeads = allLeads.filter(
      (l) => l.status === 'contacted' || l.status === 'converted'
    ).length;

    const pendingApprovals = allApprovals.filter((a) => a.status === 'pending').length;
    const completedWorkflows = allWorkflows.filter(
      (w) => w.status === 'completed' || w.status === 'awaiting_approval'
    ).length;
    const healedWorkflows = allWorkflows.filter(
      (w) =>
        Boolean(w.recoverySummary) &&
        w.status !== 'failed' &&
        w.status !== 'needs_human_intervention'
    ).length;
    const failedOrInterventionWorkflows = allWorkflows.filter(
      (w) => w.status === 'failed' || w.status === 'needs_human_intervention'
    ).length;
    const directiveRunsCount = allWorkflows.filter((w) => w.workflowType === 'directive_dag').length;

    const approvedDrafts = allDrafts.filter(
      (d) => d.status === 'approved' || d.status === 'simulated_sent'
    ).length;
    const rejectedDrafts = allDrafts.filter((d) => d.status === 'rejected').length;

    const qualificationRatePct =
      evaluatedLeads.length > 0
        ? Math.round((qualifiedLeads / evaluatedLeads.length) * 100)
        : null;

    const decidedApprovals = allApprovals.filter((a) => a.status !== 'pending').length;
    const approvedCount = allApprovals.filter((a) => a.status === 'approved').length;
    const approvalConversionPct =
      decidedApprovals > 0 ? Math.round((approvedCount / decidedApprovals) * 100) : null;

    const averageQualificationScore =
      evaluatedLeads.length > 0
        ? Math.round(
            evaluatedLeads.reduce((acc, l) => acc + (l.qualificationScore || 0), 0) /
              evaluatedLeads.length
          )
        : null;

    let insufficientDataNotice: string | null = null;
    if (totalLeads === 0) {
      insufficientDataNotice =
        'Insufficient data: Workspace currently has 0 leads. Add leads, import sample demo data, or run a natural-language directive to generate verified metrics.';
    } else if (evaluatedLeads.length < 3) {
      insufficientDataNotice = `Limited sample size (${evaluatedLeads.length} evaluated of ${totalLeads} leads). Conversion percentages are preliminary estimates based on persisted records.`;
    }

    const statusLabels: Array<{ status: string; label: string }> = [
      { status: 'new', label: 'New' },
      { status: 'qualified', label: 'Qualified' },
      { status: 'nurture', label: 'Nurture' },
      { status: 'outreach_pending', label: 'Draft Pending' },
      { status: 'contacted', label: 'Contacted' },
      { status: 'converted', label: 'Converted' },
      { status: 'disqualified', label: 'Disqualified' },
    ];

    const pipelineByStatus = statusLabels.map(({ status, label }) => ({
      status,
      label,
      count: allLeads.filter((l) => l.status === status).length,
    }));

    const scoreDistribution = [
      {
        bucket: '0–39 (Low Fit)',
        count: evaluatedLeads.filter((l) => (l.qualificationScore ?? 0) < 40).length,
      },
      {
        bucket: '40–69 (Nurture)',
        count: evaluatedLeads.filter(
          (l) => (l.qualificationScore ?? 0) >= 40 && (l.qualificationScore ?? 0) < 70
        ).length,
      },
      {
        bucket: '70–84 (Strong Fit)',
        count: evaluatedLeads.filter(
          (l) => (l.qualificationScore ?? 0) >= 70 && (l.qualificationScore ?? 0) < 85
        ).length,
      },
      {
        bucket: '85–100 (Ideal ICP)',
        count: evaluatedLeads.filter((l) => (l.qualificationScore ?? 0) >= 85).length,
      },
    ];

    const agentCatalog = [
      {
        agentKey: 'orchestrator_planner',
        agentName: 'Orchestrator · Directive & DAG Planner',
      },
      { agentKey: 'lead_research', agentName: 'Agent A · Lead Research & Qualification' },
      { agentKey: 'crm_updater', agentName: 'CRM Updater · Function-Calling Tool Agent' },
      { agentKey: 'sales_outreach', agentName: 'Agent B · Email & Outreach Dispatcher' },
      { agentKey: 'workflow_coordinator', agentName: 'Agent C · Self-Healing Supervisor' },
      { agentKey: 'business_insights', agentName: 'Agent D · Business Insights Analyst' },
    ];

    const agentSummary = agentCatalog.map((catalog) => {
      const runs = allAgentRuns.filter((r) => r.agentKey === catalog.agentKey);
      const completed = runs.filter((r) => r.status === 'completed');
      const failed = runs.filter((r) => r.status === 'failed');
      const durations = completed
        .map((r) => r.durationMs)
        .filter((d): d is number => typeof d === 'number');
      const avgDurationMs =
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : null;
      return {
        agentKey: catalog.agentKey,
        agentName: catalog.agentName,
        totalRuns: runs.length,
        completedRuns: completed.length,
        failedRuns: failed.length,
        avgDurationMs,
        lastRunAt: runs[0]?.createdAt ? runs[0].createdAt.toISOString() : null,
      };
    });

    const latestInsightRun =
      allAgentRuns.find((r) => r.agentKey === 'business_insights' && r.status === 'completed') ||
      null;

    return {
      counts: {
        totalLeads,
        realLeads,
        demoLeads,
        qualifiedLeads,
        nurtureLeads,
        disqualifiedLeads,
        contactedOrConvertedLeads,
        pendingApprovals,
        completedWorkflows,
        healedWorkflows,
        failedOrInterventionWorkflows,
        approvedDrafts,
        rejectedDrafts,
        toolInvocationsCount: allTools.length,
        directiveRunsCount,
      },
      rates: {
        qualificationRatePct,
        approvalConversionPct,
        averageQualificationScore,
        insufficientDataNotice,
      },
      pipelineByStatus,
      scoreDistribution,
      agentSummary,
      latestInsightRun,
      recentLogs,
    };
  } catch (error) {
    sanitizeDbError('Unable to compute business dashboard metrics', error);
  }
}
