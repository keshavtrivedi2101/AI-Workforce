import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { type AuthRequest, createRateLimiter, requireAuth } from './src/middleware/auth.ts';
import {
  computeDashboardMetrics,
  createLeadRecord,
  decideApprovalItem,
  deleteLeadRecord,
  getLeadDetailsBundle,
  importSampleDemoLeads,
  listActivityLogs,
  listAgentRuns,
  listApprovalsBundle,
  listBusinessLeads,
  listToolInvocations,
  listWorkflowRunsWithSteps,
  updateBusinessSettings,
  updateLeadRecord,
} from './src/db/repository.ts';
import {
  executeCoordinatedWorkflow,
  runBusinessInsightsAgent,
  runLeadQualificationAgent,
  runSalesOutreachAgent,
} from './src/server/agents.ts';
import {
  executeBusinessDirective,
  triggerTestConnectorRelay,
} from './src/server/planner.ts';
import { loginLocalAccount, registerLocalAccount } from './src/server/localAuth.ts';
import { buildWindowsDesktopExe } from './src/server/exeBuilder.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

function cleanString(val: unknown, maxLen = 1000): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function parseOptionalInt(val: unknown, min = 0, max = 100_000_000): number | null {
  if (val === null || val === undefined || val === '') return null;
  const parsed = Number(val);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use(express.json({ limit: '256kb' }));

  const standardLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 120,
    label: 'workspace API',
  });

  const aiActionLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
    label: 'AI agent execution',
  });

  const authLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 25,
    label: 'authentication',
  });

  // ---------------------------------------------------------------------------
  // Native Windows 64-bit Desktop Executable Download (.exe)
  // ---------------------------------------------------------------------------
  app.get('/api/download/windows-exe', standardLimiter, (req: Request, res: Response) => {
    const defaultSharedUrl =
      'https://ais-pre-botgw4iqxna2lg7uvxkreg-442298881070.asia-east1.run.app';
    const forwardedHost = cleanString(req.headers['x-forwarded-host'], 200);
    const forwardedProto = cleanString(req.headers['x-forwarded-proto'], 10) || 'https';
    const rawEnvUrl = process.env.SHARED_APP_URL || process.env.APP_URL || '';

    let targetUrl = defaultSharedUrl;
    if (rawEnvUrl && rawEnvUrl.startsWith('http') && !rawEnvUrl.includes('MY_APP_URL')) {
      targetUrl = rawEnvUrl.replace('://ais-dev-', '://ais-pre-');
    } else if (forwardedHost && !forwardedHost.startsWith('localhost')) {
      targetUrl = `${forwardedProto}://${forwardedHost.replace(/^ais-dev-/, 'ais-pre-')}`;
    }

    const exeBuffer = buildWindowsDesktopExe(targetUrl);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="AI-Workforce.exe"');
    res.setHeader('Content-Length', String(exeBuffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.send(exeBuffer);
  });

  // ---------------------------------------------------------------------------
  // First-Party PostgreSQL Email & Password Authentication
  // ---------------------------------------------------------------------------
  app.post('/api/auth/register', authLimiter, async (req: Request, res: Response) => {
    const fullName = cleanString(req.body?.fullName, 120);
    const email = cleanString(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!fullName) {
      return res.status(400).json({ error: 'Please enter your full name.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid work email address.' });
    }
    if (password.length < 8 || password.length > 128) {
      return res
        .status(400)
        .json({ error: 'Password must be between 8 and 128 characters long.' });
    }

    try {
      const result = await registerLocalAccount({ fullName, email, password });
      res.status(201).json({
        token: result.token,
        provider: 'local',
        workspace: result.workspace,
      });
    } catch (error: any) {
      const status = error.message?.includes('already exists') ? 409 : 400;
      res.status(status).json({ error: error.message || 'Unable to register account.' });
    }
  });

  app.post('/api/auth/login', authLimiter, async (req: Request, res: Response) => {
    const email = cleanString(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter both your email address and password.' });
    }

    try {
      const result = await loginLocalAccount({ email, password });
      res.json({
        token: result.token,
        provider: 'local',
        workspace: result.workspace,
      });
    } catch (error: any) {
      res.status(401).json({ error: error.message || 'Invalid email address or password.' });
    }
  });

  // ---------------------------------------------------------------------------
  // Workspace Session & Bootstrap
  // ---------------------------------------------------------------------------
  app.get('/api/workspace', requireAuth, standardLimiter, async (req: AuthRequest, res: Response) => {
    res.json({
      profile: req.authContext!.profile,
      business: req.authContext!.business,
      membership: req.authContext!.membership,
    });
  });

  // ---------------------------------------------------------------------------
  // Dashboard & Verified Business Insights
  // ---------------------------------------------------------------------------
  app.get('/api/dashboard', requireAuth, standardLimiter, async (req: AuthRequest, res: Response) => {
    try {
      const metrics = await computeDashboardMetrics(req.authContext!.business.id);
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unable to load dashboard metrics.' });
    }
  });

  // ---------------------------------------------------------------------------
  // Natural-Language Business Directive -> Orchestrator DAG Planner & Execution
  // ---------------------------------------------------------------------------
  app.post(
    '/api/directives/execute',
    requireAuth,
    aiActionLimiter,
    async (req: AuthRequest, res: Response) => {
      const directive = cleanString(req.body?.directive, 2000);
      if (!directive) {
        return res.status(400).json({
          error: 'Please enter a natural-language business request for the Orchestrator Agent.',
        });
      }

      const rawTargetLeadId = req.body?.targetLeadId;
      const targetLeadId = isValidUuid(rawTargetLeadId) ? rawTargetLeadId : null;

      const allowedFaultModes = new Set([
        'default',
        'none',
        'transient_network',
        'rate_limit',
        'malformed_email',
        'permission_denied',
      ]);
      const faultInjectionMode =
        typeof req.body?.faultInjectionMode === 'string' &&
        allowedFaultModes.has(req.body.faultInjectionMode)
          ? req.body.faultInjectionMode
          : 'none';

      const idempotencyKey = cleanString(req.body?.idempotencyKey, 180) || undefined;

      try {
        const ctx = req.authContext!;
        const result = await executeBusinessDirective({
          businessId: ctx.business.id,
          actorProfileId: ctx.profile.id,
          actorName: ctx.profile.fullName,
          businessName: ctx.business.name,
          valueProposition: ctx.business.valueProposition,
          senderName: ctx.business.senderName,
          senderRole: ctx.business.senderRole,
          criteria: ctx.business.qualificationCriteria,
          directive,
          targetLeadId,
          faultInjectionMode,
          idempotencyKey,
        });
        res.json(result);
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Orchestrator failed to plan and execute directive.',
        });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Connected Business Tools & Webhook Relay Inspector
  // ---------------------------------------------------------------------------
  app.get(
    '/api/tools/invocations',
    requireAuth,
    standardLimiter,
    async (req: AuthRequest, res: Response) => {
      try {
        const invocations = await listToolInvocations(req.authContext!.business.id);
        res.json({ invocations });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Unable to load tool invocations.' });
      }
    }
  );

  app.post(
    '/api/tools/test-relay',
    requireAuth,
    standardLimiter,
    async (req: AuthRequest, res: Response) => {
      const allowedConnectors = new Set([
        'postgres_crm',
        'google_sheets_sync',
        'airtable_pipeline',
        'webhook_outbox',
      ]);
      const connectorKey =
        typeof req.body?.connectorKey === 'string' && allowedConnectors.has(req.body.connectorKey)
          ? (req.body.connectorKey as
              | 'postgres_crm'
              | 'google_sheets_sync'
              | 'airtable_pipeline'
              | 'webhook_outbox')
          : 'webhook_outbox';

      try {
        const ctx = req.authContext!;
        const invocation = await triggerTestConnectorRelay({
          businessId: ctx.business.id,
          actorProfileId: ctx.profile.id,
          actorName: ctx.profile.fullName,
          connectorKey,
        });
        res.json({ invocation });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Connector relay test failed.' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Leads CRM (CRUD + Demo Import)
  // ---------------------------------------------------------------------------
  app.get('/api/leads', requireAuth, standardLimiter, async (req: AuthRequest, res: Response) => {
    try {
      const items = await listBusinessLeads(req.authContext!.business.id);
      res.json({ leads: items });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unable to fetch leads.' });
    }
  });

  app.post(
    '/api/leads/import-demo',
    requireAuth,
    standardLimiter,
    async (req: AuthRequest, res: Response) => {
      try {
        const ctx = req.authContext!;
        const result = await importSampleDemoLeads(
          ctx.business.id,
          ctx.profile.id,
          ctx.profile.fullName
        );
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Unable to import demo leads.' });
      }
    }
  );

  app.get('/api/leads/:id', requireAuth, standardLimiter, async (req: AuthRequest, res: Response) => {
    if (!isValidUuid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid lead identifier format.' });
    }
    try {
      const bundle = await getLeadDetailsBundle(req.authContext!.business.id, req.params.id);
      if (!bundle) {
        return res.status(404).json({ error: 'Lead not found in your business workspace.' });
      }
      res.json(bundle);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unable to load lead details.' });
    }
  });

  app.post('/api/leads', requireAuth, standardLimiter, async (req: AuthRequest, res: Response) => {
    const firstName = cleanString(req.body?.firstName, 100);
    const lastName = cleanString(req.body?.lastName, 100);
    const email = cleanString(req.body?.email, 254);
    const companyName = cleanString(req.body?.companyName, 160);

    if (!firstName || !lastName || !email || !companyName) {
      return res.status(400).json({
        error: 'First name, last name, email address, and company name are required.',
      });
    }

    try {
      const ctx = req.authContext!;
      const created = await createLeadRecord(ctx.business.id, ctx.profile.id, ctx.profile.fullName, {
        firstName,
        lastName,
        email,
        phone: cleanString(req.body?.phone, 60) || null,
        jobTitle: cleanString(req.body?.jobTitle, 120) || null,
        companyName,
        companyWebsite: cleanString(req.body?.companyWebsite, 250) || null,
        industry: cleanString(req.body?.industry, 100) || null,
        companySize: parseOptionalInt(req.body?.companySize, 1, 2_000_000),
        estimatedBudgetUsd: parseOptionalInt(req.body?.estimatedBudgetUsd, 0, 100_000_000),
        source: cleanString(req.body?.source, 80) || 'Manual CRM Entry',
        notes: cleanString(req.body?.notes, 2500) || null,
        painPoints: cleanString(req.body?.painPoints, 2500) || null,
        isDemo: Boolean(req.body?.isDemo),
        simulatedFaultMode: 'none',
      });
      res.status(201).json({ lead: created });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unable to create lead.' });
    }
  });

  app.patch(
    '/api/leads/:id',
    requireAuth,
    standardLimiter,
    async (req: AuthRequest, res: Response) => {
      if (!isValidUuid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid lead identifier format.' });
      }

      const allowedStatuses = new Set([
        'new',
        'qualifying',
        'qualified',
        'nurture',
        'disqualified',
        'outreach_pending',
        'contacted',
        'converted',
      ]);

      const updates: Record<string, any> = {};
      if (typeof req.body?.firstName === 'string') {
        const v = cleanString(req.body.firstName, 100);
        if (!v) return res.status(400).json({ error: 'First name cannot be empty.' });
        updates.firstName = v;
      }
      if (typeof req.body?.lastName === 'string') {
        const v = cleanString(req.body.lastName, 100);
        if (!v) return res.status(400).json({ error: 'Last name cannot be empty.' });
        updates.lastName = v;
      }
      if (typeof req.body?.email === 'string') {
        const v = cleanString(req.body.email, 254);
        if (!v) return res.status(400).json({ error: 'Email cannot be empty.' });
        updates.email = v;
      }
      if (typeof req.body?.companyName === 'string') {
        const v = cleanString(req.body.companyName, 160);
        if (!v) return res.status(400).json({ error: 'Company name cannot be empty.' });
        updates.companyName = v;
      }
      if ('phone' in (req.body || {})) updates.phone = cleanString(req.body.phone, 60) || null;
      if ('jobTitle' in (req.body || {}))
        updates.jobTitle = cleanString(req.body.jobTitle, 120) || null;
      if ('companyWebsite' in (req.body || {}))
        updates.companyWebsite = cleanString(req.body.companyWebsite, 250) || null;
      if ('industry' in (req.body || {}))
        updates.industry = cleanString(req.body.industry, 100) || null;
      if ('companySize' in (req.body || {}))
        updates.companySize = parseOptionalInt(req.body.companySize, 1, 2_000_000);
      if ('estimatedBudgetUsd' in (req.body || {}))
        updates.estimatedBudgetUsd = parseOptionalInt(req.body.estimatedBudgetUsd, 0, 100_000_000);
      if ('source' in (req.body || {}))
        updates.source = cleanString(req.body.source, 80) || 'Manual CRM Entry';
      if ('notes' in (req.body || {})) updates.notes = cleanString(req.body.notes, 2500) || null;
      if ('painPoints' in (req.body || {}))
        updates.painPoints = cleanString(req.body.painPoints, 2500) || null;
      if (typeof req.body?.status === 'string') {
        if (!allowedStatuses.has(req.body.status)) {
          return res.status(400).json({ error: 'Invalid lead status value.' });
        }
        updates.status = req.body.status;
      }

      try {
        const ctx = req.authContext!;
        const updated = await updateLeadRecord(
          ctx.business.id,
          req.params.id,
          ctx.profile.id,
          ctx.profile.fullName,
          updates
        );
        if (!updated) {
          return res.status(404).json({ error: 'Lead not found in your workspace.' });
        }
        res.json({ lead: updated });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Unable to update lead.' });
      }
    }
  );

  app.delete(
    '/api/leads/:id',
    requireAuth,
    standardLimiter,
    async (req: AuthRequest, res: Response) => {
      if (!isValidUuid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid lead identifier format.' });
      }
      try {
        const ctx = req.authContext!;
        const deleted = await deleteLeadRecord(
          ctx.business.id,
          req.params.id,
          ctx.profile.id,
          ctx.profile.fullName
        );
        if (!deleted) {
          return res.status(404).json({ error: 'Lead not found in your workspace.' });
        }
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Unable to delete lead.' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // AI Agents (Direct Execution & History)
  // ---------------------------------------------------------------------------
  app.get('/api/agents/runs', requireAuth, standardLimiter, async (req: AuthRequest, res: Response) => {
    try {
      const runs = await listAgentRuns(req.authContext!.business.id);
      res.json({ runs });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unable to fetch agent run history.' });
    }
  });

  app.post(
    '/api/agents/qualify/:leadId',
    requireAuth,
    aiActionLimiter,
    async (req: AuthRequest, res: Response) => {
      if (!isValidUuid(req.params.leadId)) {
        return res.status(400).json({ error: 'Invalid lead identifier format.' });
      }
      try {
        const ctx = req.authContext!;
        const result = await runLeadQualificationAgent({
          businessId: ctx.business.id,
          leadId: req.params.leadId,
          criteria: ctx.business.qualificationCriteria,
          businessName: ctx.business.name,
          businessValueProp: ctx.business.valueProposition,
          actorProfileId: ctx.profile.id,
        });
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Qualification agent failed to complete.' });
      }
    }
  );

  app.post(
    '/api/agents/outreach/:leadId',
    requireAuth,
    aiActionLimiter,
    async (req: AuthRequest, res: Response) => {
      if (!isValidUuid(req.params.leadId)) {
        return res.status(400).json({ error: 'Invalid lead identifier format.' });
      }
      try {
        const ctx = req.authContext!;
        const result = await runSalesOutreachAgent({
          businessId: ctx.business.id,
          leadId: req.params.leadId,
          businessName: ctx.business.name,
          valueProposition: ctx.business.valueProposition,
          senderName: ctx.business.senderName,
          senderRole: ctx.business.senderRole,
          toneOfVoice: ctx.business.qualificationCriteria.toneOfVoice,
          actorProfileId: ctx.profile.id,
        });
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Outreach agent failed to generate draft.' });
      }
    }
  );

  app.post(
    '/api/agents/insights',
    requireAuth,
    aiActionLimiter,
    async (req: AuthRequest, res: Response) => {
      try {
        const ctx = req.authContext!;
        const insightRun = await runBusinessInsightsAgent({
          businessId: ctx.business.id,
          businessName: ctx.business.name,
          actorProfileId: ctx.profile.id,
        });
        res.json({ insightRun });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Business Insights agent failed.' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Coordinated Workflows & Self-Healing Orchestration
  // ---------------------------------------------------------------------------
  app.get('/api/workflows', requireAuth, standardLimiter, async (req: AuthRequest, res: Response) => {
    try {
      const workflows = await listWorkflowRunsWithSteps(req.authContext!.business.id);
      res.json({ workflows });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unable to load workflows.' });
    }
  });

  app.post(
    '/api/workflows/execute',
    requireAuth,
    aiActionLimiter,
    async (req: AuthRequest, res: Response) => {
      const leadId = req.body?.leadId;
      if (!isValidUuid(leadId)) {
        return res.status(400).json({ error: 'Please select a valid lead to run the workflow.' });
      }

      const allowedFaultModes = new Set([
        'default',
        'none',
        'transient_network',
        'rate_limit',
        'malformed_email',
        'consequential_correction',
        'permission_denied',
      ]);
      const faultInjectionMode =
        typeof req.body?.faultInjectionMode === 'string' &&
        allowedFaultModes.has(req.body.faultInjectionMode)
          ? req.body.faultInjectionMode
          : 'default';

      const idempotencyKey = cleanString(req.body?.idempotencyKey, 180) || undefined;

      try {
        const ctx = req.authContext!;
        const result = await executeCoordinatedWorkflow({
          businessId: ctx.business.id,
          leadId,
          actorProfileId: ctx.profile.id,
          actorName: ctx.profile.fullName,
          businessName: ctx.business.name,
          valueProposition: ctx.business.valueProposition,
          senderName: ctx.business.senderName,
          senderRole: ctx.business.senderRole,
          criteria: ctx.business.qualificationCriteria,
          idempotencyKey,
          faultInjectionMode,
        });
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Workflow execution encountered an error.' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Human-in-the-Loop Approval Center
  // ---------------------------------------------------------------------------
  app.get('/api/approvals', requireAuth, standardLimiter, async (req: AuthRequest, res: Response) => {
    try {
      const approvals = await listApprovalsBundle(req.authContext!.business.id);
      res.json({ approvals });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unable to load approval queue.' });
    }
  });

  app.post(
    '/api/approvals/:id/decide',
    requireAuth,
    standardLimiter,
    async (req: AuthRequest, res: Response) => {
      if (!isValidUuid(req.params.id)) {
        return res.status(400).json({ error: 'Invalid approval identifier format.' });
      }
      const decision = req.body?.decision;
      if (decision !== 'approved' && decision !== 'rejected') {
        return res.status(400).json({ error: 'Decision must be "approved" or "rejected".' });
      }

      try {
        const ctx = req.authContext!;
        const updated = await decideApprovalItem({
          businessId: ctx.business.id,
          approvalId: req.params.id,
          reviewerProfileId: ctx.profile.id,
          reviewerName: ctx.profile.fullName,
          decision,
          editedSubject: cleanString(req.body?.editedSubject, 300) || undefined,
          editedBody: cleanString(req.body?.editedBody, 8000) || undefined,
          decisionNotes: cleanString(req.body?.decisionNotes, 1000) || undefined,
        });
        res.json({ approval: updated });
      } catch (error: any) {
        const status = error.message?.includes('already been finalized') ? 409 : 400;
        res.status(status).json({ error: error.message || 'Unable to finalize approval.' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Activity & Error Audit Logs
  // ---------------------------------------------------------------------------
  app.get('/api/logs', requireAuth, standardLimiter, async (req: AuthRequest, res: Response) => {
    try {
      const logs = await listActivityLogs(req.authContext!.business.id);
      res.json({ logs });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unable to load activity logs.' });
    }
  });

  // ---------------------------------------------------------------------------
  // Business Settings & Qualification Criteria (Admin-Restricted)
  // ---------------------------------------------------------------------------
  app.put('/api/settings', requireAuth, standardLimiter, async (req: AuthRequest, res: Response) => {
    const ctx = req.authContext!;
    const name = cleanString(req.body?.name, 140);
    const industry = cleanString(req.body?.industry, 100);
    const valueProposition = cleanString(req.body?.valueProposition, 1500);
    const senderName = cleanString(req.body?.senderName, 100);
    const senderRole = cleanString(req.body?.senderRole, 100);

    if (!name || !industry || !valueProposition || !senderName || !senderRole) {
      return res.status(400).json({
        error:
          'Business name, industry, value proposition, sender name, and sender role are required.',
      });
    }

    const rawCriteria = req.body?.qualificationCriteria || {};
    const targetIndustries = Array.isArray(rawCriteria.targetIndustries)
      ? rawCriteria.targetIndustries
          .map((s: unknown) => cleanString(s, 60))
          .filter(Boolean)
          .slice(0, 15)
      : ctx.business.qualificationCriteria.targetIndustries;

    const minBudgetUsd = Math.max(0, Math.min(10_000_000, Number(rawCriteria.minBudgetUsd) || 0));
    const minCompanySize = Math.max(1, Math.min(100_000, Number(rawCriteria.minCompanySize) || 1));
    const fitThresholdScore = Math.max(
      10,
      Math.min(95, Number(rawCriteria.fitThresholdScore) || 70)
    );
    const autoDraftMinScore = Math.max(
      0,
      Math.min(95, Number(rawCriteria.autoDraftMinScore) || 55)
    );
    const maxWorkflowRetries = Math.max(
      0,
      Math.min(5, Number(rawCriteria.maxWorkflowRetries) ?? 2)
    );
    const idealCustomerNotes =
      cleanString(rawCriteria.idealCustomerNotes, 1500) ||
      ctx.business.qualificationCriteria.idealCustomerNotes;
    const toneOfVoice =
      cleanString(rawCriteria.toneOfVoice, 300) ||
      ctx.business.qualificationCriteria.toneOfVoice;

    try {
      const updated = await updateBusinessSettings({
        businessId: ctx.business.id,
        actorProfileId: ctx.profile.id,
        actorName: ctx.profile.fullName,
        role: ctx.membership.role,
        name,
        industry,
        website: cleanString(req.body?.website, 250) || null,
        valueProposition,
        senderName,
        senderRole,
        qualificationCriteria: {
          targetIndustries,
          minBudgetUsd,
          minCompanySize,
          fitThresholdScore,
          autoDraftMinScore,
          maxWorkflowRetries,
          idealCustomerNotes,
          toneOfVoice,
        },
      });
      res.json({ business: updated });
    } catch (error: any) {
      const code = error.message?.includes('Permission denied') ? 403 : 500;
      res.status(code).json({ error: error.message || 'Unable to save settings.' });
    }
  });

  // Catch unknown API routes cleanly
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Requested API endpoint does not exist.' });
  });

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request payload exceeds maximum allowed size.' });
    }
    console.error('[Server Error]:', err);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Workforce server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
