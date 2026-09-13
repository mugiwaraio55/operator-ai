-- Operator AI: complete AI Media Buyer extension.
-- Run after supabase/schema.sql in Supabase Dashboard > SQL Editor.

begin;

create table if not exists public.media_buyer_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tools_enabled boolean not null default true,
  review_policy text not null default 'paused_only' check (review_policy = 'paused_only'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_buyer_tool_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null check (ad_account_id ~ '^[0-9]+$' and char_length(ad_account_id) <= 40),
  action text not null check (action in (
    'audit-ad-account','spy-ads','script-ads','launch-meta-ads',
    'list-meta-structure','preview-meta-ad'
  )),
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists media_buyer_runs_user_account_recent_idx
  on public.media_buyer_tool_runs (user_id, ad_account_id, created_at desc, id desc);

create table if not exists public.meta_draft_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null check (ad_account_id ~ '^[0-9]+$' and char_length(ad_account_id) <= 40),
  campaign_id text,
  adset_id text,
  creative_id text,
  ad_id text,
  status text not null default 'creating' check (status in ('creating','partial','created','failed')),
  brief jsonb not null default '{}'::jsonb check (jsonb_typeof(brief) = 'object'),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meta_drafts_user_account_recent_idx
  on public.meta_draft_records (user_id, ad_account_id, created_at desc, id desc);

drop trigger if exists media_buyer_settings_updated_at on public.media_buyer_settings;
create trigger media_buyer_settings_updated_at before update on public.media_buyer_settings
  for each row execute function public.set_updated_at();
drop trigger if exists meta_draft_records_updated_at on public.meta_draft_records;
create trigger meta_draft_records_updated_at before update on public.meta_draft_records
  for each row execute function public.set_updated_at();

alter table public.media_buyer_settings enable row level security;
alter table public.media_buyer_tool_runs enable row level security;
alter table public.meta_draft_records enable row level security;

drop policy if exists media_buyer_settings_own on public.media_buyer_settings;
create policy media_buyer_settings_own on public.media_buyer_settings for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists media_buyer_runs_own on public.media_buyer_tool_runs;
create policy media_buyer_runs_own on public.media_buyer_tool_runs for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists meta_drafts_own on public.meta_draft_records;
create policy meta_drafts_own on public.meta_draft_records for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.media_buyer_settings, public.media_buyer_tool_runs, public.meta_draft_records
  from anon, authenticated;
grant select on public.media_buyer_settings, public.media_buyer_tool_runs, public.meta_draft_records
  to authenticated;

commit;
