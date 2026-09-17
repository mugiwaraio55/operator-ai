begin;

-- Optional Slack is an additional delivery channel; ClickUp remains supported.
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('clickup','meta','ghl','ai','fathom','slack'));
alter table private.integration_secret_refs drop constraint if exists integration_secret_refs_provider_check;
alter table private.integration_secret_refs add constraint integration_secret_refs_provider_check
  check (provider in ('clickup','meta','ghl','ai','fathom','slack'));

alter table public.clickup_task_deliveries drop constraint if exists clickup_task_deliveries_task_kind_check;
alter table public.clickup_task_deliveries add constraint clickup_task_deliveries_task_kind_check
  check (task_kind in ('sales_brief','media_brief','test','accountability','eod','command_report','coaching','transition'));

alter table public.sales_manager_settings
  add column if not exists delivery_channel text not null default 'clickup'
    check (delivery_channel in ('clickup','slack','both')),
  add column if not exists slack_default_channel text,
  add column if not exists command_report_send_time time not null default '17:30',
  add column if not exists appointment_reminder_minutes integer[] not null default '{0,10,30,60}',
  add column if not exists disposition_due_minutes integer not null default 10
    check (disposition_due_minutes between 1 and 1440);

update public.sales_manager_settings
set autopilot_functions = autopilot_functions ||
  '{"appointments":true,"accountability":true,"commandReport":true,"transition":true}'::jsonb;

alter table public.charles_account_members drop constraint if exists charles_account_members_role_check;
alter table public.charles_account_members add constraint charles_account_members_role_check
  check (role in ('owner','sales_manager','sales_rep','support'));
alter table public.charles_account_members
  add column if not exists manager_user_id uuid references auth.users(id) on delete set null,
  add column if not exists slack_user_id text,
  add column if not exists permissions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(permissions) = 'object');
create index if not exists charles_members_manager_idx
  on public.charles_account_members (owner_user_id, manager_user_id, is_active);

alter table public.sales_appointments
  add column if not exists outcome_reported_at timestamptz,
  add column if not exists disposition_due_at timestamptz,
  add column if not exists client_transition_required boolean not null default false;

create table if not exists public.sales_accountability_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  rep_user_id uuid references auth.users(id) on delete cascade,
  appointment_id bigint references public.sales_appointments(id) on delete cascade,
  cadence_minutes integer not null check (cadence_minutes in (0,10,30,60)),
  event_kind text not null check (event_kind in ('appointment_reminder','disposition_overdue','target_shortfall','feedback_ready')),
  delivery_channel text not null default 'clickup' check (delivery_channel in ('clickup','slack','both','none')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed','skipped')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, appointment_id, event_kind, cadence_minutes)
);
create index if not exists accountability_owner_recent_idx
  on public.sales_accountability_events (user_id, created_at desc);

create table if not exists public.sales_command_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  per_rep jsonb not null default '[]'::jsonb check (jsonb_typeof(per_rep) = 'array'),
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, report_date)
);

create table if not exists public.sales_client_transitions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id bigint references public.sales_opportunities(id) on delete set null,
  appointment_id bigint references public.sales_appointments(id) on delete set null,
  client_name text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('open','ready','completed','blocked')),
  checklist jsonb not null default '[{"key":"payment","label":"Payment confirmed","done":false},{"key":"agreement","label":"Agreement signed","done":false},{"key":"onboarding","label":"Onboarding booked","done":false},{"key":"handoff","label":"Internal handoff complete","done":false},{"key":"crm","label":"CRM record finalized","done":false}]'::jsonb
    check (jsonb_typeof(checklist) = 'array'),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists client_transition_opportunity_unique_idx
  on public.sales_client_transitions (user_id, opportunity_id) where opportunity_id is not null;

create table if not exists public.sales_ghl_contacts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ghl_contact_id text not null,
  name text,
  email text,
  phone text,
  assigned_to text,
  source text,
  score numeric(8,2) not null default 0,
  conversation_count integer not null default 0,
  last_activity_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  synced_at timestamptz not null default now(),
  unique (user_id, ghl_contact_id)
);
create index if not exists ghl_contacts_owner_score_idx
  on public.sales_ghl_contacts (user_id, score desc, last_activity_at desc);

create table if not exists public.sales_ghl_reference (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('user','calendar','pipeline','stage')),
  external_id text not null,
  name text not null default '',
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  synced_at timestamptz not null default now(),
  unique (user_id, kind, external_id)
);

alter table public.ai_recommendations drop constraint if exists ai_recommendations_status_check;
alter table public.ai_recommendations add constraint ai_recommendations_status_check
  check (status in ('open','approved','rejected','executing','executed','failed','done','dismissed'));
alter table public.ai_recommendations
  add column if not exists proposed_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(proposed_payload) = 'object'),
  add column if not exists decision_note text,
  add column if not exists decided_at timestamptz,
  add column if not exists executed_at timestamptz,
  add column if not exists execution_error text;
create unique index if not exists media_recommendations_active_unique_idx
  on public.ai_recommendations (user_id, subject_id, action)
  where workspace = 'media' and status in ('open','approved','executing');

alter table public.media_buyer_settings
  add column if not exists autopilot_enabled boolean not null default false,
  add column if not exists timezone text not null default 'America/Chicago',
  add column if not exists target_cpl numeric(12,2) not null default 45 check (target_cpl > 0),
  add column if not exists target_roas numeric(8,2) not null default 2.5 check (target_roas > 0),
  add column if not exists max_daily_spend numeric(14,2) not null default 1000 check (max_daily_spend >= 0),
  add column if not exists fatigue_ctr_drop_pct numeric(5,2) not null default 25 check (fatigue_ctr_drop_pct between 1 and 100),
  add column if not exists brief_send_time time not null default '08:00',
  add column if not exists clickup_alerts boolean not null default true;

create table if not exists public.media_alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  campaign_id text,
  alert_kind text not null check (alert_kind in ('spend','cpl','roas','tracking','delivery','creative_fatigue')),
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  title text not null,
  detail text not null default '',
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  dedupe_key text not null,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (user_id, dedupe_key)
);
create index if not exists media_alerts_owner_open_idx
  on public.media_alerts (user_id, created_at desc) where status = 'open';

create table if not exists public.media_attribution_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  meta_campaign_id text not null,
  report_date date not null,
  leads integer not null default 0,
  appointments integer not null default 0,
  won integer not null default 0,
  revenue numeric(14,2) not null default 0,
  spend numeric(14,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ad_account_id, meta_campaign_id, report_date)
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'sales_accountability_events','sales_command_reports','sales_client_transitions',
    'sales_ghl_contacts','sales_ghl_reference','media_alerts','media_attribution_snapshots'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);
  end loop;
end $$;

drop policy if exists recommendations_update_own on public.ai_recommendations;
create policy recommendations_update_own on public.ai_recommendations for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.sales_accountability_events, public.sales_command_reports,
  public.sales_client_transitions, public.sales_ghl_contacts, public.sales_ghl_reference,
  public.media_alerts, public.media_attribution_snapshots from anon, authenticated;
grant select on public.sales_accountability_events, public.sales_command_reports,
  public.sales_client_transitions, public.sales_ghl_contacts, public.sales_ghl_reference,
  public.media_alerts, public.media_attribution_snapshots to authenticated;
grant update on public.ai_recommendations to authenticated;

drop trigger if exists sales_command_reports_updated_at on public.sales_command_reports;
create trigger sales_command_reports_updated_at before update on public.sales_command_reports
  for each row execute function public.set_updated_at();
drop trigger if exists sales_client_transitions_updated_at on public.sales_client_transitions;
create trigger sales_client_transitions_updated_at before update on public.sales_client_transitions
  for each row execute function public.set_updated_at();
drop trigger if exists media_attribution_updated_at on public.media_attribution_snapshots;
create trigger media_attribution_updated_at before update on public.media_attribution_snapshots
  for each row execute function public.set_updated_at();

-- Replace the secret setter so Slack tokens can be stored only in Vault.
create or replace function public.set_integration_secret(p_user uuid, p_provider text, p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
declare stored_id uuid; secret_name text := 'operator-ai:' || p_user::text || ':' || p_provider;
begin
  if p_provider not in ('clickup','meta','ghl','ai','fathom','slack') or btrim(coalesce(p_secret,'')) = '' then
    raise exception 'Invalid integration secret';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(secret_name, 0));
  select secret_id into stored_id from private.integration_secret_refs where user_id=p_user and provider=p_provider for update;
  if stored_id is null then select id into stored_id from vault.secrets where name=secret_name; end if;
  if stored_id is null then
    stored_id := vault.create_secret(p_secret, secret_name, 'Operator AI integration secret');
  else
    perform vault.update_secret(stored_id,p_secret);
  end if;
  insert into private.integration_secret_refs(user_id,provider,secret_id,updated_at) values(p_user,p_provider,stored_id,now())
  on conflict(user_id,provider) do update set secret_id=excluded.secret_id,updated_at=now();
end; $$;
revoke all on function public.set_integration_secret(uuid,text,text) from public, anon, authenticated;
grant execute on function public.set_integration_secret(uuid,text,text) to service_role;

commit;
