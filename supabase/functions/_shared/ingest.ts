import type { AdminClient } from "./sales.ts";
import { gradeTranscript } from "./sales.ts";

export async function ingestCall(
  admin: AdminClient,
  userId: string,
  provider: "ghl" | "fathom",
  payload: Record<string, unknown>,
) {
  const externalId =
    firstIdentifier(payload, [
      "id",
      "callId",
      "call_id",
      "recording_id",
      "recordingId",
    ]) ?? crypto.randomUUID();
  const transcriptValue = firstValue(payload, [
    "transcript",
    "transcript_text",
    "text",
    "summary",
  ]);
  const transcript = normalizeTranscript(transcriptValue);
  const repName =
    firstString(payload, [
      "rep_name",
      "repName",
      "assignedUserName",
      "recorded_by_name",
      "userName",
    ]) ??
    nestedString(payload, "recorded_by", "name") ??
    "Sales rep";
  const repEmail =
    firstString(payload, [
      "rep_email",
      "repEmail",
      "assignedUserEmail",
      "recorded_by_email",
      "userEmail",
    ]) ?? nestedString(payload, "recorded_by", "email");
  const assignedUserId = await resolveRepUserId(admin, userId, repEmail);
  const title =
    firstString(payload, ["title", "meeting_title", "name", "subject"]) ??
    `${provider === "ghl" ? "GHL" : "Fathom"} sales call`;
  const recordingUrl = firstString(payload, [
    "recording_url",
    "recordingUrl",
    "url",
    "share_url",
  ]);
  const happenedAt =
    validDate(
      firstString(payload, [
        "call_started_at",
        "started_at",
        "startTime",
        "createdAt",
      ]),
    ) ?? new Date().toISOString();
  const duration = Number(
    firstValue(payload, ["duration_seconds", "duration", "durationSeconds"]) ??
      0,
  );

  const { data: existingCall } = await admin
    .from("sales_calls")
    .select("id")
    .eq("user_id", assignedUserId)
    .eq("provider", provider)
    .eq("external_id", externalId)
    .maybeSingle();
  const callRow = {
    user_id: assignedUserId,
    prospect_name:
      firstString(payload, [
        "contact_name",
        "contactName",
        "prospect_name",
        "customerName",
      ]) ?? title,
    rep_name: repName,
    outcome: normalizeOutcome(
      firstString(payload, ["outcome", "status", "disposition"]),
    ),
    score: 0,
    revenue: Math.max(
      0,
      Number(firstValue(payload, ["revenue", "monetaryValue"]) ?? 0),
    ),
    primary_objection:
      firstString(payload, ["primary_objection", "objection"]) ?? "",
    notes: firstString(payload, ["summary", "notes"]) ?? "",
    source: "webhook",
    provider,
    external_id: externalId,
    recording_url: recordingUrl,
    transcript,
    duration_seconds: duration > 0 ? Math.round(duration) : null,
    happened_at: happenedAt,
  };
  let callId = existingCall?.id as number | undefined;
  if (callId) await admin.from("sales_calls").update(callRow).eq("id", callId);
  else {
    const { data } = await admin
      .from("sales_calls")
      .insert(callRow)
      .select("id")
      .single();
    callId = data?.id;
  }

  const { data: existingGrade } = await admin
    .from("sales_call_gradings")
    .select("id,status")
    .eq("user_id", assignedUserId)
    .eq("provider", provider)
    .eq("external_call_id", externalId)
    .maybeSingle();
  const baseGrade = {
    user_id: assignedUserId,
    sales_call_id: callId ?? null,
    provider,
    external_call_id: externalId,
    rep_name: repName,
    rep_email: repEmail,
    title,
    recording_url: recordingUrl,
    transcript,
    duration_seconds: duration > 0 ? Math.round(duration) : null,
    call_started_at: happenedAt,
    raw_payload: payload,
  };
  let gradeId = existingGrade?.id as number | undefined;
  if (gradeId)
    await admin.from("sales_call_gradings").update(baseGrade).eq("id", gradeId);
  else {
    const { data } = await admin
      .from("sales_call_gradings")
      .insert(baseGrade)
      .select("id")
      .single();
    gradeId = data?.id;
  }

  if (!transcript.trim() || !gradeId)
    return { ok: true, callId, gradeId, graded: false };
  const grade = await gradeTranscript(admin, assignedUserId, transcript);
  await admin
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
    .eq("id", gradeId);
  if (callId)
    await admin
      .from("sales_calls")
      .update({ score: grade.overall_score })
      .eq("id", callId);
  return {
    ok: true,
    callId,
    gradeId,
    graded: true,
    score: grade.overall_score,
  };
}

async function resolveRepUserId(
  admin: AdminClient,
  ownerId: string,
  repEmail: string | null,
) {
  if (!repEmail) return ownerId;
  const { data } = await admin
    .from("charles_account_members")
    .select("member_user_id")
    .eq("owner_user_id", ownerId)
    .eq("is_active", true)
    .ilike("invited_email", repEmail)
    .maybeSingle();
  return (data?.member_user_id as string | undefined) ?? ownerId;
}

export async function ingestAppointment(
  admin: AdminClient,
  userId: string,
  payload: Record<string, unknown>,
) {
  const externalId = firstString(payload, [
    "id",
    "appointmentId",
    "appointment_id",
    "eventId",
  ]);
  const scheduledAt =
    validDate(
      firstString(payload, [
        "startTime",
        "start_time",
        "scheduled_at",
        "start",
      ]),
    ) ?? new Date().toISOString();
  const row = {
    user_id: userId,
    ghl_appointment_id: externalId,
    prospect_name: firstString(payload, [
      "contactName",
      "contact_name",
      "title",
      "name",
    ]),
    prospect_email: firstString(payload, ["email", "contactEmail"]),
    prospect_phone: firstString(payload, ["phone", "contactPhone"]),
    calendar_name: firstString(payload, ["calendarName", "calendar_name"]),
    assigned_user_id: firstString(payload, [
      "assignedUserId",
      "assigned_user_id",
    ]),
    assigned_user_name: firstString(payload, [
      "assignedUserName",
      "assigned_user_name",
    ]),
    scheduled_at: scheduledAt,
    status: firstString(payload, ["appointmentStatus", "status"]) ?? "booked",
    source: "webhook",
    raw_payload: payload,
  };
  if (externalId) {
    const { data: existing } = await admin
      .from("sales_appointments")
      .select("id")
      .eq("user_id", userId)
      .eq("ghl_appointment_id", externalId)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await admin
        .from("sales_appointments")
        .update(row)
        .eq("id", existing.id);
      if (error) throw error;
      return { ok: true, appointmentId: existing.id, updated: true };
    }
  }
  const { data, error } = await admin
    .from("sales_appointments")
    .insert(row)
    .select("id")
    .single();
  if (error) throw error;
  return { ok: true, appointmentId: data.id, updated: false };
}

function firstValue(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys)
    if (payload[key] !== undefined && payload[key] !== null)
      return payload[key];
  const data = payload.data;
  if (data && typeof data === "object" && !Array.isArray(data))
    for (const key of keys)
      if ((data as Record<string, unknown>)[key] !== undefined)
        return (data as Record<string, unknown>)[key];
  for (const container of [payload.recording, payload.meeting]) {
    if (!container || typeof container !== "object" || Array.isArray(container))
      continue;
    for (const key of keys)
      if ((container as Record<string, unknown>)[key] !== undefined)
        return (container as Record<string, unknown>)[key];
  }
  return null;
}
function firstString(payload: Record<string, unknown>, keys: string[]) {
  const value = firstValue(payload, keys);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function firstIdentifier(payload: Record<string, unknown>, keys: string[]) {
  const value = firstValue(payload, keys);
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}
function normalizeTranscript(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const row = entry as Record<string, unknown>;
      const speaker = row.speaker;
      const speakerName =
        speaker && typeof speaker === "object"
          ? String(
              (speaker as Record<string, unknown>).display_name ?? "Speaker",
            )
          : "Speaker";
      return typeof row.text === "string" ? `${speakerName}: ${row.text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}
function nestedString(
  payload: Record<string, unknown>,
  parent: string,
  child: string,
) {
  const value = payload[parent];
  return value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)[child] === "string"
    ? String((value as Record<string, unknown>)[child])
    : null;
}
function validDate(value: string | null) {
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}
function normalizeOutcome(value: string | null) {
  const text = (value ?? "").toLowerCase();
  if (text.includes("won") || text.includes("completed")) return "won";
  if (text.includes("lost") || text.includes("failed")) return "lost";
  if (text.includes("no show") || text.includes("noshow")) return "no_show";
  return "follow_up";
}
