/**
 * Typed HTTPS Client & REST Collection Generator for AI Workforce
 */

export type AuthProviderHeader = 'firebase' | 'local' | 'supabase';

export interface HttpsRequestOptions extends Omit<RequestInit, 'body'> {
  token?: string | null;
  provider?: AuthProviderHeader | null;
  body?: unknown;
  timeoutMs?: number;
}

export async function parseSafeJsonResponse(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  if (contentType.includes('application/json')) {
    try {
      return rawText ? JSON.parse(rawText) : {};
    } catch {
      return { error: 'Received an incomplete JSON response from server. Please retry.' };
    }
  }

  if (rawText.trim().startsWith('<')) {
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      return {
        error: `Server gateway timeout (${response.status}). Please retry the action.`,
      };
    }
    return {
      error: `Unexpected server response (${response.status}). Please refresh or retry.`,
    };
  }

  return { error: rawText.slice(0, 240) || `Request failed (${response.status})` };
}

export async function httpsRequest<T = any>(
  path: string,
  options: HttpsRequestOptions = {}
): Promise<T> {
  const { token, provider, body, timeoutMs = 45000, headers, ...rest } = options;

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  const headersObj: Record<string, string> = {};
  if (headers) {
    const normalized = new Headers(headers);
    normalized.forEach((val, key) => {
      headersObj[key] = val;
    });
  }

  if (token) {
    headersObj['Authorization'] = `Bearer ${token}`;
  }
  if (provider) {
    headersObj['X-Auth-Provider'] = provider;
  }

  let serializedBody: BodyInit | undefined;
  if (body !== undefined) {
    if (typeof body === 'string') {
      serializedBody = body;
    } else {
      serializedBody = JSON.stringify(body);
      if (!headersObj['Content-Type'] && !headersObj['content-type']) {
        headersObj['Content-Type'] = 'application/json';
      }
    }
  }

  try {
    const response = await fetch(path, {
      ...rest,
      headers: headersObj,
      body: serializedBody,
      signal: rest.signal || controller.signal,
    });

    const payload = await parseSafeJsonResponse(response);
    if (!response.ok) {
      throw new Error(payload?.error || `HTTPS request failed (${response.status})`);
    }
    return payload as T;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export function buildHttpsCollectionTemplate(baseUrl: string): string {
  const cleanOrigin = baseUrl.replace(/\/+$/, '');
  return `###############################################################################
# AI Workforce — HTTPS REST Client Collection (api.http)
# Generated for: ${cleanOrigin}
###############################################################################

@baseUrl = ${cleanOrigin}
@authProvider = local
@email = operator@apexops.io
@password = WorkforcePass123!

### 1. Register Isolated Workspace
# @name registerAccount
POST {{baseUrl}}/api/auth/register
Content-Type: application/json

{
  "fullName": "Jordan Mercer",
  "email": "{{email}}",
  "password": "{{password}}"
}

### 2. Sign In & Capture Bearer Token
# @name loginAccount
POST {{baseUrl}}/api/auth/login
Content-Type: application/json

{
  "email": "{{email}}",
  "password": "{{password}}"
}

@token = {{loginAccount.response.body.token}}

### 3. Get Workspace Session
GET {{baseUrl}}/api/workspace
Authorization: Bearer {{token}}
X-Auth-Provider: {{authProvider}}

### 4. Get Executive Dashboard KPIs
GET {{baseUrl}}/api/dashboard
Authorization: Bearer {{token}}
X-Auth-Provider: {{authProvider}}

### 5. Execute Orchestrator Natural-Language Directive (DAG)
POST {{baseUrl}}/api/directives/execute
Authorization: Bearer {{token}}
X-Auth-Provider: {{authProvider}}
Content-Type: application/json

{
  "directive": "Onboard inbound inquiry from Apex Logistics (Maya Lin, maya@apexlogistics.io, VP Operations, Logistics, 85 employees, $28,000 budget, manual dispatch spreadsheets): create CRM record, score fit, sync Google Sheets, and draft follow-up for approval.",
  "faultInjectionMode": "none"
}

### 6. List Leads CRM
# @name listLeads
GET {{baseUrl}}/api/leads
Authorization: Bearer {{token}}
X-Auth-Provider: {{authProvider}}

@leadId = {{listLeads.response.body.leads[0].id}}

### 7. Qualify Lead (Agent A)
POST {{baseUrl}}/api/agents/qualify/{{leadId}}
Authorization: Bearer {{token}}
X-Auth-Provider: {{authProvider}}

### 8. Generate Outreach Draft (Agent B)
POST {{baseUrl}}/api/agents/outreach/{{leadId}}
Authorization: Bearer {{token}}
X-Auth-Provider: {{authProvider}}

### 9. List Pending Supervisor Checkpoints
# @name listApprovals
GET {{baseUrl}}/api/approvals
Authorization: Bearer {{token}}
X-Auth-Provider: {{authProvider}}

@approvalId = {{listApprovals.response.body.approvals[0].id}}

### 10. One-Click Supervisor Sign-Off
POST {{baseUrl}}/api/approvals/{{approvalId}}/decide
Authorization: Bearer {{token}}
X-Auth-Provider: {{authProvider}}
Content-Type: application/json

{
  "decision": "approved",
  "decisionNotes": "Approved via HTTPS REST Client"
}

### 11. Test Connected Business Tool Relay
POST {{baseUrl}}/api/tools/test-relay
Authorization: Bearer {{token}}
X-Auth-Provider: {{authProvider}}
Content-Type: application/json

{
  "connectorKey": "google_sheets_sync"
}
`;
}

export async function downloadWindowsDesktopApp(): Promise<void> {
  const endpoints = ['/api/download/windows-exe', '/AI-Workforce.exe'];
  let validBytes: ArrayBuffer | null = null;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, { method: 'GET' });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const view = new Uint8Array(buf);
      // Verify DOS/PE 'MZ' magic bytes (0x4D, 0x5A)
      if (view.length > 512 && view[0] === 0x4d && view[1] === 0x5a) {
        validBytes = buf;
        break;
      }
    } catch {
      // Try fallback static binary
    }
  }

  if (!validBytes) {
    throw new Error('Unable to download AI-Workforce.exe right now. Please retry.');
  }

  const blob = new Blob([validBytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'AI-Workforce.exe';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

