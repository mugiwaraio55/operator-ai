import { adminClient, authorizeUser, corsHeaders, json } from '../_shared/supabase.ts';

const graphVersion = Deno.env.get('META_GRAPH_API_VERSION') || 'v24.0';
const actionCount = (actions: { action_type?: string; value?: string }[] | undefined, names: string[]) => (actions ?? []).filter(row => names.includes(row.action_type ?? '')).reduce((sum, row) => sum + Number(row.value ?? 0), 0);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const { user } = await authorizeUser(req);
  if (!user) return json({ error: 'Sign in is required.' }, 401);
  const body = await req.json().catch(() => ({})) as { createClickUpTask?: boolean; testClickUp?: boolean; setClickUpListId?: string };
  const admin = adminClient();

  if (body.setClickUpListId) {
    const selected = await selectClickUpList(admin, user.id, body.setClickUpListId);
    return selected.ok ? json(selected) : json({ error: selected.error }, 409);
  }
  if (body.testClickUp) {
    const delivered = await createClickUpBrief(admin, user.id, [], 'Operator AI', true);
    return delivered.ok ? json(delivered) : json({ error: delivered.error }, 409);
  }

  const { data: connection } = await admin.from('integration_connections').select('account_id,account_name,metadata').eq('user_id', user.id).eq('provider', 'meta').maybeSingle();
  if (!connection?.account_id) return json({ error: 'Connect Meta Ads first.' }, 409);
  const { data: token, error: tokenError } = await admin.rpc('get_integration_secret', { p_user: user.id, p_provider: 'meta' });
  if (tokenError || !token) return json({ error: 'The Meta connection needs to be refreshed.' }, 409);

  const insightsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${connection.account_id}/insights`);
  insightsUrl.search = new URLSearchParams({ access_token: token, level: 'campaign', date_preset: 'last_7d', fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,date_start,date_stop', limit: '100' }).toString();
  const campaignsUrl = new URL(`https://graph.facebook.com/${graphVersion}/act_${connection.account_id}/campaigns`);
  campaignsUrl.search = new URLSearchParams({ access_token: token, fields: 'id,name,status', limit: '100' }).toString();
  const [insightsResponse, campaignsResponse] = await Promise.all([fetch(insightsUrl), fetch(campaignsUrl)]);
  const insightsPayload = await insightsResponse.json() as { data?: Array<Record<string, unknown>>; error?: { message?: string } };
  const campaignsPayload = await campaignsResponse.json() as { data?: { id: string; status?: string }[] };
  if (!insightsResponse.ok) return json({ error: insightsPayload.error?.message ?? 'Meta insights could not be loaded.' }, 502);
  const statusById = new Map((campaignsPayload.data ?? []).map(row => [row.id, row.status ?? 'UNKNOWN']));
  const currency = typeof connection.metadata?.currency === 'string' ? connection.metadata.currency : 'USD';
  const rows = (insightsPayload.data ?? []).map(row => {
    const actions = Array.isArray(row.actions) ? row.actions as { action_type?: string; value?: string }[] : [];
    const values = Array.isArray(row.action_values) ? row.action_values as { action_type?: string; value?: string }[] : [];
    return { user_id: user.id, ad_account_id: connection.account_id, meta_campaign_id: String(row.campaign_id), campaign_name: String(row.campaign_name ?? 'Unnamed campaign'), status: statusById.get(String(row.campaign_id)) ?? 'UNKNOWN', spend: Number(row.spend ?? 0), impressions: Number(row.impressions ?? 0), clicks: Number(row.clicks ?? 0), leads: actionCount(actions, ['lead', 'offsite_conversion.fb_pixel_lead']), purchases: actionCount(actions, ['purchase', 'offsite_conversion.fb_pixel_purchase']), revenue: actionCount(values, ['purchase', 'offsite_conversion.fb_pixel_purchase']), currency, date_start: String(row.date_start), date_stop: String(row.date_stop), raw_payload: row, synced_at: new Date().toISOString() };
  });
  if (rows.length) {
    const { error } = await admin.from('meta_campaign_snapshots').upsert(rows, { onConflict: 'user_id,ad_account_id,meta_campaign_id,date_start,date_stop' });
    if (error) return json({ error: error.message }, 500);
  }

  if (body.createClickUpTask) {
    const delivered = await createClickUpBrief(admin, user.id, rows, connection.account_name ?? 'Meta Ads');
    if (!delivered.ok) return json({ error: delivered.error }, 409);
  }
  return json({ ok: true, campaigns: rows.length });
});

async function selectClickUpList(admin: ReturnType<typeof adminClient>, userId: string, listId: string) {
  const normalizedId = listId.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(normalizedId)) return { ok: false, error: 'Enter a valid ClickUp List ID.' };
  const { data: token } = await admin.rpc('get_integration_secret', { p_user: userId, p_provider: 'clickup' });
  if (!token) return { ok: false, error: 'Connect ClickUp before choosing a List.' };
  const response = await fetch(`https://api.clickup.com/api/v2/list/${encodeURIComponent(normalizedId)}`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({})) as { id?: string; name?: string; space?: { id?: string; name?: string } };
  if (!response.ok || !payload.id) return { ok: false, error: 'ClickUp could not access that List. Check the List ID and Workspace authorization.' };
  const { data: connection } = await admin.from('integration_connections').select('metadata').eq('user_id', userId).eq('provider', 'clickup').maybeSingle();
  const metadata = { ...(connection?.metadata ?? {}), list_id: String(payload.id), list_name: payload.name ?? `List ${payload.id}`, space_id: payload.space?.id ?? null, space_name: payload.space?.name ?? null };
  const { error } = await admin.from('integration_connections').update({ metadata, refreshed_at: new Date().toISOString() }).eq('user_id', userId).eq('provider', 'clickup');
  return error ? { ok: false, error: error.message } : { ok: true, listId: String(payload.id), listName: metadata.list_name };
}

async function createClickUpBrief(admin: ReturnType<typeof adminClient>, userId: string, rows: Array<Record<string, unknown>>, accountName: string, isTest = false) {
  const [{ data: token }, { data: connection }] = await Promise.all([
    admin.rpc('get_integration_secret', { p_user: userId, p_provider: 'clickup' }),
    admin.from('integration_connections').select('metadata').eq('user_id', userId).eq('provider', 'clickup').maybeSingle(),
  ]);
  if (!token) return { ok: false, error: 'Connect ClickUp before creating a brief.' };
  const listId = typeof connection?.metadata?.list_id === 'string' ? connection.metadata.list_id : '';
  if (!listId) return { ok: false, error: 'Choose a ClickUp List before creating a brief.' };
  const spend = rows.reduce((sum, row) => sum + Number(row.spend ?? 0), 0);
  const leads = rows.reduce((sum, row) => sum + Number(row.leads ?? 0), 0);
  const revenue = rows.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0);
  const name = isTest ? 'Operator AI - ClickUp connection test' : `Operator AI - Media Buyer brief - ${new Date().toISOString().slice(0, 10)}`;
  const markdown = isTest
    ? '## ClickUp is connected\n\nOperator AI can now create Meta campaign briefs in this List.'
    : `## Media Buyer brief\n\n**Account:** ${accountName}\n\n- Spend: $${spend.toFixed(0)}\n- Leads: ${leads}\n- CPL: $${(leads ? spend / leads : 0).toFixed(2)}\n- ROAS: ${(spend ? revenue / spend : 0).toFixed(2)}x\n\nReview scale, iterate, and kill decisions in the Operator AI dashboard.`;
  const response = await fetch(`https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}/task`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, markdown_content: markdown }) });
  const payload = await response.json().catch(() => ({})) as { id?: string; url?: string; err?: string };
  const status = response.ok ? 'sent' : 'failed';
  await admin.from('clickup_task_deliveries').insert({ user_id: userId, list_id: listId, task_kind: isTest ? 'test' : 'media_brief', clickup_task_id: payload.id ?? null, clickup_task_url: payload.url ?? null, status, error_message: response.ok ? null : payload.err ?? 'ClickUp rejected the task.' });
  return response.ok ? { ok: true, taskId: payload.id, taskUrl: payload.url } : { ok: false, error: payload.err ?? 'ClickUp rejected the task.' };
}
