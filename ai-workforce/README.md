# AI Workforce — Multi-Agent Business Workflow Automation

**AI Workforce** is a full-stack business workflow automation platform for small and medium businesses. It turns natural-language operational requests into coordinated multi-agent Directed Acyclic Graph (DAG) plans, executes database & business tool operations, recovers from transient faults, and pauses high-risk actions at a human-in-the-loop supervisor checkpoint.

## 4-Stage Architecture

1. **Orchestrator / Planner Agent (`orchestrator_planner`)**
   - Accepts free-form business requests (e.g., onboarding an inbound inquiry, auditing unscored CRM leads, syncing pipeline trackers, or preparing executive briefings).
   - Decomposes requests into an acyclic DAG (`task_1`..`task_N`) with explicit upstream dependencies (`dependsOn`), assigned worker agents, target tool connectors, and risk classifications (`low`, `medium`, `high_checkpoint`).

2. **Specialized Worker Agents**
   - **CRM Updater (`crm_updater`)**: Invokes Gemini Function Calling (`upsert_crm_lead`, `update_crm_lifecycle_and_notes`) to create or update tenant-scoped PostgreSQL CRM records.
   - **Lead Research & Qualification (`lead_research`)**: Evaluates prospects against configurable fit thresholds (0–100 across industry, budget, company scale, and completeness) and highlights missing data without inventing facts.
   - **Sales Outreach Dispatcher (`sales_outreach`)**: Generates personalized follow-up email drafts strictly grounded in verified CRM fields.
   - **Connected Tool Worker (`sheets_webhook_sync`)**: Synchronizes scored deal cards to simulated Google Sheets (`sheets.append_pipeline_row`) and Airtable (`airtable.sync_deal_card`) endpoints.
   - **Workflow Coordinator (`workflow_coordinator`)**: Enforces idempotency keys, classifies errors, applies bounded exponential retries and deterministic email syntax repairs, and escalates safely when recovery limits are reached.
   - **Business Insights Analyst (`business_insights`)**: Produces executive briefings strictly derived from live SQL counts and sample-size confidence checks.

3. **Tool Calling & Connector Relay Layer (`tool_invocations`)**
   - Persists every CRM function call, Google Sheets append, Airtable card sync, and webhook dispatch with HTTP method, endpoint path, duration (`ms`), and structured JSON request/response payloads.

4. **Supervisor & Human-in-the-Loop Checkpoint (`approvals`)**
   - High-risk external emails and consequential data repairs pause automatically (`requires_approval` / `held_for_approval`).
   - Reviewers can inspect, edit, reject, or perform **one-click sign-off** directly inside the DAG Mission Planner or the Approval Checkpoint dashboard.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Recharts, Lucide Icons
- **Backend**: Node.js + Express (`server.ts`) with PostgreSQL Email/Password (`scrypt` + HMAC-SHA256) & Google OAuth (`firebase-admin`) verification (`requireAuth`) and per-tenant workspace isolation
- **Database**: PostgreSQL (Cloud SQL) + Drizzle ORM (`src/db/schema.ts`)
- **AI**: Server-side `@google/genai` SDK (`gemini-3.1-flash-lite`) with Structured Outputs & Function Calling

## Running Locally & Deployment

```bash
# Install dependencies
npm install

# Push Drizzle PostgreSQL schema (if configuring a fresh database)
npx drizzle-kit push --config=src/db/drizzle.config.ts

# Start full-stack Express + Vite server on port 3000
npm run dev

# Build production frontend bundle
npm run build

# Start production server
npm start
```
