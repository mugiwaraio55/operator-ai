-- Operator AI: standalone AI Sales Manager + AI Media Buyer schema.
-- Run this file once in Supabase Dashboard > SQL Editor.
-- All browser-visible tables use RLS. OAuth tokens are stored in Supabase Vault
-- and may only be read or changed by the service_role used inside Edge Functions.

begin;

create extension if not exists supabase_vault with schema vault;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null default 'My business',
  default_currency text not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  sales_monthly_target numeric(14,2) not null default 100000 check (sales_monthly_target >= 0),
  target_cpl numeric(12,2) not null default 45 check (target_cpl > 0),
  target_roas numeric(8,2) not null default 2.5 check (target_roas > 0),
  ai_instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.integration_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('clickup', 'meta', 'ghl', 'ai', 'fathom')),
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  account_id text,
  account_name text,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  connected_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create table if not exists private.integration_secret_refs (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('clickup', 'meta', 'ghl', 'ai', 'fathom')),
  secret_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider),
  unique (secret_id)
);

create table if not exists private.oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('clickup', 'meta')),
  return_url text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists oauth_states_expiry_idx on private.oauth_states (expires_at);

create table if not exists public.sales_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  prospect_name text not null check (char_length(prospect_name) between 1 and 160),
  rep_name text not null check (char_length(rep_name) between 1 and 120),
  outcome text not null check (outcome in ('won', 'lost', 'follow_up', 'no_show')),
  score numeric(5,2) not null check (score between 0 and 100),
  revenue numeric(14,2) not null default 0 check (revenue >= 0),
  primary_objection text not null default '' check (char_length(primary_objection) <= 240),
  notes text not null default '',
  source text not null default 'manual' check (source in ('manual', 'webhook', 'import')),
  happened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_calls_user_recent_idx on public.sales_calls (user_id, happened_at desc, id desc);
create index if not exists sales_calls_user_outcome_idx on public.sales_calls (user_id, outcome, happened_at desc);

create table if not exists public.sales_eod_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null default current_date,
  calls_taken bigint not null default 0 check (calls_taken >= 0),
  closes bigint not null default 0 check (closes >= 0 and closes <= calls_taken),
  revenue numeric(14,2) not null default 0 check (revenue >= 0),
  wins text not null default '',
  blockers text not null default '',
  priorities text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, report_date)
);
create index if not exists sales_eod_user_recent_idx on public.sales_eod_reports (user_id, report_date desc);

create table if not exists public.meta_campaign_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  meta_campaign_id text not null,
  campaign_name text not null,
  status text not null default 'UNKNOWN',
  spend numeric(14,2) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  leads bigint not null default 0 check (leads >= 0),
  purchases bigint not null default 0 check (purchases >= 0),
  revenue numeric(14,2) not null default 0 check (revenue >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  date_start date not null,
  date_stop date not null,
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, ad_account_id, meta_campaign_id, date_start, date_stop)
);
create index if not exists meta_snapshots_user_period_idx on public.meta_campaign_snapshots (user_id, date_start desc, date_stop desc);
create index if not exists meta_snapshots_user_campaign_idx on public.meta_campaign_snapshots (user_id, meta_campaign_id, synced_at desc);

create table if not exists public.ai_recommendations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace text not null check (workspace in ('sales', 'media')),
  subject_id text,
  action text not null check (action in ('coach', 'follow_up', 'share', 'scale', 'iterate', 'kill', 'review')),
  title text not null,
  detail text not null default '',
  priority smallint not null default 2 check (priority between 1 and 3),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists recommendations_open_idx on public.ai_recommendations (user_id, workspace, created_at desc) where status = 'open';

create table if not exists public.assistant_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace text not null check (workspace in ('sales', 'media')),
  tool text not null,
  prompt text not null default '',
  result text not null,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists assistant_runs_user_recent_idx on public.assistant_runs (user_id, workspace, created_at desc);

create table if not exists public.clickup_task_deliveries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  list_id text not null,
  task_kind text not null check (task_kind in ('sales_brief', 'media_brief', 'test')),
  clickup_task_id text,
  clickup_task_url text,
  status text not null check (status in ('sent', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists clickup_deliveries_user_recent_idx on public.clickup_task_deliveries (user_id, created_at desc);

drop trigger if exists app_settings_updated_at on public.app_settings;
create trigger app_settings_updated_at before update on public.app_settings for each row execute function public.set_updated_at();
drop trigger if exists sales_calls_updated_at on public.sales_calls;
create trigger sales_calls_updated_at before update on public.sales_calls for each row execute function public.set_updated_at();
drop trigger if exists sales_eod_updated_at on public.sales_eod_reports;
create trigger sales_eod_updated_at before update on public.sales_eod_reports for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
alter table public.integration_connections enable row level security;
alter table public.sales_calls enable row level security;
alter table public.sales_eod_reports enable row level security;
alter table public.meta_campaign_snapshots enable row level security;
alter table public.ai_recommendations enable row level security;
alter table public.assistant_runs enable row level security;
alter table public.clickup_task_deliveries enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['app_settings','integration_connections','sales_calls','sales_eod_reports','meta_campaign_snapshots','ai_recommendations','assistant_runs','clickup_task_deliveries']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);
  end loop;
end $$;

drop policy if exists app_settings_insert_own on public.app_settings;
create policy app_settings_insert_own on public.app_settings for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists app_settings_update_own on public.app_settings;
create policy app_settings_update_own on public.app_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists sales_calls_insert_own on public.sales_calls;
create policy sales_calls_insert_own on public.sales_calls for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists sales_calls_update_own on public.sales_calls;
create policy sales_calls_update_own on public.sales_calls for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists sales_calls_delete_own on public.sales_calls;
create policy sales_calls_delete_own on public.sales_calls for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists sales_eod_insert_own on public.sales_eod_reports;
create policy sales_eod_insert_own on public.sales_eod_reports for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists sales_eod_update_own on public.sales_eod_reports;
create policy sales_eod_update_own on public.sales_eod_reports for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.app_settings, public.integration_connections, public.sales_calls, public.sales_eod_reports,
  public.meta_campaign_snapshots, public.ai_recommendations, public.assistant_runs, public.clickup_task_deliveries from anon;
revoke all on public.app_settings, public.integration_connections, public.sales_calls, public.sales_eod_reports,
  public.meta_campaign_snapshots, public.ai_recommendations, public.assistant_runs, public.clickup_task_deliveries from authenticated;
grant select, insert, update on public.app_settings to authenticated;
grant select on public.integration_connections, public.meta_campaign_snapshots, public.ai_recommendations, public.assistant_runs, public.clickup_task_deliveries to authenticated;
grant select, insert, update, delete on public.sales_calls to authenticated;
grant select, insert, update on public.sales_eod_reports to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create or replace function public.set_integration_secret(p_user uuid, p_provider text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_id uuid;
  secret_name text := 'operator-ai:' || p_user::text || ':' || p_provider;
begin
  if p_provider not in ('clickup', 'meta', 'ghl', 'ai', 'fathom') or btrim(coalesce(p_secret, '')) = '' then
    raise exception 'Invalid integration secret';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(secret_name, 0));
  select secret_id into stored_id from private.integration_secret_refs
    where user_id = p_user and provider = p_provider for update;
  if stored_id is null then
    select id into stored_id from vault.secrets where name = secret_name;
  end if;
  if stored_id is null then
    stored_id := vault.create_secret(p_secret, secret_name, 'Operator AI OAuth token');
  else
    perform vault.update_secret(stored_id, p_secret);
  end if;
  insert into private.integration_secret_refs (user_id, provider, secret_id, updated_at)
  values (p_user, p_provider, stored_id, now())
  on conflict (user_id, provider) do update set secret_id = excluded.secret_id, updated_at = now();
end;
$$;

create or replace function public.get_integration_secret(p_user uuid, p_provider text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted.decrypted_secret
  from private.integration_secret_refs refs
  join vault.decrypted_secrets decrypted on decrypted.id = refs.secret_id
  where refs.user_id = p_user and refs.provider = p_provider;
$$;

create or replace function public.clear_integration_secret(p_user uuid, p_provider text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare stored_id uuid;
begin
  select secret_id into stored_id from private.integration_secret_refs
    where user_id = p_user and provider = p_provider for update;
  delete from private.integration_secret_refs where user_id = p_user and provider = p_provider;
  if stored_id is not null then delete from vault.secrets where id = stored_id; end if;
end;
$$;

create or replace function public.put_oauth_state(p_hash text, p_user uuid, p_provider text, p_return_url text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.oauth_states (state_hash, user_id, provider, return_url, expires_at)
  values (p_hash, p_user, p_provider, p_return_url, now() + interval '10 minutes');
$$;

create or replace function public.consume_oauth_state(p_hash text, p_provider text)
returns table (user_id uuid, return_url text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    delete from private.oauth_states state_row
    where state_row.state_hash = p_hash
      and state_row.provider = p_provider
      and state_row.expires_at > now()
    returning state_row.user_id, state_row.return_url;
end;
$$;

revoke all on function public.set_integration_secret(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_integration_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.clear_integration_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.put_oauth_state(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.consume_oauth_state(text, text) from public, anon, authenticated;
grant execute on function public.set_integration_secret(uuid, text, text) to service_role;
grant execute on function public.get_integration_secret(uuid, text) to service_role;
grant execute on function public.clear_integration_secret(uuid, text) to service_role;
grant execute on function public.put_oauth_state(text, uuid, text, text) to service_role;
grant execute on function public.consume_oauth_state(text, text) to service_role;

commit;
