-- Operator AI: complete Charles / AI Sales Manager extension.
-- Run after supabase/schema.sql in Supabase Dashboard > SQL Editor.

begin;

alter table public.sales_calls add column if not exists provider text not null default 'manual';
alter table public.sales_calls add column if not exists external_id text;
alter table public.sales_calls add column if not exists recording_url text;
alter table public.sales_calls add column if not exists transcript text;
alter table public.sales_calls add column if not exists duration_seconds integer check (duration_seconds is null or duration_seconds >= 0);
create unique index if not exists sales_calls_external_unique_idx
  on public.sales_calls (user_id, provider, external_id) where external_id is not null;

alter table public.sales_eod_reports add column if not exists connects bigint not null default 0 check (connects >= 0);
alter table public.sales_eod_reports add column if not exists appointments_set bigint not null default 0 check (appointments_set >= 0);
alter table public.sales_eod_reports add column if not exists mood text check (mood is null or mood in ('great','good','neutral','tough','blocked'));
alter table public.sales_eod_reports add column if not exists help_needed text not null default '';
alter table public.sales_eod_reports add column if not exists crm_updated boolean not null default false;
alter table public.sales_eod_reports add column if not exists custom_answers jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_answers) = 'object');
alter table public.sales_eod_reports add column if not exists submitted_via text not null default 'app' check (submitted_via in ('app','magic_link','api'));

create table if not exists public.sales_manager_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  instructions text not null default 'Be direct, practical, evidence-led, and specific about the next action.',
  soul text not null default 'Charles is a calm, demanding sales leader who coaches without hype.',
  daily_appointment_target integer not null default 8 check (daily_appointment_target between 0 and 10000),
  timezone text not null default 'America/Chicago',
  autopilot_enabled boolean not null default false,
  autopilot_functions jsonb not null default '{"scan":true,"dropball":true,"crm":true,"morale":true,"leadsdigest":true,"briefing":true,"eodEnforce":true,"eodLink":true,"coaching":true}'::jsonb check (jsonb_typeof(autopilot_functions) = 'object'),
  crm_stuck_days integer not null default 7 check (crm_stuck_days between 1 and 365),
  crm_wait_minutes integer not null default 15 check (crm_wait_minutes between 1 and 10080),
  eod_link_enabled boolean not null default true,
  eod_link_send_time time not null default '16:00',
  eod_link_template text not null default 'Please complete today''s EOD report: {url}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sales_manager_settings add column if not exists briefing_send_time time not null default '07:00';
alter table public.sales_manager_settings add column if not exists leads_digest_send_time time not null default '16:30';
alter table public.sales_manager_settings add column if not exists morale_send_time time not null default '17:00';
alter table public.sales_manager_settings add column if not exists coaching_send_time time not null default '16:00';
alter table public.sales_manager_settings add column if not exists eod_enforce_delay_minutes integer not null default 30
  check (eod_enforce_delay_minutes between 0 and 720);
alter table public.sales_manager_settings
  add column if not exists eod_form_schema jsonb not null
  default $eod${"version":1,"title":"Daily sales report","description":"Close out the day with activity, pipeline movement, results, lessons, and tomorrow's exact priorities.","sections":[{"id":"day_overview","title":"Day overview","fields":[{"id":"working_hours","label":"Working hours","type":"short_text","placeholder":"8:30 AM-5:30 PM"},{"id":"mood","label":"Energy","type":"select","required":true,"options":["great","good","neutral","tough","blocked"]}]},{"id":"outbound_activity","title":"Outbound activity","fields":[{"id":"calls_taken","label":"Calls","type":"number","required":true},{"id":"texts_sent","label":"Texts","type":"number"},{"id":"emails_sent","label":"Emails","type":"number"},{"id":"dms_sent","label":"DMs","type":"number"},{"id":"voicemails_left","label":"Voicemails","type":"number"},{"id":"videos_sent","label":"Videos","type":"number"},{"id":"proof_assets_sent","label":"Proof assets sent","type":"short_text","placeholder":"What was sent, and to whom?"}]},{"id":"pipeline_activity","title":"Pipeline activity","fields":[{"id":"new_inbound_inquiries","label":"Inbound prospects dialed","type":"number"},{"id":"outbound_prospects_contacted","label":"Outbound prospects dialed","type":"number"},{"id":"reactivated_prospects","label":"Reactivated prospects","type":"number"},{"id":"connects","label":"Connects","type":"number","required":true},{"id":"appointments_set","label":"New appointments set","type":"number","required":true},{"id":"appointments_on_calendar","label":"Appointments on calendar","type":"number"},{"id":"appointments_showed","label":"Appointments showed","type":"number"}]},{"id":"results","title":"Results","fields":[{"id":"offers_made","label":"Offers made","type":"number"},{"id":"deposits_taken","label":"Deposits taken","type":"number"},{"id":"closes","label":"Closed prospects","type":"number","required":true},{"id":"revenue","label":"Cash collected","type":"currency","required":true},{"id":"expected_revenue","label":"Expected revenue","type":"short_text","placeholder":"Expected value and timing"},{"id":"closed_lost","label":"Closed lost (count and reasons)","type":"long_text"}]},{"id":"objections","title":"Top objections","fields":[{"id":"top_objection_1","label":"Objection #1 and response used","type":"long_text"},{"id":"top_objection_2","label":"Objection #2 and response used","type":"long_text"},{"id":"top_objection_3","label":"Objection #3 and response used","type":"long_text"}]},{"id":"reflection","title":"Reflection","fields":[{"id":"best_conversation","label":"Best conversation and next step","type":"long_text"},{"id":"biggest_lesson","label":"Biggest lesson","type":"long_text"},{"id":"wins","label":"Wins","type":"long_text"},{"id":"blockers","label":"Blockers and losses","type":"long_text"},{"id":"help_needed","label":"Help needed from manager","type":"long_text"}]},{"id":"tomorrow","title":"Tomorrow","fields":[{"id":"priorities","label":"Top priorities and exact next actions","type":"long_text","required":true,"placeholder":"Name the prospect, owner, and next action."}]},{"id":"crm_hygiene","title":"CRM hygiene","fields":[{"id":"crm_updated","label":"CRM is fully updated","type":"checkbox"},{"id":"crm_exceptions","label":"CRM exceptions","type":"long_text","placeholder":"List records that are not updated and why."}]}]}$eod$::jsonb;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_manager_settings_eod_form_schema_check'
      and conrelid = 'public.sales_manager_settings'::regclass
  ) then
    alter table public.sales_manager_settings
      add constraint sales_manager_settings_eod_form_schema_check
      check (
        jsonb_typeof(eod_form_schema) = 'object'
        and eod_form_schema ? 'sections'
        and jsonb_typeof(eod_form_schema -> 'sections') = 'array'
        and octet_length(eod_form_schema::text) <= 100000
      );
  end if;
end $$;

create table if not exists public.charles_account_members (
  member_user_id uuid primary key references auth.users(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','sales_rep')),
  is_active boolean not null default true,
  invited_email text,
  display_name text,
  eod_token text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  invited_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (eod_token)
);
create index if not exists charles_members_owner_active_idx on public.charles_account_members (owner_user_id, is_active, member_user_id);

create table if not exists public.charles_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null check (char_length(content) between 1 and 50000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists charles_messages_user_recent_idx on public.charles_messages (user_id, created_at desc, id desc);

create table if not exists public.charles_memories (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'context' check (kind in ('context','preference','commitment','playbook','coaching')),
  content text not null check (char_length(content) between 1 and 10000),
  source_message_id bigint references public.charles_messages(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists charles_memories_user_recent_idx on public.charles_memories (user_id, created_at desc, id desc);

create table if not exists public.sales_appointments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ghl_appointment_id text,
  prospect_name text,
  prospect_email text,
  prospect_phone text,
  calendar_name text,
  assigned_user_id text,
  assigned_user_name text,
  assigned_user_email text,
  scheduled_at timestamptz not null,
  status text not null default 'booked',
  outcome text not null default 'pending',
  revenue numeric(14,2) not null default 0 check (revenue >= 0),
  call_summary text,
  objections text,
  next_steps text,
  follow_up_at timestamptz,
  source text not null default 'ghl' check (source in ('manual','ghl','webhook')),
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists appointments_ghl_unique_idx on public.sales_appointments (user_id, ghl_appointment_id) where ghl_appointment_id is not null;
create index if not exists appointments_user_schedule_idx on public.sales_appointments (user_id, scheduled_at desc, id desc);

create table if not exists public.sales_opportunities (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ghl_opportunity_id text not null,
  contact_id text,
  name text not null,
  pipeline_id text,
  pipeline_stage_id text,
  status text not null default 'open',
  monetary_value numeric(14,2) not null default 0 check (monetary_value >= 0),
  assigned_to text,
  last_activity_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, ghl_opportunity_id)
);
create index if not exists opportunities_user_status_idx on public.sales_opportunities (user_id, status, last_activity_at desc);

create table if not exists public.sales_call_gradings (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sales_call_id bigint references public.sales_calls(id) on delete set null,
  provider text not null check (provider in ('manual','ghl','fathom')),
  external_call_id text,
  rep_name text,
  rep_email text,
  title text,
  recording_url text,
  transcript text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  status text not null default 'pending' check (status in ('pending','grading','completed','graded','failed')),
  overall_score numeric(5,2) check (overall_score is null or overall_score between 0 and 100),
  script_adherence_pct numeric(5,2) check (script_adherence_pct is null or script_adherence_pct between 0 and 100),
  category_scores jsonb not null default '{}'::jsonb check (jsonb_typeof(category_scores) = 'object'),
  strengths text[] not null default '{}',
  improvements text[] not null default '{}',
  coaching_notes text,
  rep_feedback text,
  grader_model text,
  error_message text,
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  call_started_at timestamptz,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists call_gradings_external_unique_idx on public.sales_call_gradings (user_id, provider, external_call_id) where external_call_id is not null;
create index if not exists call_gradings_user_recent_idx on public.sales_call_gradings (user_id, created_at desc, id desc);

create table if not exists public.sales_webhook_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now(),
  unique (token)
);

create table if not exists public.charles_reminders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_kind text not null,
  dedupe_key text not null,
  subject text not null,
  detail text not null default '',
  due_at timestamptz not null,
  fired_at timestamptz,
  clickup_task_id text,
  created_at timestamptz not null default now(),
  unique (user_id, reminder_kind, dedupe_key)
);
create index if not exists reminders_due_idx on public.charles_reminders (due_at) where fired_at is null;

create table if not exists public.charles_crm_flags (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  flag_kind text not null,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  flagged_at timestamptz not null default now(),
  unique (user_id, item_key)
);
create index if not exists crm_flags_recent_idx on public.charles_crm_flags (user_id, flagged_at desc);

create table if not exists public.charles_morale_daily (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null,
  team_color text not null check (team_color in ('blue','green','yellow','orange','red')),
  per_rep jsonb not null default '{}'::jsonb check (jsonb_typeof(per_rep) = 'object'),
  summary text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, report_date)
);

create table if not exists public.charles_coaching_weekly (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  score numeric(5,2) check (score is null or score between 0 and 100),
  morale text,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  summary text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table if not exists public.sales_os_documents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  title text not null,
  category text not null default 'playbook',
  body_md text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'sales_manager_settings','charles_account_members','charles_messages','charles_memories',
    'sales_appointments','sales_opportunities','sales_call_gradings','sales_webhook_tokens',
    'charles_reminders','charles_crm_flags','charles_morale_daily','charles_coaching_weekly','sales_os_documents'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

drop policy if exists sales_manager_settings_own on public.sales_manager_settings;
create policy sales_manager_settings_own on public.sales_manager_settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists charles_members_self_read on public.charles_account_members;
create policy charles_members_self_read on public.charles_account_members for select to authenticated
  using ((select auth.uid()) = member_user_id);
drop policy if exists charles_members_owner_read on public.charles_account_members;
create policy charles_members_owner_read on public.charles_account_members for select to authenticated
  using ((select auth.uid()) = owner_user_id);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'charles_messages','charles_memories','sales_appointments','sales_opportunities','sales_call_gradings',
    'sales_webhook_tokens','charles_reminders','charles_crm_flags','charles_morale_daily','charles_coaching_weekly','sales_os_documents'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);
  end loop;
end $$;

drop policy if exists charles_memories_delete_own on public.charles_memories;
create policy charles_memories_delete_own on public.charles_memories for delete to authenticated using ((select auth.uid()) = user_id);
drop policy if exists appointments_write_own on public.sales_appointments;
create policy appointments_write_own on public.sales_appointments for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists appointments_update_own on public.sales_appointments;
create policy appointments_update_own on public.sales_appointments for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists sales_os_documents_write_own on public.sales_os_documents;
create policy sales_os_documents_write_own on public.sales_os_documents for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists sales_os_documents_update_own on public.sales_os_documents;
create policy sales_os_documents_update_own on public.sales_os_documents for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists sales_call_gradings_select_team on public.sales_call_gradings;
create policy sales_call_gradings_select_team on public.sales_call_gradings for select to authenticated
  using (exists (
    select 1 from public.charles_account_members membership
    where membership.owner_user_id = (select auth.uid())
      and membership.member_user_id = sales_call_gradings.user_id
      and membership.is_active = true
  ));
drop policy if exists sales_appointments_select_team on public.sales_appointments;
create policy sales_appointments_select_team on public.sales_appointments for select to authenticated
  using (exists (
    select 1 from public.charles_account_members membership
    where membership.owner_user_id = (select auth.uid())
      and membership.member_user_id = sales_appointments.user_id
      and membership.is_active = true
  ));

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'sales_manager_settings','charles_account_members','charles_messages','charles_memories',
    'sales_appointments','sales_opportunities','sales_call_gradings','sales_webhook_tokens',
    'charles_reminders','charles_crm_flags','charles_morale_daily','charles_coaching_weekly','sales_os_documents'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', table_name);
  end loop;
end $$;

grant select, insert, update on public.sales_manager_settings to authenticated;
grant select on public.charles_account_members, public.charles_messages, public.sales_opportunities,
  public.sales_call_gradings, public.sales_webhook_tokens, public.charles_reminders, public.charles_crm_flags,
  public.charles_morale_daily, public.charles_coaching_weekly to authenticated;
grant select, delete on public.charles_memories to authenticated;
grant select, insert, update on public.sales_appointments, public.sales_os_documents to authenticated;
grant usage, select on all sequences in schema public to authenticated;

drop trigger if exists sales_manager_settings_updated_at on public.sales_manager_settings;
create trigger sales_manager_settings_updated_at before update on public.sales_manager_settings for each row execute function public.set_updated_at();
drop trigger if exists charles_members_updated_at on public.charles_account_members;
create trigger charles_members_updated_at before update on public.charles_account_members for each row execute function public.set_updated_at();
drop trigger if exists sales_appointments_updated_at on public.sales_appointments;
create trigger sales_appointments_updated_at before update on public.sales_appointments for each row execute function public.set_updated_at();
drop trigger if exists sales_opportunities_updated_at on public.sales_opportunities;
create trigger sales_opportunities_updated_at before update on public.sales_opportunities for each row execute function public.set_updated_at();
drop trigger if exists sales_call_gradings_updated_at on public.sales_call_gradings;
create trigger sales_call_gradings_updated_at before update on public.sales_call_gradings for each row execute function public.set_updated_at();
drop trigger if exists sales_os_documents_updated_at on public.sales_os_documents;
create trigger sales_os_documents_updated_at before update on public.sales_os_documents for each row execute function public.set_updated_at();

create or replace function public.ensure_my_sales_workspace()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  owner_id uuid;
begin
  if caller is null then raise exception 'Authentication required'; end if;
  insert into public.charles_account_members (member_user_id, owner_user_id, role)
  values (caller, caller, 'owner') on conflict (member_user_id) do nothing;
  select owner_user_id into owner_id from public.charles_account_members where member_user_id = caller;
  insert into public.sales_manager_settings (user_id) values (owner_id) on conflict (user_id) do nothing;
  insert into public.sales_webhook_tokens (user_id) values (owner_id) on conflict (user_id) do nothing;
  insert into public.sales_os_documents (user_id, slug, title, category, body_md) values
    (owner_id, 'sales-process', 'Sales Process', 'playbook', '# Sales Process\n\nDocument qualification, discovery, presentation, objection handling, and follow-up.'),
    (owner_id, 'responsibilities', 'Responsibilities', 'operations', '# Responsibilities\n\nDefine daily standards, ownership, and escalation rules.'),
    (owner_id, 'offer', 'The Offer', 'playbook', '# The Offer\n\nDocument the promise, proof, price, terms, and ideal customer.')
  on conflict (user_id, slug) do nothing;
  return jsonb_build_object('member_user_id', caller, 'owner_user_id', owner_id);
end;
$$;
revoke all on function public.ensure_my_sales_workspace() from public, anon;
grant execute on function public.ensure_my_sales_workspace() to authenticated;

create or replace function public.rotate_my_sales_webhook_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  owner_id uuid;
  fresh text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if caller is null then raise exception 'Authentication required'; end if;
  select owner_user_id into owner_id from public.charles_account_members where member_user_id = caller and is_active;
  if owner_id is null or owner_id <> caller then raise exception 'Owner access required'; end if;
  insert into public.sales_webhook_tokens (user_id, token, rotated_at) values (owner_id, fresh, now())
  on conflict (user_id) do update set token = excluded.token, rotated_at = excluded.rotated_at;
  return fresh;
end;
$$;
revoke all on function public.rotate_my_sales_webhook_token() from public, anon;
grant execute on function public.rotate_my_sales_webhook_token() to authenticated;

commit;
