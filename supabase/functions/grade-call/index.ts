import {
  adminClient,
  authorizeUser,
  corsHeaders,
  json,
} from "../_shared/supabase.ts";
import { ensureSalesWorkspace, gradeTranscript } from "../_shared/sales.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { user } = await authorizeUser(req);
  if (!user) return json({ error: "Sign in is required." }, 401);
  const admin = adminClient();
  await ensureSalesWorkspace(admin, user.id, user.email);
  const body = (await req.json().catch(() => ({}))) as {
    gradingId?: number;
    transcript?: string;
    title?: string;
    repName?: string;
  };
  let gradingId = Number(body.gradingId ?? 0);
  let transcript = String(body.transcript ?? "").trim();
  if (gradingId) {
    const { data } = await admin
      .from("sales_call_gradings")
      .select("id,transcript")
      .eq("id", gradingId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!data) return json({ error: "Call grading was not found." }, 404);
    transcript = data.transcript ?? transcript;
  } else {
    if (transcript.length < 20) {
      return json(
        { error: "A transcript of at least 20 characters is required." },
        400,
      );
    }
    const { data, error } = await admin
      .from("sales_call_gradings")
      .insert({
        user_id: user.id,
        provider: "manual",
        title: String(body.title ?? "Manual call"),
        rep_name: String(body.repName ?? "").trim().slice(0, 160) || null,
        transcript,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) return json({ error: error.message }, 500);
    gradingId = data.id;
  }
  if (transcript.length < 20) {
    return json({ error: "This call has no usable transcript." }, 409);
  }
  const grade = await gradeTranscript(admin, user.id, transcript);
  const { error } = await admin
    .from("sales_call_gradings")
    .update({
      status: "graded",
      overall_score: grade.overall_score,
      script_adherence_pct: grade.script_adherence_pct,
      category_scores: grade.category_scores,
      strengths: grade.strengths,
      improvements: grade.improvements,
      coaching_notes: grade.coaching_notes,
      grader_model: grade.model,
      graded_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", gradingId)
    .eq("user_id", user.id);
  return error
    ? json({ error: error.message }, 500)
    : json({ ok: true, gradingId, ...grade });
});
