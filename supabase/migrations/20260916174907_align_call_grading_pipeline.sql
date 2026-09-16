alter table public.sales_call_gradings
  drop constraint if exists sales_call_gradings_status_check;

alter table public.sales_call_gradings
  add constraint sales_call_gradings_status_check
  check (status in ('pending', 'grading', 'completed', 'graded', 'failed'));

alter table public.sales_call_gradings
  add column if not exists rep_feedback text;

alter table public.sales_appointments
  add column if not exists assigned_user_email text;

drop policy if exists charles_members_owner_read on public.charles_account_members;
create policy charles_members_owner_read
on public.charles_account_members for select to authenticated
using ((select auth.uid()) = owner_user_id);

drop policy if exists sales_call_gradings_select_team on public.sales_call_gradings;
create policy sales_call_gradings_select_team
on public.sales_call_gradings for select to authenticated
using (
  exists (
    select 1
    from public.charles_account_members membership
    where membership.owner_user_id = (select auth.uid())
      and membership.member_user_id = sales_call_gradings.user_id
      and membership.is_active = true
  )
);

drop policy if exists sales_appointments_select_team on public.sales_appointments;
create policy sales_appointments_select_team
on public.sales_appointments for select to authenticated
using (
  exists (
    select 1
    from public.charles_account_members membership
    where membership.owner_user_id = (select auth.uid())
      and membership.member_user_id = sales_appointments.user_id
      and membership.is_active = true
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sales_call_gradings'
  ) then
    alter publication supabase_realtime add table public.sales_call_gradings;
  end if;
end $$;
