import { adminClient, corsHeaders, json } from "../_shared/supabase.ts";
import {
  createClickUpTask,
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
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!isServiceRequest(req))
    return json({ error: "Service-role authorization is required." }, 403);
  const body = (await req.json().catch(() => ({}))) as {
    mode?: string;
    ownerUserId?: string;
  };
  const mode = String(body.mode ?? "scan");
  if (!modes.has(mode))
    return json({ error: "Unsupported autopilot mode." }, 400);
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
  const today = businessDate(String(settings.timezone ?? "America/Chicago"));
  if (mode === "scan") return scanReminders(admin, ownerId);
  if (mode === "crm" || mode === "dropball" || mode === "leadsdigest")
    await refreshOpportunities(admin, ownerId);
  if (mode === "crm" || mode === "dropball") {
    const thresholdMs =
      mode === "dropball"
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
    if (items.length)
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
    if (!items.length)
      return { created: false, reason: "no_stuck_opportunities" };
    const lines = items
      .map(
        (item) =>
          `- ${item.name} · $${Number(item.monetary_value).toFixed(0)} · last activity ${item.last_activity_at ?? "unknown"}`,
      )
      .join("\n");
    return deliverOnce(
      admin,
      ownerId,
      mode,
      `${today}:${mode}`,
      mode === "crm" ? "Charles CRM exceptions" : "Charles dropped-ball review",
      `## ${items.length ? items.length : 0} opportunities need action\n\n${lines}`,
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
      `## New CRM opportunities\n\n- New opportunities: ${rows.length}\n- Pipeline value: $${value.toFixed(0)}\n- Open: ${rows.filter((row) => row.status === "open").length}`,
    );
  }
  if (mode === "briefing") {
    const start = new Date(`${today}T00:00:00Z`).toISOString();
    const end = new Date(`${today}T23:59:59Z`).toISOString();
    const [{ data: appts }, { data: opps }] = await Promise.all([
      admin
        .from("sales_appointments")
        .select("prospect_name,scheduled_at,status")
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
    const appointmentLines =
      (appts ?? [])
        .map(
          (row) =>
            `- ${row.scheduled_at}: ${row.prospect_name ?? "Appointment"} (${row.status})`,
        )
        .join("\n") || "- No appointments synced";
    const opportunityLines =
      (opps ?? [])
        .map(
          (row) => `- ${row.name}: $${Number(row.monetary_value).toFixed(0)}`,
        )
        .join("\n") || "- No open opportunities synced";
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
    if (mode === "eodLink" && settings.eod_link_enabled === false)
      return { created: false, reason: "disabled" };
    const configuredTime = String(settings.eod_link_send_time ?? "16:00").slice(
      0,
      5,
    );
    if (
      localTime(String(settings.timezone ?? "America/Chicago")) < configuredTime
    )
      return { created: false, reason: `scheduled_for_${configuredTime}` };
    const { data: members } = await admin
      .from("charles_account_members")
      .select("member_user_id,display_name,invited_email,eod_token")
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
    if (!recipients.length)
      return {
        created: false,
        reason: mode === "eodEnforce" ? "all_submitted" : "no_reps",
      };
    const origin = (Deno.env.get("APP_ORIGIN") ?? "").replace(/\/$/, "");
    const links = recipients
      .map((row) => {
        const url = `${origin}/eod/${row.eod_token}`;
        const message =
          mode === "eodLink"
            ? String(
                settings.eod_link_template ??
                  "Please complete today's EOD report: {url}",
              ).replaceAll("{url}", url)
            : `Missing report: ${url}`;
        return `- ${row.display_name ?? row.invited_email ?? "Rep"}: ${message}`;
      })
      .join("\n");
    return deliverOnce(
      admin,
      ownerId,
      mode,
      today,
      mode === "eodEnforce" ? "Charles EOD follow-up" : "Charles EOD links",
      `## ${mode === "eodEnforce" ? "Missing EOD reports" : "Today's EOD links"}\n\n${links}`,
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
    const summary = `${reports?.length ?? 0} EOD reports received. Team status: ${teamColor}.`;
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
    const summary = `${grades?.length ?? 0} graded calls · ${score.toFixed(0)} coaching score · ${wins} wins.`;
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
      `## Weekly scorecard\n\n${summary}\n\n${actions.map((action) => `- ${action}`).join("\n")}`,
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
) {
  const { data: existing } = await admin
    .from("charles_reminders")
    .select("id,fired_at")
    .eq("user_id", ownerId)
    .eq("reminder_kind", kind)
    .eq("dedupe_key", key)
    .maybeSingle();
  if (existing?.fired_at)
    return { created: false, reason: "already_delivered" };
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
  const delivered = await createClickUpTask(
    admin,
    ownerId,
    "sales_brief",
    title,
    markdown,
  );
  if (delivered.ok)
    await admin
      .from("charles_reminders")
      .update({
        fired_at: new Date().toISOString(),
        clickup_task_id: delivered.taskId ?? null,
      })
      .eq("id", id);
  return {
    created: delivered.ok,
    taskUrl: delivered.taskUrl,
    error: delivered.ok ? undefined : delivered.error,
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
