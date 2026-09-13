export type SalesCall = {
  id: string | number;
  prospect_name: string;
  rep_name: string;
  outcome: 'won' | 'lost' | 'follow_up' | 'no_show';
  score: number;
  revenue: number;
  primary_objection: string;
  happened_at: string;
};

export type Campaign = {
  id: string | number;
  campaign_name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  purchases: number;
  revenue: number;
  date_start: string;
};

export type Connection = {
  provider: 'clickup' | 'meta';
  status: 'connected' | 'disconnected' | 'error';
  account_name: string | null;
  metadata?: Record<string, unknown>;
};

export const demoCalls: SalesCall[] = [
  { id: 'c1', prospect_name: 'Northstar Dental', rep_name: 'Maya Chen', outcome: 'won', score: 92, revenue: 12500, primary_objection: 'Timing', happened_at: '2026-09-12T09:30:00Z' },
  { id: 'c2', prospect_name: 'Velocity Med Spa', rep_name: 'Jon Bell', outcome: 'follow_up', score: 84, revenue: 0, primary_objection: 'Price', happened_at: '2026-09-11T14:10:00Z' },
  { id: 'c3', prospect_name: 'Apex Roofing', rep_name: 'Maya Chen', outcome: 'won', score: 89, revenue: 9800, primary_objection: 'Trust', happened_at: '2026-09-11T11:00:00Z' },
  { id: 'c4', prospect_name: 'Lumen Wellness', rep_name: 'Andre Hill', outcome: 'lost', score: 71, revenue: 0, primary_objection: 'Price', happened_at: '2026-09-10T16:45:00Z' },
  { id: 'c5', prospect_name: 'Summit Legal', rep_name: 'Jon Bell', outcome: 'won', score: 87, revenue: 7200, primary_objection: 'Authority', happened_at: '2026-09-09T10:20:00Z' },
];

export const demoCampaigns: Campaign[] = [
  { id: 'a1', campaign_name: 'Founder Story — Broad', status: 'ACTIVE', spend: 3840, impressions: 126400, clicks: 2318, leads: 106, purchases: 19, revenue: 17100, date_start: '2026-09-01' },
  { id: 'a2', campaign_name: 'Proof Stack — Retargeting', status: 'ACTIVE', spend: 2180, impressions: 58400, clicks: 1448, leads: 72, purchases: 13, revenue: 11700, date_start: '2026-09-01' },
  { id: 'a3', campaign_name: 'Pain Point UGC — Test', status: 'PAUSED', spend: 1460, impressions: 49200, clicks: 682, leads: 24, purchases: 3, revenue: 2700, date_start: '2026-09-03' },
  { id: 'a4', campaign_name: 'Case Study — Lookalike', status: 'ACTIVE', spend: 4920, impressions: 168900, clicks: 2860, leads: 84, purchases: 11, revenue: 9900, date_start: '2026-09-01' },
];

export const demoConnections: Connection[] = [
  { provider: 'clickup', status: 'connected', account_name: 'Acme Growth Workspace', metadata: { list_id: '901234567890', list_name: 'Operator AI Briefs' } },
  { provider: 'meta', status: 'connected', account_name: 'Acme Growth — Main' },
];
