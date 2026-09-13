import {
  adminClient,
  authorizeUser,
  corsHeaders,
  json,
} from "../_shared/supabase.ts";
import { ensureSalesWorkspace } from "../_shared/sales.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { user } = await authorizeUser(req);
  if (!user) return json({ error: "Sign in is required." }, 401);
  const admin = adminClient();
  const membership = await ensureSalesWorkspace(admin, user.id, user.email);
  if (membership.role !== "owner") {
    return json({ error: "Owner dashboard access is required." }, 403);
  }
  const body = (await req.json().catch(() => ({}))) as {
    periodDays?: number;
  };
  const requestedDays = Number(body.periodDays ?? 7);
  const periodDays = [1, 7, 30, 90].includes(requestedDays) ? requestedDays : 7;
  const { data: members, error: memberError } = await admin
    .from("charles_account_members")
    .select("member_user_id,display_name,invited_email,is_active")
    .eq("owner_user_id", user.id);
  if (memberError) return json({ error: memberError.message }, 500);
  const ids = (members ?? [])
    .filter((row) => row.is_active)
    .map((row) => row.member_user_id);
  const since = new Date(Date.now() - periodDays * 86400000).toISOString();
  const sinceDate = since.slice(0, 10);
  const [calls, eods, grades, appointments, coaching] = await Promise.all([
    admin
      .from("sales_calls")
      .select("user_id,outcome,score,revenue,happened_at")
      .in("user_id", ids)
      .gte("happened_at", since),
    admin
      .from("sales_eod_reports")
      .select(
        "id,user_id,report_date,calls_taken,connects,appointments_set,closes,revenue,mood,crm_updated,wins,blockers,priorities,help_needed",
      )
      .in("user_id", ids)
      .gte("report_date", sinceDate),
    admin
      .from("sales_call_gradings")
      .select("user_id,overall_score,script_adherence_pct,graded_at")
      .in("user_id", ids)
      .gte("graded_at", since),
    admin
      .from("sales_appointments")
      .select("user_id,status,outcome,revenue,scheduled_at")
      .in("user_id", ids)
      .gte("scheduled_at", since),
    admin
      .from("charles_coaching_weekly")
      .select("*")
      .eq("user_id", user.id)
      .order("week_start", { ascending: false })
      .limit(1),
  ]);
  const queryError = calls.error ?? eods.error ?? grades.error ??
    appointments.error ?? coaching.error;
  if (queryError) return json({ error: queryError.message }, 500);
  const roster = (members ?? []).map((member) => {
    const memberCalls = (calls.data ?? []).filter(
      (row) => row.user_id === member.member_user_id,
    );
    const memberGrades = (grades.data ?? []).filter(
      (row) =>
        row.user_id === member.member_user_id && row.overall_score !== null,
    );
    const memberEods = (eods.data ?? []).filter(
      (row) => row.user_id === member.member_user_id,
    );
    const memberAppointments = (appointments.data ?? []).filter(
      (row) => row.user_id === member.member_user_id,
    );
    const reportedCalls = memberEods.reduce(
      (sum, row) => sum + Number(row.calls_taken ?? 0),
      0,
    );
    const reportedCloses = memberEods.reduce(
      (sum, row) => sum + Number(row.closes ?? 0),
      0,
    );
    const reportedRevenue = memberEods.reduce(
      (sum, row) => sum + Number(row.revenue ?? 0),
      0,
    );
    const connects = memberEods.reduce(
      (sum, row) => sum + Number(row.connects ?? 0),
      0,
    );
    const appointmentsSet = memberEods.reduce(
      (sum, row) => sum + Number(row.appointments_set ?? 0),
      0,
    );
    return {
      ...member,
      calls: memberCalls.length,
      wins: memberCalls.filter((row) => row.outcome === "won").length,
      revenue: memberCalls.reduce(
        (sum, row) => sum + Number(row.revenue ?? 0),
        0,
      ),
      reported_calls: reportedCalls,
      connects,
      appointments_set: appointmentsSet,
      closes: reportedCloses,
      reported_revenue: reportedRevenue,
      call_close_rate: reportedCalls
        ? (reportedCloses / reportedCalls) * 100
        : null,
      appointments: memberAppointments.length,
      appointments_showed: memberAppointments.filter((row) =>
        ["completed", "showed", "won"].includes(
          String(row.outcome ?? row.status),
        )
      ).length,
      appointments_won: memberAppointments.filter(
        (row) =>
          String(row.outcome) === "won",
      ).length,
      average_score: memberGrades.length
        ? memberGrades.reduce(
          (sum, row) => sum + Number(row.overall_score),
          0,
        ) / memberGrades.length
        : null,
      eod_reports: memberEods.length,
      crm_compliance: memberEods.length
        ? Math.round(
          (memberEods.filter((row) => row.crm_updated).length /
            memberEods.length) *
            100,
        )
        : null,
    };
  });
  return json({
    ok: true,
    periodDays,
    period: { from: sinceDate, to: new Date().toISOString().slice(0, 10) },
    roster,
    daily: (eods.data ?? [])
      .map((report) => {
        const member = (members ?? []).find(
          (row) => row.member_user_id === report.user_id,
        );
        return {
          ...report,
          display_name: member?.display_name ?? member?.invited_email ??
            "Team member",
        };
      })
      .sort((left, right) =>
        String(right.report_date).localeCompare(String(left.report_date))
      ),
    totals: {
      calls: (calls.data ?? []).length,
      wins: (calls.data ?? []).filter((row) => row.outcome === "won").length,
      revenue: (calls.data ?? []).reduce(
        (sum, row) => sum + Number(row.revenue ?? 0),
        0,
      ),
      appointments: (appointments.data ?? []).length,
      eod_reports: (eods.data ?? []).length,
    },
    coaching: coaching.data?.[0] ?? null,
  });
});
