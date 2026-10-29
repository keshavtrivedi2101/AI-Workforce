export interface SampleLeadSeed {
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
  simulatedFaultMode: string;
}

export const SAMPLE_DEMO_LEADS: SampleLeadSeed[] = [
  {
    firstName: 'Marcus',
    lastName: 'Vance',
    email: 'm.vance@northstar-fintech.io',
    phone: '+1 (415) 890-3412',
    jobTitle: 'VP of Revenue Operations',
    companyName: 'Northstar FinTech Systems',
    companyWebsite: 'https://northstar-fintech.io',
    industry: 'FinTech',
    companySize: 140,
    estimatedBudgetUsd: 36000,
    source: 'Inbound Product Demo',
    notes: 'Requested an architecture walkthrough for Q4 sales team rollout across 18 account executives.',
    painPoints:
      'Inbound demo requests sit unreviewed for 19 hours on average; SDRs manually copy notes across spreadsheets and miss follow-up SLAs.',
    simulatedFaultMode: 'none',
  },
  {
    firstName: 'Priya',
    lastName: 'Nair',
    email: 'priya.nair@kestrel-logistics.com',
    phone: null,
    jobTitle: 'Director of Commercial Strategy',
    companyName: 'Kestrel Freight & ColdChain',
    companyWebsite: 'https://kestrel-logistics.com',
    industry: 'Logistics',
    companySize: 85,
    estimatedBudgetUsd: null,
    source: 'Partner Referral',
    notes: 'Referred by cloud ERP implementation partner. Interested in automated quote triage and human-reviewed customer replies.',
    painPoints:
      'Regional dispatch and commercial reps receive 60+ web inquiries weekly without structured qualification criteria or budget visibility.',
    simulatedFaultMode: 'none',
  },
  {
    firstName: 'Elena',
    lastName: 'Rostova',
    email: 'elena.rostova @meridian-health.org',
    phone: '+1 (617) 502-7781',
    jobTitle: 'Chief Operating Officer',
    companyName: 'Meridian Outpatient Networks',
    companyWebsite: 'https://meridian-health.org',
    industry: 'Healthcare',
    companySize: 220,
    estimatedBudgetUsd: 48000,
    source: 'Executive Roundtable',
    notes: 'Demo record includes an intentional whitespace formatting defect in email to showcase deterministic self-healing validation.',
    painPoints:
      'Clinic partnership inquiries require strict compliance review before any external outreach is approved and sent.',
    simulatedFaultMode: 'transient_network',
  },
  {
    firstName: 'Devon',
    lastName: 'Brooks',
    email: 'devon@studionova-design.co',
    phone: '+1 (512) 394-1109',
    jobTitle: 'Founder',
    companyName: 'Studio Nova Creative',
    companyWebsite: 'https://studionova-design.co',
    industry: 'Creative Boutique',
    companySize: 4,
    estimatedBudgetUsd: 2500,
    source: 'Organic Search',
    notes: 'Exploring lightweight freelance CRM templates; budget and team size are below standard B2B mid-market threshold.',
    painPoints: 'Looking for a personal solo-founder contact address book.',
    simulatedFaultMode: 'none',
  },
  {
    firstName: 'Kenji',
    lastName: 'Takahashi',
    email: 'ktakahashi@apex-precision-mfg.com',
    phone: '+1 (312) 644-9020',
    jobTitle: 'Head of Digital Transformation',
    companyName: 'Apex Precision Manufacturing',
    companyWebsite: 'https://apex-precision-mfg.com',
    industry: 'Manufacturing',
    companySize: 310,
    estimatedBudgetUsd: 28000,
    source: 'Industry Trade Briefing',
    notes: 'Evaluating AI workflow orchestration with audit logging and role-restricted approval gates.',
    painPoints:
      'Distributor inquiries lack consistent qualification scoring, causing senior engineers to spend hours on unqualified RFQs.',
    simulatedFaultMode: 'none',
  },
];
