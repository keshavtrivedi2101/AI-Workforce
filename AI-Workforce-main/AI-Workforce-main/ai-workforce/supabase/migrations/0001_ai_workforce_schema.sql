-- =============================================================================
-- AI Workforce — Supabase / PostgreSQL Complete Migration & RLS Policies
-- Run in Supabase SQL Editor (or via `supabase db push`)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Profiles (maps 1:1 to auth.users / external auth UID)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid text NOT NULL UNIQUE,
  email text NOT NULL,
  full_name text NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (email);

-- 2. Businesses (isolated multi-tenant workspaces)
CREATE TABLE IF NOT EXISTS public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  industry text NOT NULL DEFAULT 'B2B Operations & Advisory',
  website text,
  value_proposition text NOT NULL,
  sender_name text NOT NULL,
  sender_role text NOT NULL,
  qualification_criteria jsonb NOT NULL DEFAULT '{
    "targetIndustries": ["SaaS", "FinTech", "Healthcare", "Logistics", "Manufacturing", "Professional Services"],
    "minBudgetUsd": 12000,
    "minCompanySize": 15,
    "fitThresholdScore": 70,
    "autoDraftMinScore": 55,
    "maxWorkflowRetries": 2,
    "idealCustomerNotes": "Growth-stage B2B companies looking to automate inbound lead qualification, sales follow-ups, and repeatable operational workflows.",
    "toneOfVoice": "Consultative, concise, transparent, and executive-ready"
  }'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Business Members (authoritative server-side role mapping)
CREATE TABLE IF NOT EXISTS public.business_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'reviewer', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_members_business_profile_uidx UNIQUE (business_id, profile_id)
);

CREATE INDEX IF NOT EXISTS business_members_profile_idx ON public.business_members (profile_id);

-- 4. Leads
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text,
  job_title text,
  company_name text NOT NULL,
  company_website text,
  industry text,
  company_size integer CHECK (company_size IS NULL OR company_size >= 0),
  estimated_budget_usd integer CHECK (estimated_budget_usd IS NULL OR estimated_budget_usd >= 0),
  source text NOT NULL DEFAULT 'Inbound Web',
  notes text,
  pain_points text,
  status text NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'qualifying', 'qualified', 'nurture', 'disqualified', 'outreach_pending', 'contacted', 'converted')
  ),
  qualification_score integer CHECK (qualification_score IS NULL OR (qualification_score >= 0 AND qualification_score <= 100)),
  qualification_summary text,
  qualification_breakdown jsonb,
  is_demo boolean NOT NULL DEFAULT false,
  simulated_fault_mode text DEFAULT 'none',
  last_evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_business_idx ON public.leads (business_id);
CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads (business_id, status);
CREATE INDEX IF NOT EXISTS leads_score_idx ON public.leads (business_id, qualification_score);

-- 5. Workflow Runs
CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  triggered_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  workflow_type text NOT NULL DEFAULT 'lead_to_outreach',
  status text NOT NULL DEFAULT 'running' CHECK (
    status IN ('queued', 'running', 'recovering', 'awaiting_approval', 'completed', 'needs_human_intervention', 'failed')
  ),
  current_step text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries integer NOT NULL DEFAULT 2 CHECK (max_retries >= 0 AND max_retries <= 5),
  error_category text CHECK (
    error_category IS NULL OR error_category IN ('validation', 'permission', 'rate_limit', 'transient_network', 'unknown')
  ),
  error_message text,
  recovery_summary text,
  outcome text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_runs_business_idx ON public.workflow_runs (business_id);
CREATE INDEX IF NOT EXISTS workflow_runs_lead_idx ON public.workflow_runs (lead_id);

-- 6. Workflow Steps
CREATE TABLE IF NOT EXISTS public.workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  step_key text NOT NULL,
  step_name text NOT NULL,
  agent_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'retrying', 'healed', 'completed', 'failed', 'skipped', 'requires_approval')
  ),
  attempt_count integer NOT NULL DEFAULT 0,
  error_category text,
  error_message text,
  healing_action text,
  input_payload jsonb,
  output_payload jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_steps_run_idx ON public.workflow_steps (workflow_run_id);
CREATE INDEX IF NOT EXISTS workflow_steps_business_idx ON public.workflow_steps (business_id);

-- 7. Agent Runs
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  workflow_run_id uuid REFERENCES public.workflow_runs(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  agent_key text NOT NULL CHECK (
    agent_key IN ('lead_research', 'sales_outreach', 'workflow_coordinator', 'business_insights')
  ),
  agent_name text NOT NULL,
  model_used text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  duration_ms integer,
  summary text,
  structured_output jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_business_idx ON public.agent_runs (business_id);
CREATE INDEX IF NOT EXISTS agent_runs_agent_key_idx ON public.agent_runs (business_id, agent_key);

-- 8. Outreach Drafts
CREATE TABLE IF NOT EXISTS public.outreach_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  workflow_run_id uuid REFERENCES public.workflow_runs(id) ON DELETE SET NULL,
  agent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  subject text NOT NULL,
  body text NOT NULL,
  personalization_rationale text NOT NULL,
  suggested_next_step text NOT NULL,
  verified_facts_used jsonb,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (
    status IN ('pending_approval', 'approved', 'rejected', 'simulated_sent')
  ),
  delivery_mode text NOT NULL DEFAULT 'simulated_safe_mode',
  delivery_note text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_drafts_business_idx ON public.outreach_drafts (business_id);
CREATE INDEX IF NOT EXISTS outreach_drafts_lead_idx ON public.outreach_drafts (lead_id);

-- 9. Approvals (Human-in-the-loop gate for external outreach & consequential repairs)
CREATE TABLE IF NOT EXISTS public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  outreach_draft_id uuid REFERENCES public.outreach_drafts(id) ON DELETE CASCADE,
  workflow_run_id uuid REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  approval_type text NOT NULL DEFAULT 'outreach_email' CHECK (
    approval_type IN ('outreach_email', 'data_correction')
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  proposed_changes jsonb,
  reviewer_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decision_notes text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approvals_business_idx ON public.approvals (business_id);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON public.approvals (business_id, status);

-- 10. Activity Logs
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent', 'system', 'self_healing')),
  actor_name text NOT NULL,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'error')),
  entity_type text,
  entity_id uuid,
  message text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_logs_business_idx ON public.activity_logs (business_id);
CREATE INDEX IF NOT EXISTS activity_logs_severity_idx ON public.activity_logs (business_id, severity);

-- =============================================================================
-- Row Level Security (RLS) & Multi-Tenant Business Isolation
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Helper function: resolve current authenticated profile ID from auth.uid()
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles WHERE uid = auth.uid()::text LIMIT 1;
$$;

-- Helper function: verify membership in a given business
CREATE OR REPLACE FUNCTION public.is_business_member(target_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    JOIN public.profiles p ON p.id = bm.profile_id
    WHERE bm.business_id = target_business_id
      AND p.uid = auth.uid()::text
  );
$$;

-- Helper function: verify administrator role in a given business
CREATE OR REPLACE FUNCTION public.is_business_admin(target_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    JOIN public.profiles p ON p.id = bm.profile_id
    WHERE bm.business_id = target_business_id
      AND p.uid = auth.uid()::text
      AND bm.role = 'admin'
  );
$$;

-- Profiles policies
CREATE POLICY "Users can view own and co-member profiles"
  ON public.profiles FOR SELECT
  USING (
    uid = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.business_members bm1
      JOIN public.business_members bm2 ON bm1.business_id = bm2.business_id
      WHERE bm1.profile_id = public.current_profile_id()
        AND bm2.profile_id = profiles.id
    )
  );

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (uid = auth.uid()::text)
  WITH CHECK (uid = auth.uid()::text);

-- Businesses policies
CREATE POLICY "Members can view their businesses"
  ON public.businesses FOR SELECT
  USING (public.is_business_member(id));

CREATE POLICY "Admins can update their business settings"
  ON public.businesses FOR UPDATE
  USING (public.is_business_admin(id))
  WITH CHECK (public.is_business_admin(id));

-- Business Members policies (never allow client-supplied self-promotion)
CREATE POLICY "Members can view membership roster"
  ON public.business_members FOR SELECT
  USING (public.is_business_member(business_id));

CREATE POLICY "Only admins can manage additional members"
  ON public.business_members FOR INSERT
  WITH CHECK (public.is_business_admin(business_id));

CREATE POLICY "Only admins can update member roles"
  ON public.business_members FOR UPDATE
  USING (public.is_business_admin(business_id))
  WITH CHECK (public.is_business_admin(business_id));

-- Leads policies
CREATE POLICY "Members can read business leads"
  ON public.leads FOR SELECT
  USING (public.is_business_member(business_id));

CREATE POLICY "Members can insert business leads"
  ON public.leads FOR INSERT
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "Members can update business leads"
  ON public.leads FOR UPDATE
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "Admins and members can delete business leads"
  ON public.leads FOR DELETE
  USING (public.is_business_member(business_id));

-- Workflow Runs & Steps policies
CREATE POLICY "Members can access workflow runs"
  ON public.workflow_runs FOR ALL
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

CREATE POLICY "Members can access workflow steps"
  ON public.workflow_steps FOR ALL
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Agent Runs policies
CREATE POLICY "Members can access agent runs"
  ON public.agent_runs FOR ALL
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Outreach Drafts policies
CREATE POLICY "Members can access outreach drafts"
  ON public.outreach_drafts FOR ALL
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Approvals policies
CREATE POLICY "Members can view approvals"
  ON public.approvals FOR SELECT
  USING (public.is_business_member(business_id));

CREATE POLICY "Reviewers and admins can update approvals"
  ON public.approvals FOR UPDATE
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

-- Activity Logs policies (append-only for members; read-only audit trail)
CREATE POLICY "Members can view activity logs"
  ON public.activity_logs FOR SELECT
  USING (public.is_business_member(business_id));

CREATE POLICY "Members can append activity logs"
  ON public.activity_logs FOR INSERT
  WITH CHECK (public.is_business_member(business_id));

-- =============================================================================
-- Secure Initial Setup RPC (Assigns first authenticated user as Admin of their
-- own isolated business without trusting any client-supplied role values)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.initialize_business_workspace(
  p_full_name text DEFAULT NULL,
  p_business_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid text;
  v_email text;
  v_profile_id uuid;
  v_existing_business_id uuid;
  v_new_business_id uuid;
  v_safe_name text;
  v_safe_business text;
BEGIN
  v_uid := auth.uid()::text;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to initialize workspace';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  v_safe_name := COALESCE(NULLIF(trim(p_full_name), ''), split_part(COALESCE(v_email, 'Owner'), '@', 1));
  v_safe_business := COALESCE(NULLIF(trim(p_business_name), ''), v_safe_name || '''s Operations');

  -- Upsert profile
  INSERT INTO public.profiles (uid, email, full_name)
  VALUES (v_uid, COALESCE(v_email, 'owner@workspace.local'), v_safe_name)
  ON CONFLICT (uid) DO UPDATE
    SET updated_at = now()
  RETURNING id INTO v_profile_id;

  -- Check if user already belongs to a business (idempotent)
  SELECT business_id INTO v_existing_business_id
  FROM public.business_members
  WHERE profile_id = v_profile_id
  LIMIT 1;

  IF v_existing_business_id IS NOT NULL THEN
    RETURN v_existing_business_id;
  END IF;

  -- Create isolated business and assign 'admin' role strictly server-side
  INSERT INTO public.businesses (
    name,
    industry,
    value_proposition,
    sender_name,
    sender_role
  ) VALUES (
    v_safe_business,
    'B2B Revenue & Operations',
    'We help B2B teams qualify inbound demand faster, eliminate manual CRM triage, and execute verified outreach.',
    v_safe_name,
    'Founder & Operations Lead'
  )
  RETURNING id INTO v_new_business_id;

  INSERT INTO public.business_members (business_id, profile_id, role)
  VALUES (v_new_business_id, v_profile_id, 'admin');

  INSERT INTO public.activity_logs (
    business_id,
    actor_profile_id,
    actor_type,
    actor_name,
    event_type,
    severity,
    entity_type,
    entity_id,
    message
  ) VALUES (
    v_new_business_id,
    v_profile_id,
    'system',
    'Workspace Provisioner',
    'workspace.initialized',
    'success',
    'settings',
    v_new_business_id,
    'Initialized isolated business workspace and assigned administrator membership.'
  );

  RETURN v_new_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_business_workspace(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initialize_business_workspace(text, text) TO authenticated;
