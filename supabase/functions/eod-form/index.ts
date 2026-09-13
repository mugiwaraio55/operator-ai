import { adminClient, corsHeaders, json } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  const admin = adminClient();
  const url = new URL(req.url);
  const body =
    req.method === "POST"
      ? ((await req.json().catch(() => ({}))) as Record<string, unknown>)
      : {};
  const token =
    req.method === "GET"
      ? url.searchParams.get("token")
      : String(body.token ?? "");
  if (!token || token.length < 32)
    return json({ error: "This EOD link is invalid." }, 401);
  const { data: member } = await admin
    .from("charles_account_members")
    .select("member_user_id,owner_user_id,display_name,invited_email,is_active")
    .eq("eod_token", token)
    .maybeSingle();
  if (!member?.is_active)
    return json({ error: "This EOD link is invalid or inactive." }, 401);
  const { data: settings } = await admin
    .from("sales_manager_settings")
    .select("timezone")
    .eq("user_id", member.owner_user_id)
    .maybeSingle();
  const reportDate = businessDate(settings?.timezone ?? "America/Chicago");
  if (req.method === "GET") {
    const { data: existing } = await admin
      .from("sales_eod_reports")
      .select(
        "calls_taken,connects,appointments_set,closes,revenue,wins,blockers,priorities,mood,help_needed,crm_updated",
      )
      .eq("user_id", member.member_user_id)
      .eq("report_date", reportDate)
      .maybeSingle();
    return json({
      ok: true,
      repName: member.display_name ?? member.invited_email ?? "Sales rep",
      reportDate,
      existing,
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const callsTaken = nonnegative(body.calls_taken);
  const closes = Math.min(nonnegative(body.closes), callsTaken);
  const row = {
    user_id: member.member_user_id,
    report_date: reportDate,
    calls_taken: callsTaken,
    connects: nonnegative(body.connects),
    appointments_set: nonnegative(body.appointments_set),
    closes,
    revenue: nonnegative(body.revenue),
    wins: shortText(body.wins, 10000),
    blockers: shortText(body.blockers, 10000),
    priorities: shortText(body.priorities, 10000),
    mood: ["great", "good", "neutral", "tough", "blocked"].includes(
      String(body.mood),
    )
      ? String(body.mood)
      : null,
    help_needed: shortText(body.help_needed, 10000),
    crm_updated: body.crm_updated === true,
    submitted_via: "magic_link",
  };
  const { error } = await admin
    .from("sales_eod_reports")
    .upsert(row, { onConflict: "user_id,report_date" });
  if (error) {
    console.error("eod-form", error);
    return json({ error: "The EOD report could not be saved." }, 500);
  }
  return json({ ok: true, reportDate });
});

function nonnegative(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}
function shortText(value: unknown, limit: number) {
  return String(value ?? "").slice(0, limit);
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
