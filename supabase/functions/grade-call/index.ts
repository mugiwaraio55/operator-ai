import {
  adminClient,
  authorizeUser,
  corsHeaders,
  json,
} from "../_shared/supabase.ts";
import { ensureSalesWorkspace, gradeTranscript } from "../_shared/sales.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { user } = await authorizeUser(req);
  if (!user) return json({ error: "Sign in is required." }, 401);

  const admin = adminClient();
  const membership = await ensureSalesWorkspace(admin, user.id, user.email);
  const body = (await req.json().catch(() => ({}))) as {
    gradingId?: number;
    id?: number;
    transcript?: string;
    title?: string;
    repName?: string;
  };
  let gradingId = Number(body.gradingId ?? body.id ?? 0);
  let transcript = String(body.transcript ?? "").trim();
  let gradingUserId = user.id;
  let salesCallId: number | null = null;

  try {
    if (gradingId) {
      const { data: row, error } = await admin
        .from("sales_call_gradings")
        .select("id,user_id,sales_call_id,transcript")
        .eq("id", gradingId)
        .maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: "Call grading was not found." }, 404);
      if (!(await canManageGrade(admin, user.id, membership.role, row.user_id))) {
        return json({ error: "You do not have access to this call." }, 403);
      }
      gradingUserId = row.user_id;
      salesCallId = row.sales_call_id;
      transcript = row.transcript ?? transcript;
    } else {
      if (transcript.length < 20) {
        return json({ error: "A transcript of at least 20 characters is required." }, 400);
      }
      const { data, error } = await admin
        .from("sales_call_gradings")
        .insert({
          user_id: user.id,
          provider: "manual",
          title: String(body.title ?? "Manual call").trim().slice(0, 300),
          rep_name: String(body.repName ?? "").trim().slice(0, 160) || null,
          transcript,
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw error;
      gradingId = data.id;
    }

    if (transcript.length < 20) return json({ error: "This call has no usable transcript." }, 409);
    const { error: statusError } = await admin
      .from("sales_call_gradings")
      .update({ status: "grading", error_message: null })
      .eq("id", gradingId);
    if (statusError) throw statusError;

    const grade = await gradeTranscript(admin, gradingUserId, transcript);
    const { error } = await admin
      .from("sales_call_gradings")
      .update({
        status: "completed",
        overall_score: grade.overall_score,
        script_adherence_pct: grade.script_adherence_pct,
        category_scores: grade.category_scores,
        strengths: grade.strengths,
        improvements: grade.improvements,
        coaching_notes: grade.coaching_notes,
        rep_feedback: grade.rep_feedback,
        grader_model: grade.model,
        graded_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", gradingId);
    if (error) throw error;
    if (salesCallId) {
      const { error: callError } = await admin
        .from("sales_calls")
        .update({ score: grade.overall_score })
        .eq("id", salesCallId);
      if (callError) throw callError;
    }
    return json({ ok: true, gradingId, ...grade });
  } catch (error) {
    console.error("grade-call", error);
    if (gradingId) {
      await admin
        .from("sales_call_gradings")
        .update({
          status: "failed",
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq("id", gradingId);
    }
    return json({ error: "The call could not be graded." }, 500);
  }
});

async function canManageGrade(
  admin: ReturnType<typeof adminClient>,
  callerId: string,
  callerRole: "owner" | "sales_rep",
  gradingUserId: string,
) {
  if (gradingUserId === callerId) return true;
  if (callerRole !== "owner") return false;
  const { data } = await admin
    .from("charles_account_members")
    .select("member_user_id")
    .eq("owner_user_id", callerId)
    .eq("member_user_id", gradingUserId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data);
}
