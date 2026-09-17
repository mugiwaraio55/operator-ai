import { adminClient, corsHeaders, json } from "../_shared/supabase.ts";
import {
  createClickUpTask,
  deliverSalesMessage,
  ghlCredentials,
  ghlFetch,
} from "../_shared/sales.ts";

const modes = new Set([
  "scan",
  "dropball",
  "crm",
  "morale",
  "leadsdigest",
  "briefing",
  "eodEnforce",
  "eodLink",
  "coaching",
  "appointments",
  "accountability",
  "commandReport",
  "transition",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!isServiceRequest(req)) {
    return json({ error: "Service-role authorization is required." }, 403);
  }
  const body = (await req.json().catch(() => ({}))) as {
    mode?: string;
    ownerUserId?: string;
  };
  const mode = String(body.mode ?? "scan");
  if (!modes.has(mode)) {
    return json({ error: "Unsupported autopilot mode." }, 400);
  }
  const admin = adminClient();
  let query = admin
    .from("sales_manager_settings")
    .select("*")
    .eq("autopilot_enabled", true);
  if (body.ownerUserId) query = query.eq("user_id", body.ownerUserId);
  const { data: settings, error } = await query;
  if (error) return json({ error: error.message }, 500);
  const results = [];
  for (const row of settings ?? []) {
    if (row.autopilot_functions?.[mode] === false) {
      results.push({ owner: row.user_id, skipped: "disabled" });
      continue;
    }
    try {
      results.push({
        owner: row.user_id,
        ...(await runMode(admin, row.user_id, mode, row)),
      });
    } catch (caught) {
      console.error("charles-autopilot", mode, row.user_id, caught);
      results.push({
        owner: row.user_id,
        error: caught instanceof Error ? caught.message : "failed",
      });
    }
  }
  return json({ ok: true, mode, operators: results });
});

async function runMode(
  admin: ReturnType<typeof adminClient>,
  ownerId: string,
  mode: string,
  settings: Record<string, unknown>,
) {
  const timeZone = String(settings.timezone ?? "America/Chicago");
  const today = businessDate(timeZone);
  if (
    mode === "briefing" &&
    !scheduleReached(timeZone, String(settings.briefing_send_time ?? "07:00"))
  ) return { created: false, reason: "before_briefing_time" };
  if (
    mode === "leadsdigest" &&
    !scheduleReached(
      timeZone,
      String(settings.leads_digest_send_time ?? "16:30"),
    )
  ) return { created: false, reason: "before_lead_digest_time" };
  if (
    mode === "morale" &&
    !scheduleReached(timeZone, String(settings.morale_send_time ?? "17:00"))
  ) return { created: false, reason: "before_morale_time" };
  if (mode === "coaching") {
    if (businessWeekday(timeZone) !== 5) {
      return { created: false, reason: "not_local_friday" };
    }
    if (
      !scheduleReached(
        timeZone,
        String(settings.coaching_send_time ?? "16:00"),
      )
    ) return { created: false, reason: "before_coaching_time" };
  }
  if (mode === "scan") return scanReminders(admin, ownerId);
  if (mode === "appointments") {
    const start = new Date(`${today}T00:00:00Z`).toISOString();
    const end = new Date(`${today}T23:59:59Z`).toISOString();
    const [{ count }, memberIds] = await Promise.all([
      admin.from("sales_appointments").select("id", { count: "exact", head: true })
        .eq("user_id", ownerId).gte("scheduled_at", start).lte("scheduled_at", end),
      activeMemberIds(admin, ownerId),
    ]);
    const target = Number(settings.daily_appointment_target ?? 8) * Math.max(1, memberIds.length - 1);
    if ((count ?? 0) >= target) return { created: false, reason: "target_met", appointments: count, target };
    return deliverOnce(admin, ownerId, mode, today, "Charles appointment pacing alert",
      `## Appointment target at risk\n\n- Booked today: ${count ?? 0}\n- Team target: ${target}\n- Gap: ${Math.max(0, target - (count ?? 0))}\n\nAssign the gap by rep and protect the next outreach block.`);
  }
  if (mode === "accountability") {
    const now = Date.now();
    const { data: appointments } = await admin.from("sales_appointments")
      .select("id,prospect_name,scheduled_at,outcome,assigned_user_email,assigned_user_name")
      .eq("user_id", ownerId).eq("outcome", "pending")
      .lte("scheduled_at", new Date(now).toISOString())
      .gte("scheduled_at", new Date(now - 3 * 3600000).toISOString()).limit(100);
    const { data: members } = await admin.from("charles_account_members")
      .select("member_user_id,invited_email,display_name,slack_user_id").eq("owner_user_id", ownerId).eq("is_active", true);
    let sent = 0;
    for (const appointment of appointments ?? []) {
      const elapsed = Math.max(0, Math.floor((now - Date.parse(appointment.scheduled_at)) / 60000));
      const cadence = [60, 30, 10, 0].find((minute) => elapsed >= minute) ?? 0;
      const rep = (members ?? []).find((member) =>
        member.invited_email?.toLowerCase() === appointment.assigned_user_email?.toLowerCase() ||
        member.display_name?.toLowerCase() === appointment.assigned_user_name?.toLowerCase());
      const { data: inserted } = await admin.from("sales_accountability_events").insert({
        user_id: ownerId, rep_user_id: rep?.member_user_id ?? null, appointment_id: appointment.id,
        cadence_minutes: cadence, event_kind: cadence ? "disposition_overdue" : "appointment_reminder",
        detail: { prospect: appointment.prospect_name, scheduled_at: appointment.scheduled_at },
      }).select("id").maybeSingle();
      if (!inserted) continue;
      const delivery = await deliverSalesMessage(admin, ownerId, "accountability",
        cadence ? "Appointment disposition overdue" : "Appointment follow-up due",
        `Update the outcome, notes, objections, revenue, and exact next step for **${appointment.prospect_name ?? "this appointment"}**.`,
        rep?.slack_user_id);
      await admin.from("sales_accountability_events").update({
        delivery_status: delivery.ok ? "sent" : "failed", delivered_at: delivery.ok ? new Date().toISOString() : null,
      }).eq("id", inserted.id);
      if (delivery.ok) sent++;
    }
    return { sent, checked: appointments?.length ?? 0 };
  }
  if (mode === "commandReport") {
    if (!scheduleReached(timeZone, String(settings.command_report_send_time ?? "17:30"))) {
      return { created: false, reason: "before_command_report_time" };
    }
    const memberIds = await activeMemberIds(admin, ownerId);
    const start = `${today}T00:00:00Z`;
    const [{ data: reports }, { data: calls }, { data: appointments }] = await Promise.all([
      admin.from("sales_eod_reports").select("user_id,calls_taken,connects,appointments_set,closes,revenue,mood,blockers,help_needed").in("user_id", memberIds).eq("report_date", today),
      admin.from("sales_call_gradings").select("user_id,overall_score,status").in("user_id", memberIds).gte("created_at", start),
      admin.from("sales_appointments").select("id,outcome,revenue").eq("user_id", ownerId).gte("scheduled_at", start),
    ]);
    const metrics = {
      eod_submitted: reports?.length ?? 0, team_members: memberIds.length,
      appointments: appointments?.length ?? 0,
      appointments_pending: (appointments ?? []).filter((row) => row.outcome === "pending").length,
      closes: (reports ?? []).reduce((sum, row) => sum + Number(row.closes ?? 0), 0),
      revenue: (reports ?? []).reduce((sum, row) => sum + Number(row.revenue ?? 0), 0),
      graded_calls: (calls ?? []).filter((row) => ["completed", "graded"].includes(row.status)).length,
      average_call_score: calls?.length ? Math.round((calls ?? []).reduce((sum, row) => sum + Number(row.overall_score ?? 0), 0) / calls.length) : 0,
    };
    const summary = `${metrics.closes} closes · $${metrics.revenue.toFixed(0)} collected · ${metrics.eod_submitted}/${metrics.team_members} EODs · ${metrics.appointments_pending} dispositions pending.`;
    await admin.from("sales_command_reports").upsert({ user_id: ownerId, report_date: today, metrics, per_rep: reports ?? [], summary }, { onConflict: "user_id,report_date" });
    return deliverOnce(admin, ownerId, mode, today, `Daily Sales Command Report · ${today}`, `## Executive summary\n\n${summary}\n\n## Risks\n\n- ${(reports ?? []).filter((row) => row.blockers || row.help_needed).length} reps reported blockers or need help.\n- ${metrics.appointments_pending} appointment outcomes remain unreported.`);
  }
  if (mode === "transition") {
    await refreshOpportunities(admin, ownerId);
    const { data: won } = await admin.from("sales_opportunities")
      .select("id,name,assigned_to,updated_at").eq("user_id", ownerId).eq("status", "won").gte("updated_at", new Date(Date.now() - 14 * 86400000).toISOString());
    if (!won?.length) return { created: false, reason: "no_new_wins" };
    await admin.from("sales_client_transitions").upsert(won.map((row) => ({
      user_id: ownerId, opportunity_id: row.id, client_name: row.name,
      due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
    })), { onConflict: "user_id,opportunity_id", ignoreDuplicates: true });
    return deliverOnce(admin, ownerId, mode, today, "New-client transition review",
      `## ${won.length} recent wins need a clean handoff\n\n${won.map((row) => `- ${row.name}: confirm payment, agreement, onboarding, handoff, and CRM completion.`).join("\n")}`);
  }
  if (mode === "crm" || mode === "dropball" || mode === "leadsdigest") {
    await refreshOpportunities(admin, ownerId);
  }
  if (mode === "crm" || mode === "dropball") {
    const thresholdMs = mode === "dropball"
      ? Number(settings.crm_wait_minutes ?? 15) * 60000
      : Number(settings.crm_stuck_days ?? 7) * 86400000;
    const cutoff = Date.now() - thresholdMs;
    const { data } = await admin
      .from("sales_opportunities")
      .select(
        "ghl_opportunity_id,name,monetary_value,last_activity_at,created_at",
      )
      .eq("user_id", ownerId)
      .eq("status", "open")
      .limit(100);
    const items = (data ?? [])
      .filter(
        (item) =>
          Date.parse(String(item.last_activity_at ?? item.created_at)) < cutoff,
      )
      .slice(0, 50);
    if (items.length) {
      await admin.from("charles_crm_flags").upsert(
        items.map((item) => ({
          user_id: ownerId,
          item_key: String(item.ghl_opportunity_id),
          flag_kind: mode,
          detail: item,
          flagged_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,item_key" },
      );
    }
    if (!items.length) {
      return { created: false, reason: "no_stuck_opportunities" };
    }
    const lines = items
      .map(
        (item) =>
          `- ${item.name} · $${
            Number(item.monetary_value).toFixed(0)
          } · last activity ${item.last_activity_at ?? "unknown"}`,
      )
      .join("\n");
    return deliverOnce(
      admin,
      ownerId,
      mode,
      `${today}:${mode}`,
      mode === "crm" ? "Charles CRM exceptions" : "Charles dropped-ball review",
      `## ${
        items.length ? items.length : 0
      } opportunities need action\n\n${lines}`,
    );
  }
  if (mode === "leadsdigest") {
    const since = new Date(Date.now() - 86400000).toISOString();
    const { data } = await admin
      .from("sales_opportunities")
      .select("name,status,monetary_value,created_at")
      .eq("user_id", ownerId)
      .gte("created_at", since)
      .limit(100);
    const rows = data ?? [];
    const value = rows.reduce(
      (sum, row) => sum + Number(row.monetary_value ?? 0),
      0,
    );
    return deliverOnce(
      admin,
      ownerId,
      mode,
      today,
      "Charles daily lead digest",
      `## New CRM opportunities\n\n- New opportunities: ${rows.length}\n- Pipeline value: $${
        value.toFixed(0)
      }\n- Open: ${rows.filter((row) => row.status === "open").length}`,
    );
  }
  if (mode === "briefing") {
    const start = new Date(`${today}T00:00:00Z`).toISOString();
    const end = new Date(`${today}T23:59:59Z`).toISOString();
    const [{ data: appts }, { data: opps }] = await Promise.all([
      admin
        .from("sales_appointments")
        .select("prospect_name,scheduled_at,status,assigned_user_email,assigned_user_name")
        .eq("user_id", ownerId)
        .gte("scheduled_at", start)
        .lte("scheduled_at", end)
        .order("scheduled_at"),
      admin
        .from("sales_opportunities")
        .select("name,monetary_value,last_activity_at")
        .eq("user_id", ownerId)
        .eq("status", "open")
        .order("monetary_value", { ascending: false })
        .limit(10),
    ]);
    const appointmentLines = (appts ?? [])
      .map(
        (row) =>
          `- ${row.scheduled_at}: ${
            row.prospect_name ?? "Appointment"
          } (${row.status})`,
      )
      .join("\n") || "- No appointments synced";
    const opportunityLines = (opps ?? [])
      .map(
        (row) => `- ${row.name}: $${Number(row.monetary_value).toFixed(0)}`,
      )
      .join("\n") || "- No open opportunities synced";
    const { data: reps } = await admin.from("charles_account_members")
      .select("member_user_id,display_name,invited_email,slack_user_id")
      .eq("owner_user_id", ownerId).eq("is_active", true).eq("role", "sales_rep");
    if (reps?.length) {
      let sent = 0;
      for (const rep of reps) {
        const own = (appts ?? []).filter((row) => row.assigned_user_email?.toLowerCase() === rep.invited_email?.toLowerCase() || row.assigned_user_name?.toLowerCase() === rep.display_name?.toLowerCase());
        const lines = own.map((row) => `- ${row.scheduled_at}: ${row.prospect_name ?? "Appointment"} (${row.status})`).join("\n") || "- No assigned appointments today";
        const result = await deliverOnce(admin, ownerId, mode, `${today}:${rep.member_user_id}`, `Charles morning briefing · ${rep.display_name ?? rep.invited_email ?? "Rep"}`, `## Your appointments\n${lines}\n\n## Team priority pipeline\n${opportunityLines}`, rep.slack_user_id);
        if (result.created) sent++;
      }
      return { created: sent > 0, sent };
    }
    return deliverOnce(
      admin,
      ownerId,
      mode,
      today,
      `Charles morning briefing · ${today}`,
      `## Today's appointments\n${appointmentLines}\n\n## Priority pipeline\n${opportunityLines}`,
    );
  }
  if (mode === "eodEnforce" || mode === "eodLink") {
    if (mode === "eodLink" && settings.eod_link_enabled === false) {
      return { created: false, reason: "disabled" };
    }
    const configuredTime = String(settings.eod_link_send_time ?? "16:00").slice(
      0,
      5,
    );
    const delay = mode === "eodEnforce"
      ? Number(settings.eod_enforce_delay_minutes ?? 30)
      : 0;
    if (!scheduleReached(timeZone, configuredTime, delay)) {
      return { created: false, reason: `scheduled_for_${configuredTime}` };
    }
    const { data: members } = await admin
      .from("charles_account_members")
      .select("member_user_id,display_name,invited_email,eod_token,slack_user_id")
      .eq("owner_user_id", ownerId)
      .eq("is_active", true)
      .eq("role", "sales_rep");
    let recipients = members ?? [];
    if (mode === "eodEnforce" && recipients.length) {
      const ids = recipients.map((row) => row.member_user_id);
      const { data: reports } = await admin
        .from("sales_eod_reports")
        .select("user_id")
        .in("user_id", ids)
        .eq("report_date", today);
      const done = new Set((reports ?? []).map((row) => row.user_id));
      recipients = recipients.filter((row) => !done.has(row.member_user_id));
    }
    if (!recipients.length) {
      return {
        created: false,
        reason: mode === "eodEnforce" ? "all_submitted" : "no_reps",
      };
    }
    const origin = (Deno.env.get("APP_ORIGIN") ?? "").replace(/\/$/, "");
    if (recipients.length) {
      let sent = 0;
      for (const row of recipients) {
        const url = `${origin}/eod/${row.eod_token}`;
        const message = mode === "eodLink" ? String(settings.eod_link_template ?? "Please complete today's EOD report: {url}").replaceAll("{url}", url) : `Your EOD report is overdue. Complete it now: ${url}`;
        const result = await deliverOnce(admin, ownerId, mode, `${today}:${row.member_user_id}`, mode === "eodEnforce" ? "Charles EOD follow-up" : "Charles EOD report", `## ${row.display_name ?? row.invited_email ?? "Sales rep"}\n\n${message}`, row.slack_user_id);
        if (result.created) sent++;
      }
      return { created: sent > 0, sent };
    }
    const links = recipients
      .map((row) => {
        const url = `${origin}/eod/${row.eod_token}`;
        const message = mode === "eodLink"
          ? String(
            settings.eod_link_template ??
              "Please complete today's EOD report: {url}",
          ).replaceAll("{url}", url)
          : `Missing report: ${url}`;
        return `- ${
          row.display_name ?? row.invited_email ?? "Rep"
        }: ${message}`;
      })
      .join("\n");
    return deliverOnce(
      admin,
      ownerId,
      mode,
      today,
      mode === "eodEnforce" ? "Charles EOD follow-up" : "Charles EOD links",
      `## ${
        mode === "eodEnforce" ? "Missing EOD reports" : "Today's EOD links"
      }\n\n${links}`,
    );
  }
  if (mode === "morale") {
    const memberIds = await activeMemberIds(admin, ownerId);
    const { data: reports } = await admin
      .from("sales_eod_reports")
      .select("user_id,mood,blockers,help_needed")
      .in("user_id", memberIds)
      .eq("report_date", today);
    const colors: Record<string, string> = {
      great: "blue",
      good: "green",
      neutral: "yellow",
      tough: "orange",
      blocked: "red",
    };
    const moods = (reports ?? []).map(
      (row) => colors[row.mood ?? "neutral"] ?? "yellow",
    );
    const order = ["blue", "green", "yellow", "orange", "red"];
    const teamColor = moods.length
      ? order[Math.max(...moods.map((mood) => order.indexOf(mood)))]
      : "yellow";
    const summary = `${
      reports?.length ?? 0
    } EOD reports received. Team status: ${teamColor}.`;
    await admin.from("charles_morale_daily").upsert(
      {
        user_id: ownerId,
        report_date: today,
        team_color: teamColor,
        per_rep: Object.fromEntries(
          (reports ?? []).map((row) => [
            row.user_id,
            { mood: row.mood, blocker: row.blockers, help: row.help_needed },
          ]),
        ),
        summary,
      },
      { onConflict: "user_id,report_date" },
    );
    return deliverOnce(
      admin,
      ownerId,
      mode,
      today,
      `Charles morale report · ${today}`,
      `## Team morale: ${teamColor}\n\n${summary}\n\nReview blockers and help requests in the owner dashboard.`,
    );
  }
  if (mode === "coaching") {
    const weekStart = mondayDate(today);
    const since = new Date(`${weekStart}T00:00:00Z`).toISOString();
    const memberIds = await activeMemberIds(admin, ownerId);
    const [{ data: grades }, { data: calls }] = await Promise.all([
      admin
        .from("sales_call_gradings")
        .select("overall_score,script_adherence_pct,strengths,improvements")
        .in("user_id", memberIds)
        .gte("graded_at", since),
      admin
        .from("sales_calls")
        .select("outcome,revenue")
        .in("user_id", memberIds)
        .gte("happened_at", since),
    ]);
    const score = grades?.length
      ? grades.reduce((sum, row) => sum + Number(row.overall_score ?? 0), 0) /
        grades.length
      : 0;
    const wins = (calls ?? []).filter((row) => row.outcome === "won").length;
    const actions = [
      "Review the lowest-scoring call category.",
      "Role-play the most common objection.",
      "Assign a dated next step to every open deal.",
    ];
    const summary = `${grades?.length ?? 0} graded calls · ${
      score.toFixed(0)
    } coaching score · ${wins} wins.`;
    await admin.from("charles_coaching_weekly").upsert(
      {
        user_id: ownerId,
        week_start: weekStart,
        score,
        morale: null,
        metrics: {
          graded_calls: grades?.length ?? 0,
          wins,
          calls: calls?.length ?? 0,
        },
        actions,
        summary,
      },
      { onConflict: "user_id,week_start" },
    );
    return deliverOnce(
      admin,
      ownerId,
      mode,
      weekStart,
      `Charles weekly coaching · ${weekStart}`,
      `## Weekly scorecard\n\n${summary}\n\n${
        actions.map((action) => `- ${action}`).join("\n")
      }`,
    );
  }
  return { created: false };
}

async function deliverOnce(
  admin: ReturnType<typeof adminClient>,
  ownerId: string,
  kind: string,
  key: string,
  title: string,
  markdown: string,
  slackRecipient?: string | null,
) {
  const { data: existing } = await admin
    .from("charles_reminders")
    .select("id,fired_at")
    .eq("user_id", ownerId)
    .eq("reminder_kind", kind)
    .eq("dedupe_key", key)
    .maybeSingle();
  if (existing?.fired_at) {
    return { created: false, reason: "already_delivered" };
  }
  let id = existing?.id;
  if (!id) {
    const { data, error } = await admin
      .from("charles_reminders")
      .insert({
        user_id: ownerId,
        reminder_kind: kind,
        dedupe_key: key,
        subject: title,
        detail: markdown,
        due_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) return { created: false, error: error.message };
    id = data.id;
  }
  const mappedKind = kind === "commandReport" ? "command_report" : kind === "eodEnforce" || kind === "eodLink" ? "eod" : kind === "transition" ? "transition" : kind === "accountability" ? "accountability" : kind === "coaching" ? "coaching" : "sales_brief";
  const delivered = await deliverSalesMessage(admin, ownerId, mappedKind, title, markdown, slackRecipient);
  if (delivered.ok) {
    await admin
      .from("charles_reminders")
      .update({
        fired_at: new Date().toISOString(),
        clickup_task_id: null,
      })
      .eq("id", id);
  }
  return {
    created: delivered.ok,
    taskUrl: null,
    error: delivered.ok ? undefined : "No configured delivery channel accepted the message.",
  };
}

async function scanReminders(
  admin: ReturnType<typeof adminClient>,
  ownerId: string,
) {
  const { data } = await admin
    .from("charles_reminders")
    .select("id,subject,detail")
    .eq("user_id", ownerId)
    .is("fired_at", null)
    .lte("due_at", new Date().toISOString())
    .eq("reminder_kind", "manual")
    .limit(25);
  let fired = 0;
  for (const row of data ?? []) {
    const delivered = await createClickUpTask(
      admin,
      ownerId,
      "sales_brief",
      row.subject,
      row.detail,
    );
    if (delivered.ok) {
      fired++;
      await admin
        .from("charles_reminders")
        .update({
          fired_at: new Date().toISOString(),
          clickup_task_id: delivered.taskId ?? null,
        })
        .eq("id", row.id);
    }
  }
  return { fired };
}

async function refreshOpportunities(
  admin: ReturnType<typeof adminClient>,
  ownerId: string,
) {
  const { pit, locationId } = await ghlCredentials(admin, ownerId);
  if (!pit || !locationId) return;
  const payload = await ghlFetch(pit, "/opportunities/search", {
    locationId,
    status: "all",
    limit: 100,
  });
  const rows = Array.isArray(payload.opportunities)
    ? (payload.opportunities as Array<Record<string, unknown>>)
    : [];
  if (!rows.length) return;
  await admin.from("sales_opportunities").upsert(
    rows
      .filter((row) => row.id)
      .map((row) => ({
        user_id: ownerId,
        ghl_opportunity_id: String(row.id),
        contact_id: value(row.contactId),
        name: String(row.name ?? "Opportunity"),
        pipeline_id: value(row.pipelineId),
        pipeline_stage_id: value(row.pipelineStageId),
        status: String(row.status ?? "open"),
        monetary_value: Math.max(0, Number(row.monetaryValue ?? 0)),
        assigned_to: value(row.assignedTo),
        last_activity_at: validDate(row.lastActionDate),
        raw_payload: row,
        synced_at: new Date().toISOString(),
      })),
    { onConflict: "user_id,ghl_opportunity_id" },
  );
}

function value(input: unknown) {
  return typeof input === "string" && input ? input : null;
}
function validDate(input: unknown) {
  return typeof input === "string" && !Number.isNaN(Date.parse(input))
    ? input
    : null;
}
function businessDate(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function localTime(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(11, 16);
  }
}
function scheduleReached(timeZone: string, target: string, delayMinutes = 0) {
  const current = localTime(timeZone).split(":").map(Number);
  const scheduled = target.slice(0, 5).split(":").map(Number);
  if (
    current.length !== 2 || scheduled.length !== 2 ||
    current.some((value) => !Number.isFinite(value)) ||
    scheduled.some((value) => !Number.isFinite(value))
  ) return false;
  const currentMinutes = current[0] * 60 + current[1];
  const targetMinutes = Math.min(
    1439,
    scheduled[0] * 60 + scheduled[1] + Math.max(0, delayMinutes),
  );
  return currentMinutes >= targetMinutes;
}
function businessWeekday(timeZone: string) {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    }).format(new Date());
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      name,
    );
  } catch {
    return new Date().getUTCDay();
  }
}
function mondayDate(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  const delta = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - delta);
  return day.toISOString().slice(0, 10);
}

async function activeMemberIds(
  admin: ReturnType<typeof adminClient>,
  ownerId: string,
) {
  const { data } = await admin
    .from("charles_account_members")
    .select("member_user_id")
    .eq("owner_user_id", ownerId)
    .eq("is_active", true);
  const ids = (data ?? []).map((row) => row.member_user_id);
  return ids.length ? ids : [ownerId];
}

function isServiceRequest(req: Request) {
  const token = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return false;
  const candidates = [
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    Deno.env.get("SUPABASE_SECRET_KEY"),
  ].filter(Boolean);
  const named = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (named) {
    try {
      candidates.push(
        ...Object.values(JSON.parse(named) as Record<string, string>),
      );
    } catch {
      // Ignore malformed optional key maps and fall back to the standard variables.
    }
  }
  return candidates.includes(token);
}
