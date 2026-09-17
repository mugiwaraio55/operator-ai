-- Operator AI / Charles recurring jobs.
-- Run after schema.sql and ai_sales_manager.sql.
-- First add these two Vault secrets in the Supabase SQL Editor:
--   select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
--   select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare job record;
begin
  for job in select jobid from cron.job where jobname = any(array[
    'charles-scan','charles-crm','charles-morale','charles-dropball','charles-leadsdigest',
    'charles-briefing','charles-eod','charles-eod-link','charles-coaching',
    'charles-appointments','charles-accountability','charles-command-report','charles-transition','media-buyer-monitor'
  ]) loop
    perform cron.unschedule(job.jobid);
  end loop;
end $$;

create or replace function private.run_charles_autopilot(p_mode text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1) || '/functions/v1/charles-autopilot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1)
    ),
    body := jsonb_build_object('mode', p_mode),
    timeout_milliseconds := 55000
  );
$$;
revoke all on function private.run_charles_autopilot(text) from public, anon, authenticated;

create or replace function private.run_media_buyer_monitor()
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1) || '/functions/v1/media-buyer-tools',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key' limit 1)),
    body := '{"action":"run-monitor-all"}'::jsonb,
    timeout_milliseconds := 55000
  );
$$;
revoke all on function private.run_media_buyer_monitor() from public, anon, authenticated;

select cron.schedule('charles-scan', '*/5 * * * *', $$select private.run_charles_autopilot('scan');$$);
select cron.schedule('charles-crm', '*/15 * * * *', $$select private.run_charles_autopilot('crm');$$);
select cron.schedule('charles-morale', '*/15 * * * 1-5', $$select private.run_charles_autopilot('morale');$$);
select cron.schedule('charles-dropball', '*/15 * * * 1-5', $$select private.run_charles_autopilot('dropball');$$);
select cron.schedule('charles-leadsdigest', '*/15 * * * 1-5', $$select private.run_charles_autopilot('leadsdigest');$$);
select cron.schedule('charles-briefing', '*/15 * * * 1-5', $$select private.run_charles_autopilot('briefing');$$);
select cron.schedule('charles-eod', '*/20 * * * 1-5', $$select private.run_charles_autopilot('eodEnforce');$$);
select cron.schedule('charles-eod-link', '*/15 * * * 1-5', $$select private.run_charles_autopilot('eodLink');$$);
select cron.schedule('charles-coaching', '*/30 * * 5', $$select private.run_charles_autopilot('coaching');$$);
select cron.schedule('charles-appointments', '2,17,32,47 * * * 1-5', $$select private.run_charles_autopilot('appointments');$$);
select cron.schedule('charles-accountability', '4,9,14,19,24,29,34,39,44,49,54,59 * * * 1-5', $$select private.run_charles_autopilot('accountability');$$);
select cron.schedule('charles-command-report', '11,26,41,56 * * * 1-5', $$select private.run_charles_autopilot('commandReport');$$);
select cron.schedule('charles-transition', '13 * * * 1-5', $$select private.run_charles_autopilot('transition');$$);
select cron.schedule('media-buyer-monitor', '7 * * * *', $$select private.run_media_buyer_monitor();$$);
