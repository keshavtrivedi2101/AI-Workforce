import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  agentRuns,
  approvals,
  leads,
  outreachDrafts,
  type QualificationBreakdown,
  type QualificationCriteria,
  workflowRuns,
  workflowSteps,
} from '../db/schema.ts';
import {
  computeDashboardMetrics,
  getLeadById,
  logActivity,
  saveLeadQualificationResult,
} from '../db/repository.ts';

const GEMINI_MODEL = 'gemini-3.1-flash-lite';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error(
      'Server AI service is not configured: GEMINI_API_KEY environment variable is missing.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 25000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export type ErrorCategory =
  | 'validation'
  | 'permission'
  | 'rate_limit'
  | 'transient_network'
  | 'unknown';

export class ClassifiedWorkflowError extends Error {
  category: ErrorCategory;
  retryable: boolean;

  constructor(message: string, category: ErrorCategory, retryable: boolean) {
    super(message);
    this.name = 'ClassifiedWorkflowError';
    this.category = category;
    this.retryable = retryable;
  }
}

export function classifyWorkflowError(err: unknown): {
  category: ErrorCategory;
  retryable: boolean;
  cleanMessage: string;
} {
  if (err instanceof ClassifiedWorkflowError) {
    return {
      category: err.category,
      retryable: err.retryable,
      cleanMessage: err.message,
    };
  }

  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('permission') || lower.includes('unauthorized') || lower.includes('403')) {
    return {
      category: 'permission',
      retryable: false,
      cleanMessage: 'Permission check failed while executing workflow step.',
    };
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota')) {
    return {
      category: 'rate_limit',
      retryable: true,
      cleanMessage: 'Upstream AI rate limit encountered; eligible for bounded backoff retry.',
    };
  }
  if (
    lower.includes('timeout') ||
    lower.includes('deadline') ||
    lower.includes('504') ||
    lower.includes('econnreset') ||
    lower.includes('network') ||
    lower.includes('503') ||
    lower.includes('transient')
  ) {
    return {
      category: 'transient_network',
      retryable: true,
      cleanMessage: 'Upstream AI gateway timed out or encountered a transient interruption.',
    };
  }
  if (lower.includes('invalid') || lower.includes('validation') || lower.includes('malformed')) {
    return {
      category: 'validation',
      retryable: false,
      cleanMessage: raw,
    };
  }
  return {
    category: 'unknown',
    retryable: false,
    cleanMessage: raw || 'Unexpected workflow execution error.',
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STRICT_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function attemptDeterministicEmailRepair(rawEmail: string): {
  valid: boolean;
  repairedEmail: string | null;
  ruleApplied: string | null;
} {
  const trimmed = rawEmail.trim();
  if (STRICT_EMAIL_REGEX.test(trimmed)) {
    return { valid: true, repairedEmail: trimmed, ruleApplied: null };
  }

  // Deterministic rule: strip accidental internal whitespace, collapse duplicate '@', strip trailing punctuation
  const normalized = trimmed
    .replace(/\s+/g, '')
    .replace(/@{2,}/g, '@')
    .replace(/\.{2,}/g, '.')
    .replace(/[,;]+$/g, '')
    .toLowerCase();

  if (STRICT_EMAIL_REGEX.test(normalized)) {
    return {
      valid: false,
      repairedEmail: normalized,
      ruleApplied:
        'Deterministic RFC email sanitizer removed stray whitespace/duplicate symbols and verified domain syntax.',
    };
  }

  return { valid: false, repairedEmail: null, ruleApplied: null };
}

// ============================================================================
// AGENT A: Lead Research & Qualification Agent
// ============================================================================
export async function runLeadQualificationAgent(params: {
  businessId: string;
  leadId: string;
  criteria: QualificationCriteria;
  businessName: string;
  businessValueProp: string;
  workflowRunId?: string | null;
  actorProfileId?: string | null;
}) {
  const startedMs = Date.now();
  const lead = await getLeadById(params.businessId, params.leadId);
  if (!lead) {
    throw new ClassifiedWorkflowError('Lead record not found in workspace.', 'validation', false);
  }

  const insertedRunRows = await db
    .insert(agentRuns)
    .values({
      businessId: params.businessId,
      workflowRunId: params.workflowRunId || null,
      leadId: lead.id,
      agentKey: 'lead_research',
      agentName: 'Agent A · Lead Research & Qualification',
      modelUsed: GEMINI_MODEL,
      status: 'running',
    })
    .returning();
  const agentRun = insertedRunRows[0];

  try {
    const ai = getGeminiClient();

    const verifiedLeadSnapshot = {
      fullName: `${lead.firstName} ${lead.lastName}`,
      email: lead.email,
      phone: lead.phone ?? 'MISSING',
      jobTitle: lead.jobTitle ?? 'MISSING',
      companyName: lead.companyName,
      companyWebsite: lead.companyWebsite ?? 'MISSING',
      industry: lead.industry ?? 'MISSING',
      companySizeEmployees: lead.companySize ?? 'MISSING',
      estimatedBudgetUsd: lead.estimatedBudgetUsd ?? 'MISSING',
      source: lead.source,
      painPoints: lead.painPoints ?? 'MISSING',
      notes: lead.notes ?? 'MISSING',
    };

    const prompt = `Evaluate the following B2B lead strictly using the provided lead record and business qualification criteria.

CRITICAL RULES:
1. NEVER invent, guess, or extrapolate facts about the company, revenue, employees, or budget that are marked MISSING.
2. Explicitly list every missing field that would strengthen qualification in "missingInformation".
3. Compute sub-scores transparently so their sum equals "totalScore" (0 to 100):
   - industryFitScore: integer 0 to 30
   - budgetFitScore: integer 0 to 30 (if budget is MISSING, score conservatively between 8 and 15 and note that budget is unverified)
   - companyScaleScore: integer 0 to 20
   - dataCompletenessScore: integer 0 to 20
4. Set recommendedDisposition:
   - "qualified" if totalScore >= ${params.criteria.fitThresholdScore}
   - "nurture" if totalScore >= 45 and < ${params.criteria.fitThresholdScore}
   - "disqualified" if totalScore < 45

Business Context:
- Business Name: ${params.businessName}
- Value Proposition: ${params.businessValueProp}
- Qualification Criteria: ${JSON.stringify(params.criteria)}

Verified Lead Record from Database:
${JSON.stringify(verifiedLeadSnapshot, null, 2)}`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction:
          'You are Agent A (Lead Research and Qualification) in AI Workforce. Provide transparent, evidence-grounded B2B lead scoring. Never hallucinate unverified facts.',
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            totalScore: { type: Type.INTEGER },
            industryFitScore: { type: Type.INTEGER },
            budgetFitScore: { type: Type.INTEGER },
            companyScaleScore: { type: Type.INTEGER },
            dataCompletenessScore: { type: Type.INTEGER },
            summary: { type: Type.STRING },
            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            concerns: { type: Type.ARRAY, items: { type: Type.STRING } },
            missingInformation: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedDisposition: { type: Type.STRING },
          },
          required: [
            'totalScore',
            'industryFitScore',
            'budgetFitScore',
            'companyScaleScore',
            'dataCompletenessScore',
            'summary',
            'strengths',
            'concerns',
            'missingInformation',
            'recommendedDisposition',
          ],
        },
      },
    });

    const rawText = response.text?.trim();
    if (!rawText) {
      throw new ClassifiedWorkflowError(
        'Qualification model returned an empty response.',
        'transient_network',
        true
      );
    }

    const parsed = JSON.parse(rawText);

    const industryFitScore = Math.max(0, Math.min(30, Number(parsed.industryFitScore) || 0));
    const budgetFitScore = Math.max(0, Math.min(30, Number(parsed.budgetFitScore) || 0));
    const companyScaleScore = Math.max(0, Math.min(20, Number(parsed.companyScaleScore) || 0));
    const dataCompletenessScore = Math.max(
      0,
      Math.min(20, Number(parsed.dataCompletenessScore) || 0)
    );
    const computedSum =
      industryFitScore + budgetFitScore + companyScaleScore + dataCompletenessScore;
    const finalScore = Math.max(0, Math.min(100, computedSum));

    const disposition: 'qualified' | 'nurture' | 'disqualified' =
      finalScore >= params.criteria.fitThresholdScore
        ? 'qualified'
        : finalScore >= 45
          ? 'nurture'
          : 'disqualified';

    const breakdown: QualificationBreakdown = {
      industryFitScore,
      budgetFitScore,
      companyScaleScore,
      dataCompletenessScore,
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.slice(0, 5) : [],
      missingInformation: Array.isArray(parsed.missingInformation)
        ? parsed.missingInformation.slice(0, 8)
        : [],
      recommendedDisposition: disposition,
    };

    const updatedLead = await saveLeadQualificationResult({
      businessId: params.businessId,
      leadId: lead.id,
      score: finalScore,
      summary: String(parsed.summary || '').trim(),
      breakdown,
      status: disposition,
    });

    const durationMs = Date.now() - startedMs;

    await db
      .update(agentRuns)
      .set({
        status: 'completed',
        durationMs,
        summary: `Scored ${lead.firstName} ${lead.lastName} (${lead.companyName}) at ${finalScore}/100 (${disposition}).`,
        structuredOutput: {
          score: finalScore,
          disposition,
          missingCount: breakdown.missingInformation.length,
          breakdown,
        },
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, agentRun.id));

    await logActivity({
      businessId: params.businessId,
      actorProfileId: params.actorProfileId || null,
      actorType: 'agent',
      actorName: 'Agent A · Lead Qualification',
      eventType: 'agent.qualification.completed',
      severity: 'success',
      entityType: 'lead',
      entityId: lead.id,
      message: `Evaluated ${lead.firstName} ${lead.lastName} (${lead.companyName}): ${finalScore}/100 (${disposition}). Flagged ${breakdown.missingInformation.length} missing fields.`,
      metadata: { score: finalScore, disposition, durationMs },
    });

    return {
      lead: updatedLead,
      score: finalScore,
      disposition,
      summary: String(parsed.summary || '').trim(),
      breakdown,
      agentRunId: agentRun.id,
    };
  } catch (error) {
    const durationMs = Date.now() - startedMs;
    const classified = classifyWorkflowError(error);
    await db
      .update(agentRuns)
      .set({
        status: 'failed',
        durationMs,
        errorMessage: classified.cleanMessage,
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, agentRun.id));
    throw error;
  }
}

// ============================================================================
// AGENT B: Sales Outreach Agent (Human Approval Required)
// ============================================================================
export async function runSalesOutreachAgent(params: {
  businessId: string;
  leadId: string;
  businessName: string;
  valueProposition: string;
  senderName: string;
  senderRole: string;
  toneOfVoice: string;
  workflowRunId?: string | null;
  actorProfileId?: string | null;
}) {
  const startedMs = Date.now();
  const lead = await getLeadById(params.businessId, params.leadId);
  if (!lead) {
    throw new ClassifiedWorkflowError('Lead record not found in workspace.', 'validation', false);
  }

  const insertedRunRows = await db
    .insert(agentRuns)
    .values({
      businessId: params.businessId,
      workflowRunId: params.workflowRunId || null,
      leadId: lead.id,
      agentKey: 'sales_outreach',
      agentName: 'Agent B · Sales Outreach Agent',
      modelUsed: GEMINI_MODEL,
      status: 'running',
    })
    .returning();
  const agentRun = insertedRunRows[0];

  try {
    const ai = getGeminiClient();

    const verifiedFacts = {
      recipientFirstName: lead.firstName,
      recipientLastName: lead.lastName,
      recipientEmail: lead.email,
      jobTitle: lead.jobTitle || null,
      companyName: lead.companyName,
      industry: lead.industry || null,
      companySize: lead.companySize || null,
      estimatedBudgetUsd: lead.estimatedBudgetUsd || null,
      inboundSource: lead.source,
      statedPainPoints: lead.painPoints || null,
      crmNotes: lead.notes || null,
      qualificationScore: lead.qualificationScore,
      qualificationSummary: lead.qualificationSummary || null,
      knownMissingInformation: lead.qualificationBreakdown?.missingInformation || [],
    };

    const prompt = `Draft a personalized B2B outreach email for this lead using ONLY verified facts from the database record below.

STRICT NON-HALLUCINATION RULES:
1. NEVER invent customer achievements, funding rounds, team metrics, software stack, or quotes that do not appear in Verified Lead Data.
2. If specific details (like budget or timeline) are listed in knownMissingInformation, gracefully invite the prospect to clarify them on a brief discovery call rather than assuming them.
3. Sign off using Sender Name ("${params.senderName}"), Sender Role ("${params.senderRole}"), and Business Name ("${params.businessName}").
4. Tone of voice: ${params.toneOfVoice}.
5. List the exact verified fields you referenced in "verifiedFactsUsed".

Sender Context:
- Company: ${params.businessName}
- Value Proposition: ${params.valueProposition}
- Sender: ${params.senderName}, ${params.senderRole}

Verified Lead Data:
${JSON.stringify(verifiedFacts, null, 2)}`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction:
          'You are Agent B (Sales Outreach Agent) in AI Workforce. Write concise, high-trust, human-sounding B2B emails strictly grounded in verified CRM fields.',
        temperature: 0.35,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body: { type: Type.STRING },
            personalizationRationale: { type: Type.STRING },
            suggestedNextStep: { type: Type.STRING },
            verifiedFactsUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            'subject',
            'body',
            'personalizationRationale',
            'suggestedNextStep',
            'verifiedFactsUsed',
          ],
        },
      },
    });

    const rawText = response.text?.trim();
    if (!rawText) {
      throw new ClassifiedWorkflowError(
        'Outreach agent returned an empty draft payload.',
        'transient_network',
        true
      );
    }

    const parsed = JSON.parse(rawText);

    const insertedDrafts = await db
      .insert(outreachDrafts)
      .values({
        businessId: params.businessId,
        leadId: lead.id,
        workflowRunId: params.workflowRunId || null,
        agentRunId: agentRun.id,
        subject: String(parsed.subject || '').trim(),
        body: String(parsed.body || '').trim(),
        personalizationRationale: String(parsed.personalizationRationale || '').trim(),
        suggestedNextStep: String(parsed.suggestedNextStep || '').trim(),
        verifiedFactsUsed: Array.isArray(parsed.verifiedFactsUsed)
          ? parsed.verifiedFactsUsed.slice(0, 10)
          : [],
        status: 'pending_approval',
        deliveryMode: 'simulated_safe_mode',
        deliveryNote: 'Queued for mandatory human approval. No external email has been sent.',
      })
      .returning();

    const draft = insertedDrafts[0];

    const insertedApprovals = await db
      .insert(approvals)
      .values({
        businessId: params.businessId,
        outreachDraftId: draft.id,
        workflowRunId: params.workflowRunId || null,
        leadId: lead.id,
        approvalType: 'outreach_email',
        status: 'pending',
      })
      .returning();

    const approval = insertedApprovals[0];

    await db
      .update(leads)
      .set({
        status: 'outreach_pending',
        updatedAt: new Date(),
      })
      .where(and(eq(leads.businessId, params.businessId), eq(leads.id, lead.id)));

    const durationMs = Date.now() - startedMs;

    await db
      .update(agentRuns)
      .set({
        status: 'completed',
        durationMs,
        summary: `Generated outreach draft "${draft.subject}" for ${lead.firstName} ${lead.lastName}; queued for human approval.`,
        structuredOutput: {
          draftId: draft.id,
          approvalId: approval.id,
          subject: draft.subject,
          verifiedFactsUsed: draft.verifiedFactsUsed,
        },
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, agentRun.id));

    await logActivity({
      businessId: params.businessId,
      actorProfileId: params.actorProfileId || null,
      actorType: 'agent',
      actorName: 'Agent B · Sales Outreach',
      eventType: 'agent.outreach.draft_queued',
      severity: 'info',
      entityType: 'draft',
      entityId: draft.id,
      message: `Created personalized draft "${draft.subject}" for ${lead.companyName}. Placed in Approval Center (external send locked until human approval).`,
      metadata: { draftId: draft.id, approvalId: approval.id, durationMs },
    });

    return { draft, approval, agentRunId: agentRun.id };
  } catch (error) {
    const durationMs = Date.now() - startedMs;
    const classified = classifyWorkflowError(error);
    await db
      .update(agentRuns)
      .set({
        status: 'failed',
        durationMs,
        errorMessage: classified.cleanMessage,
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, agentRun.id));
    throw error;
  }
}

// ============================================================================
// AGENT C: Workflow Coordinator & Self-Healing Orchestrator
// ============================================================================
export async function executeCoordinatedWorkflow(params: {
  businessId: string;
  leadId: string;
  actorProfileId: string;
  actorName: string;
  businessName: string;
  valueProposition: string;
  senderName: string;
  senderRole: string;
  criteria: QualificationCriteria;
  idempotencyKey?: string;
  faultInjectionMode?: string;
}) {
  const workflowStartMs = Date.now();
  const lead = await getLeadById(params.businessId, params.leadId);
  if (!lead) {
    throw new Error('Selected lead does not exist in your workspace.');
  }

  const effectiveIdempotencyKey =
    params.idempotencyKey?.trim() ||
    `wf:${params.businessId}:${params.leadId}:${Math.floor(Date.now() / 15000)}`;

  // Idempotency check: prevent duplicate workflow execution for identical key
  const existingRunRows = await db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.businessId, params.businessId),
        eq(workflowRuns.idempotencyKey, effectiveIdempotencyKey)
      )
    )
    .limit(1);

  if (existingRunRows.length > 0) {
    const existingSteps = await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowRunId, existingRunRows[0].id));

    return {
      workflowRun: {
        ...existingRunRows[0],
        leadName: `${lead.firstName} ${lead.lastName}`,
        leadCompany: lead.companyName,
        steps: existingSteps.sort((a, b) => a.stepOrder - b.stepOrder),
      },
      deduplicated: true,
    };
  }

  const maxRetries = Math.max(0, Math.min(5, params.criteria.maxWorkflowRetries ?? 2));
  const faultMode =
    params.faultInjectionMode && params.faultInjectionMode !== 'default'
      ? params.faultInjectionMode
      : lead.simulatedFaultMode || 'none';

  const insertedWorkflowRows = await db
    .insert(workflowRuns)
    .values({
      businessId: params.businessId,
      leadId: lead.id,
      triggeredByProfileId: params.actorProfileId,
      idempotencyKey: effectiveIdempotencyKey,
      workflowType: 'lead_to_outreach',
      status: 'running',
      currentStep: 'load_and_validate_lead',
      retryCount: 0,
      maxRetries,
    })
    .returning();

  const run = insertedWorkflowRows[0];

  const coordinatorAgentRows = await db
    .insert(agentRuns)
    .values({
      businessId: params.businessId,
      workflowRunId: run.id,
      leadId: lead.id,
      agentKey: 'workflow_coordinator',
      agentName: 'Agent C · Workflow Coordinator',
      modelUsed: GEMINI_MODEL,
      status: 'running',
    })
    .returning();
  const coordinatorAgentRun = coordinatorAgentRows[0];

  const stepDefinitions = [
    {
      stepOrder: 1,
      stepKey: 'load_and_validate_lead',
      stepName: 'Load & Validate Lead Record',
      agentKey: 'workflow_coordinator',
    },
    {
      stepOrder: 2,
      stepKey: 'agent_qualification',
      stepName: 'Agent A · Qualification & Fit Scoring',
      agentKey: 'lead_research',
    },
    {
      stepOrder: 3,
      stepKey: 'agent_outreach_draft',
      stepName: 'Agent B · Personalized Follow-Up Draft',
      agentKey: 'sales_outreach',
    },
    {
      stepOrder: 4,
      stepKey: 'queue_human_approval',
      stepName: 'Human Approval Gate',
      agentKey: 'workflow_coordinator',
    },
  ];

  const insertedSteps = await db
    .insert(workflowSteps)
    .values(
      stepDefinitions.map((s) => ({
        workflowRunId: run.id,
        businessId: params.businessId,
        stepOrder: s.stepOrder,
        stepKey: s.stepKey,
        stepName: s.stepName,
        agentKey: s.agentKey,
        status: 'pending',
        attemptCount: 0,
      }))
    )
    .returning();

  const stepByKey = new Map(insertedSteps.map((s) => [s.stepKey, s]));
  let totalRetriesUsed = 0;
  const recoveryNotes: string[] = [];

  // Helper to run any step with bounded retry & self-healing classification
  async function runStepWithRecovery<T>(
    stepKey: string,
    fn: (attempt: number) => Promise<{ result: T; healedNote?: string }>
  ): Promise<T> {
    const stepRecord = stepByKey.get(stepKey)!;
    await db
      .update(workflowRuns)
      .set({ currentStep: stepKey })
      .where(eq(workflowRuns.id, run.id));

    let attempt = 0;
    let hadPriorFailure = false;
    let firstFailureMessage: string | null = null;
    let firstFailureCategory: ErrorCategory | null = null;

    while (true) {
      attempt += 1;
      await db
        .update(workflowSteps)
        .set({
          status: attempt > 1 ? 'retrying' : 'running',
          attemptCount: attempt,
          startedAt: attempt === 1 ? new Date() : undefined,
        })
        .where(eq(workflowSteps.id, stepRecord.id));

      try {
        const { result, healedNote } = await fn(attempt);

        const wasHealed = hadPriorFailure || Boolean(healedNote);
        const finalHealingAction =
          healedNote ||
          (hadPriorFailure
            ? `Recovered on attempt ${attempt}/${maxRetries + 1} after ${firstFailureCategory} error ("${firstFailureMessage}").`
            : null);

        if (finalHealingAction) {
          recoveryNotes.push(finalHealingAction);
        }

        await db
          .update(workflowSteps)
          .set({
            status: wasHealed ? 'healed' : 'completed',
            healingAction: finalHealingAction,
            outputPayload:
              typeof result === 'object' && result !== null
                ? (result as Record<string, unknown>)
                : { completed: true },
            completedAt: new Date(),
          })
          .where(eq(workflowSteps.id, stepRecord.id));

        if (hadPriorFailure) {
          await logActivity({
            businessId: params.businessId,
            actorProfileId: params.actorProfileId,
            actorType: 'self_healing',
            actorName: 'Self-Healing Engine',
            eventType: 'workflow.step_recovered',
            severity: 'success',
            entityType: 'workflow',
            entityId: run.id,
            message: `Step "${stepRecord.stepName}" recovered on attempt ${attempt} and passed verification.`,
            metadata: {
              stepKey,
              attempt,
              originalCategory: firstFailureCategory,
              originalError: firstFailureMessage,
            },
          });
        }

        return result;
      } catch (err) {
        const classified = classifyWorkflowError(err);
        hadPriorFailure = true;
        if (!firstFailureMessage) {
          firstFailureMessage = classified.cleanMessage;
          firstFailureCategory = classified.category;
        }

        await logActivity({
          businessId: params.businessId,
          actorProfileId: params.actorProfileId,
          actorType: 'self_healing',
          actorName: 'Self-Healing Engine',
          eventType: 'workflow.step_error_detected',
          severity: classified.retryable && attempt <= maxRetries ? 'warning' : 'error',
          entityType: 'workflow',
          entityId: run.id,
          message: `Step "${stepRecord.stepName}" failed on attempt ${attempt} [${classified.category}]: ${classified.cleanMessage}`,
          metadata: {
            stepKey,
            attempt,
            maxRetries,
            errorCategory: classified.category,
            retryable: classified.retryable,
          },
        });

        if (classified.retryable && attempt <= maxRetries) {
          totalRetriesUsed += 1;
          await db
            .update(workflowRuns)
            .set({
              status: 'recovering',
              retryCount: totalRetriesUsed,
              errorCategory: classified.category,
              errorMessage: classified.cleanMessage,
            })
            .where(eq(workflowRuns.id, run.id));

          await sleep(550 * attempt);
          continue;
        }

        // Cannot auto-recover: stop and request human intervention
        await db
          .update(workflowSteps)
          .set({
            status: 'failed',
            errorCategory: classified.category,
            errorMessage: classified.cleanMessage,
            completedAt: new Date(),
          })
          .where(eq(workflowSteps.id, stepRecord.id));

        throw new ClassifiedWorkflowError(
          classified.cleanMessage,
          classified.category,
          classified.retryable
        );
      }
    }
  }

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Load & Validate Lead Record (+ Deterministic / Consequential Repair)
    // -------------------------------------------------------------------------
    let activeLead = lead;

    if (faultMode === 'permission_denied') {
      const step1 = stepByKey.get('load_and_validate_lead')!;
      await db
        .update(workflowSteps)
        .set({
          status: 'failed',
          attemptCount: 1,
          errorCategory: 'permission',
          errorMessage: 'Permission policy blocked outbound workflow execution for restricted record.',
          startedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(workflowSteps.id, step1.id));

      throw new ClassifiedWorkflowError(
        'Permission policy blocked outbound workflow execution for restricted record. Bounded retries skipped for permission errors.',
        'permission',
        false
      );
    }

    if (faultMode === 'consequential_correction') {
      const step1 = stepByKey.get('load_and_validate_lead')!;
      const candidateDomain =
        (activeLead.companyWebsite || '')
          .replace(/^https?:\/\//i, '')
          .replace(/^www\./i, '')
          .split('/')[0] || 'company-domain.com';
      const proposedEmail = `${activeLead.firstName.toLowerCase()}.${activeLead.lastName.toLowerCase()}@${candidateDomain}`;

      await db.insert(approvals).values({
        businessId: params.businessId,
        workflowRunId: run.id,
        leadId: activeLead.id,
        approvalType: 'data_correction',
        status: 'pending',
        proposedChanges: {
          field: 'email',
          previousValue: activeLead.email,
          correctedEmail: proposedEmail,
          reason:
            'Consequential contact domain reconstruction proposed by AI validator; requires explicit human approval before modifying lead email.',
        },
      });

      await db
        .update(workflowSteps)
        .set({
          status: 'requires_approval',
          attemptCount: 1,
          errorCategory: 'validation',
          errorMessage: 'Lead contact domain requires consequential reconstruction.',
          healingAction: `Paused workflow and queued proposed email "${proposedEmail}" in Approval Center for human sign-off.`,
          startedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(workflowSteps.id, step1.id));

      await db
        .update(workflowRuns)
        .set({
          status: 'needs_human_intervention',
          errorCategory: 'validation',
          errorMessage: 'Consequential contact change requires human approval before continuing.',
          recoverySummary: `Proposed contact repair (${proposedEmail}) queued in Approval Center.`,
          outcome: 'Paused safely awaiting human approval of consequential data correction.',
          completedAt: new Date(),
        })
        .where(eq(workflowRuns.id, run.id));

      await logActivity({
        businessId: params.businessId,
        actorProfileId: params.actorProfileId,
        actorType: 'self_healing',
        actorName: 'Self-Healing Engine',
        eventType: 'workflow.consequential_approval_requested',
        severity: 'warning',
        entityType: 'workflow',
        entityId: run.id,
        message: `Paused workflow for ${activeLead.companyName}: consequential contact update (${proposedEmail}) requires human approval.`,
      });

      const refreshedSteps = await db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.workflowRunId, run.id));
      const finalRunRows = await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, run.id));

      return {
        workflowRun: {
          ...finalRunRows[0],
          leadName: `${activeLead.firstName} ${activeLead.lastName}`,
          leadCompany: activeLead.companyName,
          steps: refreshedSteps.sort((a, b) => a.stepOrder - b.stepOrder),
        },
        deduplicated: false,
      };
    }

    await runStepWithRecovery<Record<string, unknown>>('load_and_validate_lead', async () => {
      const emailToValidate =
        faultMode === 'malformed_email' && STRICT_EMAIL_REGEX.test(activeLead.email)
          ? activeLead.email.replace('@', ' @@ ')
          : activeLead.email;

      const check = attemptDeterministicEmailRepair(emailToValidate);
      if (check.valid) {
        return {
          result: {
            leadId: activeLead.id,
            verifiedEmail: activeLead.email,
            companyName: activeLead.companyName,
          },
        };
      }

      if (check.repairedEmail && check.ruleApplied) {
        await logActivity({
          businessId: params.businessId,
          actorProfileId: params.actorProfileId,
          actorType: 'self_healing',
          actorName: 'Self-Healing Engine',
          eventType: 'workflow.validation_defect_healed',
          severity: 'warning',
          entityType: 'lead',
          entityId: activeLead.id,
          message: `Detected malformed email "${emailToValidate}" on ${activeLead.companyName}. Applied deterministic normalization -> "${check.repairedEmail}".`,
          metadata: {
            originalEmail: emailToValidate,
            repairedEmail: check.repairedEmail,
            rule: check.ruleApplied,
          },
        });

        const updatedRows = await db
          .update(leads)
          .set({
            email: check.repairedEmail,
            simulatedFaultMode: 'none',
            updatedAt: new Date(),
          })
          .where(and(eq(leads.businessId, params.businessId), eq(leads.id, activeLead.id)))
          .returning();

        activeLead = updatedRows[0] || activeLead;

        return {
          result: {
            leadId: activeLead.id,
            originalInvalidEmail: emailToValidate,
            repairedEmail: check.repairedEmail,
          },
          healedNote: `${check.ruleApplied} ("${emailToValidate}" -> "${check.repairedEmail}").`,
        };
      }

      throw new ClassifiedWorkflowError(
        `Lead email "${activeLead.email}" failed RFC validation and cannot be deterministically repaired without human input.`,
        'validation',
        false
      );
    });

    // -------------------------------------------------------------------------
    // STEP 2: Agent A — Qualification & Missing-Information Audit
    // -------------------------------------------------------------------------
    const qualificationResult = await runStepWithRecovery('agent_qualification', async (attempt) => {
      if (faultMode === 'transient_network' && attempt === 1) {
        throw new ClassifiedWorkflowError(
          'Simulated transient network socket reset while contacting qualification model.',
          'transient_network',
          true
        );
      }
      if (faultMode === 'rate_limit' && attempt === 1) {
        throw new ClassifiedWorkflowError(
          'Simulated 429 rate-limit response from upstream model gateway.',
          'rate_limit',
          true
        );
      }

      const res = await runLeadQualificationAgent({
        businessId: params.businessId,
        leadId: activeLead.id,
        criteria: params.criteria,
        businessName: params.businessName,
        businessValueProp: params.valueProposition,
        workflowRunId: run.id,
        actorProfileId: params.actorProfileId,
      });

      // Clear one-time demo fault mode once recovered
      if (activeLead.simulatedFaultMode && activeLead.simulatedFaultMode !== 'none') {
        await db
          .update(leads)
          .set({ simulatedFaultMode: 'none' })
          .where(eq(leads.id, activeLead.id));
      }

      return {
        result: {
          score: res.score,
          disposition: res.disposition,
          missingFieldsCount: res.breakdown.missingInformation.length,
        },
      };
    });

    // Check auto-draft threshold
    if (qualificationResult.score < params.criteria.autoDraftMinScore) {
      // Skip outreach draft for low-fit leads cleanly
      const step3 = stepByKey.get('agent_outreach_draft')!;
      const step4 = stepByKey.get('queue_human_approval')!;
      const skipNow = new Date();

      await db
        .update(workflowSteps)
        .set({
          status: 'skipped',
          outputPayload: {
            reason: `Lead score (${qualificationResult.score}/100) is below configured auto-draft threshold (${params.criteria.autoDraftMinScore}/100).`,
          },
          startedAt: skipNow,
          completedAt: skipNow,
        })
        .where(eq(workflowSteps.id, step3.id));

      await db
        .update(workflowSteps)
        .set({
          status: 'skipped',
          outputPayload: {
            reason: 'No outreach draft generated because lead scored below threshold.',
          },
          startedAt: skipNow,
          completedAt: skipNow,
        })
        .where(eq(workflowSteps.id, step4.id));

      const recoveryText = recoveryNotes.length > 0 ? recoveryNotes.join(' ') : null;

      await db
        .update(workflowRuns)
        .set({
          status: 'completed',
          currentStep: null,
          retryCount: totalRetriesUsed,
          recoverySummary: recoveryText,
          outcome: `Evaluated at ${qualificationResult.score}/100 (${qualificationResult.disposition}). Outreach skipped per minimum score threshold (${params.criteria.autoDraftMinScore}).`,
          completedAt: skipNow,
        })
        .where(eq(workflowRuns.id, run.id));

      await db
        .update(agentRuns)
        .set({
          status: 'completed',
          durationMs: Date.now() - workflowStartMs,
          summary: `Completed workflow for ${activeLead.companyName} (${qualificationResult.score}/100); outreach skipped below threshold.`,
          completedAt: skipNow,
        })
        .where(eq(agentRuns.id, coordinatorAgentRun.id));

      const finalSteps = await db
        .select()
        .from(workflowSteps)
        .where(eq(workflowSteps.workflowRunId, run.id));
      const finalRunRows = await db.select().from(workflowRuns).where(eq(workflowRuns.id, run.id));

      return {
        workflowRun: {
          ...finalRunRows[0],
          leadName: `${activeLead.firstName} ${activeLead.lastName}`,
          leadCompany: activeLead.companyName,
          steps: finalSteps.sort((a, b) => a.stepOrder - b.stepOrder),
        },
        deduplicated: false,
      };
    }

    // -------------------------------------------------------------------------
    // STEP 3: Agent B — Personalized Outreach Draft
    // -------------------------------------------------------------------------
    const outreachResult = await runStepWithRecovery('agent_outreach_draft', async () => {
      const res = await runSalesOutreachAgent({
        businessId: params.businessId,
        leadId: activeLead.id,
        businessName: params.businessName,
        valueProposition: params.valueProposition,
        senderName: params.senderName,
        senderRole: params.senderRole,
        toneOfVoice: params.criteria.toneOfVoice,
        workflowRunId: run.id,
        actorProfileId: params.actorProfileId,
      });

      return {
        result: {
          draftId: res.draft.id,
          approvalId: res.approval.id,
          subject: res.draft.subject,
        },
      };
    });

    // -------------------------------------------------------------------------
    // STEP 4: Queue Human Approval Gate (Pause until human approves/rejects)
    // -------------------------------------------------------------------------
    const step4 = stepByKey.get('queue_human_approval')!;
    const gateNow = new Date();
    await db
      .update(workflowSteps)
      .set({
        status: 'requires_approval',
        attemptCount: 1,
        startedAt: gateNow,
        outputPayload: {
          approvalId: outreachResult.approvalId,
          draftId: outreachResult.draftId,
          policy: 'Mandatory human approval required before any external message dispatch.',
        },
      })
      .where(eq(workflowSteps.id, step4.id));

    const recoveryText = recoveryNotes.length > 0 ? recoveryNotes.join(' ') : null;

    await db
      .update(workflowRuns)
      .set({
        status: 'awaiting_approval',
        currentStep: 'queue_human_approval',
        retryCount: totalRetriesUsed,
        errorCategory: null,
        errorMessage: null,
        recoverySummary: recoveryText,
        outcome: `Qualified (${qualificationResult.score}/100) and queued draft "${outreachResult.subject}" in Approval Center.`,
      })
      .where(eq(workflowRuns.id, run.id));

    await db
      .update(agentRuns)
      .set({
        status: 'completed',
        durationMs: Date.now() - workflowStartMs,
        summary: `Coordinated qualification (${qualificationResult.score}/100) and outreach draft for ${activeLead.companyName}. Retries used: ${totalRetriesUsed}.`,
        structuredOutput: {
          qualificationScore: qualificationResult.score,
          draftId: outreachResult.draftId,
          approvalId: outreachResult.approvalId,
          retriesUsed: totalRetriesUsed,
          healed: Boolean(recoveryText),
        },
        completedAt: gateNow,
      })
      .where(eq(agentRuns.id, coordinatorAgentRun.id));

    await logActivity({
      businessId: params.businessId,
      actorProfileId: params.actorProfileId,
      actorType: 'agent',
      actorName: 'Agent C · Workflow Coordinator',
      eventType: 'workflow.awaiting_approval',
      severity: 'success',
      entityType: 'workflow',
      entityId: run.id,
      message: `Workflow for ${activeLead.companyName} reached Approval Center (${qualificationResult.score}/100)${recoveryText ? ' after verified self-healing recovery' : ''}.`,
      metadata: {
        retriesUsed: totalRetriesUsed,
        recoverySummary: recoveryText,
        approvalId: outreachResult.approvalId,
      },
    });

    const finalSteps = await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowRunId, run.id));
    const finalRunRows = await db.select().from(workflowRuns).where(eq(workflowRuns.id, run.id));

    return {
      workflowRun: {
        ...finalRunRows[0],
        leadName: `${activeLead.firstName} ${activeLead.lastName}`,
        leadCompany: activeLead.companyName,
        steps: finalSteps.sort((a, b) => a.stepOrder - b.stepOrder),
      },
      deduplicated: false,
    };
  } catch (err) {
    const classified = classifyWorkflowError(err);
    const failNow = new Date();

    await db
      .update(workflowRuns)
      .set({
        status: 'needs_human_intervention',
        retryCount: totalRetriesUsed,
        errorCategory: classified.category,
        errorMessage: classified.cleanMessage,
        recoverySummary:
          totalRetriesUsed > 0
            ? `Attempted ${totalRetriesUsed} bounded retries; halted safely and escalated for human intervention.`
            : 'Halted safely on non-retryable error; escalated for human intervention.',
        outcome: `Stopped (${classified.category}): ${classified.cleanMessage}`,
        completedAt: failNow,
      })
      .where(eq(workflowRuns.id, run.id));

    await db
      .update(agentRuns)
      .set({
        status: 'failed',
        durationMs: Date.now() - workflowStartMs,
        errorMessage: classified.cleanMessage,
        completedAt: failNow,
      })
      .where(eq(agentRuns.id, coordinatorAgentRun.id));

    await logActivity({
      businessId: params.businessId,
      actorProfileId: params.actorProfileId,
      actorType: 'agent',
      actorName: 'Agent C · Workflow Coordinator',
      eventType: 'workflow.intervention_required',
      severity: 'error',
      entityType: 'workflow',
      entityId: run.id,
      message: `Workflow halted for ${lead.companyName} (${classified.category}) and escalated for human intervention: ${classified.cleanMessage}`,
      metadata: {
        errorCategory: classified.category,
        retriesUsed: totalRetriesUsed,
      },
    });

    const finalSteps = await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowRunId, run.id));
    const finalRunRows = await db.select().from(workflowRuns).where(eq(workflowRuns.id, run.id));

    return {
      workflowRun: {
        ...finalRunRows[0],
        leadName: `${lead.firstName} ${lead.lastName}`,
        leadCompany: lead.companyName,
        steps: finalSteps.sort((a, b) => a.stepOrder - b.stepOrder),
      },
      deduplicated: false,
    };
  }
}

// ============================================================================
// AGENT D: Business Insights Agent (Strictly Database-Grounded)
// ============================================================================
export async function runBusinessInsightsAgent(params: {
  businessId: string;
  businessName: string;
  actorProfileId: string;
}) {
  const startedMs = Date.now();
  const metrics = await computeDashboardMetrics(params.businessId);

  const insertedRunRows = await db
    .insert(agentRuns)
    .values({
      businessId: params.businessId,
      agentKey: 'business_insights',
      agentName: 'Agent D · Business Insights Agent',
      modelUsed: GEMINI_MODEL,
      status: 'running',
    })
    .returning();
  const agentRun = insertedRunRows[0];

  try {
    const ai = getGeminiClient();

    const verifiedSnapshot = {
      counts: metrics.counts,
      rates: metrics.rates,
      pipelineByStatus: metrics.pipelineByStatus,
      scoreDistribution: metrics.scoreDistribution,
    };

    const prompt = `Analyze the persisted pipeline and workflow database metrics for "${params.businessName}".

STRICT NUMERICAL INTEGRITY RULES:
1. Base EVERY numerical claim strictly on the JSON metrics below. Never invent revenue numbers, industry benchmarks, or conversion figures not present in the snapshot.
2. If totalLeads < 5 or evaluated leads are sparse, explicitly state that sample size is limited and label directional guidance as an "Estimate / Early Indicator".
3. Differentiate between real customer leads (${metrics.counts.realLeads}) and sample demo leads (${metrics.counts.demoLeads}).
4. Highlight pending human approvals (${metrics.counts.pendingApprovals}) and any workflows requiring human intervention (${metrics.counts.failedOrInterventionWorkflows}).

Verified Database Metrics Snapshot:
${JSON.stringify(verifiedSnapshot, null, 2)}`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction:
          'You are Agent D (Business Insights Agent) in AI Workforce. Deliver factual, audit-grade operational analysis grounded 100% in persisted SQL counts.',
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveHeadline: { type: Type.STRING },
            dataConfidenceLabel: { type: Type.STRING },
            keyFindings: { type: Type.ARRAY, items: { type: Type.STRING } },
            operationalBottlenecks: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            'executiveHeadline',
            'dataConfidenceLabel',
            'keyFindings',
            'operationalBottlenecks',
            'recommendedActions',
          ],
        },
      },
    });

    const rawText = response.text?.trim();
    if (!rawText) {
      throw new Error('Business Insights model returned an empty analysis.');
    }

    const parsed = JSON.parse(rawText);
    const durationMs = Date.now() - startedMs;

    const updatedRows = await db
      .update(agentRuns)
      .set({
        status: 'completed',
        durationMs,
        summary: String(parsed.executiveHeadline || '').trim(),
        structuredOutput: {
          executiveHeadline: parsed.executiveHeadline,
          dataConfidenceLabel: parsed.dataConfidenceLabel,
          keyFindings: parsed.keyFindings,
          operationalBottlenecks: parsed.operationalBottlenecks,
          recommendedActions: parsed.recommendedActions,
          verifiedCountsAtRun: metrics.counts,
        },
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, agentRun.id))
      .returning();

    await logActivity({
      businessId: params.businessId,
      actorProfileId: params.actorProfileId,
      actorType: 'agent',
      actorName: 'Agent D · Business Insights',
      eventType: 'agent.insights.generated',
      severity: 'info',
      entityType: 'agent',
      entityId: agentRun.id,
      message: `Generated database-verified pipeline briefing across ${metrics.counts.totalLeads} leads (${metrics.counts.realLeads} customer, ${metrics.counts.demoLeads} demo).`,
      metadata: { durationMs, dataConfidenceLabel: parsed.dataConfidenceLabel },
    });

    return updatedRows[0];
  } catch (error) {
    const durationMs = Date.now() - startedMs;
    const classified = classifyWorkflowError(error);
    await db
      .update(agentRuns)
      .set({
        status: 'failed',
        durationMs,
        errorMessage: classified.cleanMessage,
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, agentRun.id));
    throw new Error(classified.cleanMessage);
  }
}
