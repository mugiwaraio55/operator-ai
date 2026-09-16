+begin;

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

commit;
