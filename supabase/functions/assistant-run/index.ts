import { adminClient, authorizeUser, corsHeaders, json } from '../_shared/supabase.ts';

const allowedTools = new Set(['sales-coach', 'audit', 'spy', 'script', 'draft']);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const { user } = await authorizeUser(req);
  if (!user) return json({ error: 'Sign in is required.' }, 401);
  const body = await req.json().catch(() => ({})) as { workspace?: string; tool?: string; prompt?: string };
  if (!['sales', 'media'].includes(body.workspace ?? '') || !allowedTools.has(body.tool ?? '')) return json({ error: 'Invalid assistant request.' }, 400);
  const prompt = String(body.prompt ?? '').slice(0, 4000);
  const admin = adminClient();
  const context = body.workspace === 'sales'
    ? await admin.from('sales_calls').select('prospect_name,rep_name,outcome,score,revenue,primary_objection,happened_at').eq('user_id', user.id).order('happened_at', { ascending: false }).limit(30)
    : await admin.from('meta_campaign_snapshots').select('campaign_name,status,spend,impressions,clicks,leads,purchases,revenue,date_start,date_stop').eq('user_id', user.id).order('date_start', { ascending: false }).limit(30);
  if (context.error) return json({ error: context.error.message }, 500);
  const fallback = deterministicBrief(body.workspace!, body.tool!, context.data ?? [], prompt);
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  let result = fallback;
  let model: string | null = null;
  if (apiKey) {
    model = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini';
    const instruction = body.workspace === 'sales'
      ? 'You are Charles, a direct and practical AI sales manager. Analyze only the supplied data. Give prioritized coaching and next actions. Never invent metrics.'
      : 'You are an expert AI media buyer. Analyze only supplied Meta Ads data. Recommend scale, iterate, kill, or review with evidence. Drafts must always launch paused. Never promise outcomes.';
    const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, instructions: instruction, input: `Tool: ${body.tool}\nUser request: ${prompt || 'Provide the default analysis.'}\nData: ${JSON.stringify(context.data)}`, max_output_tokens: 900 }) });
    if (response.ok) {
      const payload = await response.json() as { output_text?: string };
      if (payload.output_text?.trim()) result = payload.output_text.trim();
    }
  }
  await admin.from('assistant_runs').insert({ user_id: user.id, workspace: body.workspace, tool: body.tool, prompt, result, model });
  return json({ result, model });
});

function deterministicBrief(workspace: string, tool: string, rows: Array<Record<string, unknown>>, prompt: string) {
  if (workspace === 'sales') {
    const won = rows.filter(row => row.outcome === 'won');
    const avg = rows.length ? rows.reduce((sum, row) => sum + Number(row.score ?? 0), 0) / rows.length : 0;
    const objection = rows.map(row => String(row.primary_objection ?? '')).filter(Boolean).sort((a, b) => rows.filter(r => r.primary_objection === b).length - rows.filter(r => r.primary_objection === a).length)[0] ?? 'not enough data';
    return `Sales brief\n\n${rows.length} calls reviewed · ${won.length} wins · ${avg.toFixed(0)} average score.\n\n1. Coach the ${objection} objection using the strongest won call as the example.\n2. Contact every follow-up within 24 hours.\n3. Add the best discovery question to the team playbook.\n\n${prompt ? `Requested focus: ${prompt}` : 'Log more calls to improve confidence.'}`;
  }
  const spend = rows.reduce((sum, row) => sum + Number(row.spend ?? 0), 0);
  const leads = rows.reduce((sum, row) => sum + Number(row.leads ?? 0), 0);
  const revenue = rows.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0);
  if (tool === 'script') return `Ad script brief\n\nHook: Your leads are not cold. Your response time is.\nPrimary text: Turn paid attention into booked conversations with a system your team can actually run.\nHeadline: Convert More of the Leads You Already Pay For\nCTA: See the system\n\nCustomize this draft with your proof, audience, and compliant claims. ${prompt}`;
  if (tool === 'spy') return `Research plan\n\nStudy three creative patterns: operational pain, proof-led case study, and founder story. Record the opening hook, format, proof mechanism, offer, and CTA. Use the patterns as inspiration—do not copy claims or brand assets.\n\nFocus: ${prompt || 'your primary competitor set'}`;
  if (tool === 'draft') return `Paused Meta draft brief\n\nObjective: Leads\nBudget: Hold until tracking review\nCreative: Founder-led proof story\nPrimary KPI: CPL target\nGuardrails: Create as PAUSED. Verify pixel, URL, audience, budget, placements, and policy compliance before activation.\n\nInput: ${prompt || 'Add your campaign details.'}`;
  return `Account audit\n\n${rows.length} campaigns · $${spend.toFixed(0)} spend · ${leads} leads · $${(leads ? spend / leads : 0).toFixed(2)} CPL · ${(spend ? revenue / spend : 0).toFixed(2)}x ROAS.\n\nScale only campaigns with stable conversion volume and healthy unit economics. Kill clear waste. Iterate borderline campaigns with one creative variable at a time. Keep every budget change below 20% per day unless your operating rules say otherwise.`;
}
