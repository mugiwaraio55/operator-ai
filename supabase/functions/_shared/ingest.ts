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
      "meeting.id",
      "call.id",
      "message.id",
      "data.id",
      "fathom_id",
      "recording_id",
      "recordingId",
    ]) ?? crypto.randomUUID();
  const transcriptValue = firstValue(payload, [
    "transcript",
    "transcription",
    "transcript_text",
    "transcript_plaintext",
    "transcript_generated.call_transcript",
    "recording_transcript",
    "call_transcript",
    "meeting.transcript",
    "call.transcript",
    "message.transcript",
    "data.transcript",
    "fathom.transcript",
  ]);
  const transcript = normalizeTranscript(transcriptValue);
  const repName =
    firstString(payload, [
      "rep_name",
      "repName",
      "rep",
      "sales_name",
      "transcript_generated.call_user_name",
      "assignedUserName",
      "assigned_user.name",
      "recorded_by_name",
      "userName",
      "user.name",
      "owner_name",
      "user_name",
      "recorded_by.name",
    ]) ??
    "Sales rep";
  const repEmail =
    firstString(payload, [
      "rep_email",
      "repEmail",
      "sales_email",
      "assignedUserEmail",
      "assigned_user.email",
      "recorded_by_email",
      "userEmail",
      "user.email",
      "owner_email",
      "user_email",
      "recorded_by.email",
    ]);
  const assignedUserId = await resolveRepUserId(admin, userId, repEmail);
  const title =
    firstString(payload, [
      "title",
      "meeting_title",
      "meeting.title",
      "call.title",
      "name",
      "subject",
      "topic",
    ]) ??
    `${provider === "ghl" ? "GHL" : "Fathom"} sales call`;
  const recordingUrl = firstString(payload, [
    "recording_url",
    "recordingUrl",
    "recording",
    "call.recording_url",
    "message.recording_url",
    "audio_url",
    "url",
    "share_url",
    "meeting.share_url",
  ]);
  const happenedAt =
    validDate(
      firstString(payload, [
        "call_started_at",
        "started_at",
        "start_time",
        "startTime",
        "date_added",
        "created_at",
        "createdAt",
        "call.started_at",
        "message.dateAdded",
        "meeting.started_at",
      ]),
    ) ?? new Date().toISOString();
  const duration = Number(
    firstValue(payload, [
      "duration_seconds",
      "duration",
      "durationSeconds",
      "transcript_generated.call_duration",
      "call.duration",
      "message.duration",
      "meeting.duration_seconds",
    ]) ??
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
        "name",
        "contact.name",
        "full_name",
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
  if (callId) {
    const { error } = await admin
      .from("sales_calls")
      .update(callRow)
      .eq("id", callId);
    if (error) throw error;
  }
  else {
    const { data, error } = await admin
      .from("sales_calls")
      .insert(callRow)
      .select("id")
      .single();
    if (error) throw error;
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
  if (gradeId) {
    const { error } = await admin
      .from("sales_call_gradings")
      .update(baseGrade)
      .eq("id", gradeId);
    if (error) throw error;
  }
  else {
    const { data, error } = await admin
      .from("sales_call_gradings")
      .insert(baseGrade)
      .select("id")
      .single();
    if (error) throw error;
    gradeId = data?.id;
  }

  if (!transcript.trim() || !gradeId)
    return { ok: true, callId, gradeId, graded: false };
  await admin.from("sales_call_gradings").update({ status: "grading" }).eq("id", gradeId);
  let grade;
  try {
    grade = await gradeTranscript(admin, assignedUserId, transcript);
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
      .eq("id", gradeId);
    if (error) throw error;
  } catch (error) {
    await admin
      .from("sales_call_gradings")
      .update({ status: "failed", error_message: errorMessage(error) })
      .eq("id", gradeId);
    throw error;
  }
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
  const assignedEmail = firstString(payload, [
    "assignedUserEmail",
    "assigned_user_email",
    "assignedUser.email",
    "assigned_user.email",
    "user.email",
  ]);
  const appointmentUserId = await resolveRepUserId(admin, userId, assignedEmail);
  const externalId = firstString(payload, [
    "id",
    "appointmentId",
    "appointment_id",
    "eventId",
    "calendarEvent.id",
    "data.id",
  ]);
  const scheduledAt =
    validDate(
      firstString(payload, [
        "startTime",
        "start_time",
        "scheduled_at",
        "start",
        "appointment.startTime",
        "calendarEvent.startTime",
        "data.startTime",
      ]),
    ) ?? new Date().toISOString();
  const row = {
    user_id: appointmentUserId,
    ghl_appointment_id: externalId,
    prospect_name: firstString(payload, [
      "contactName",
      "contact_name",
      "title",
      "name",
      "contact.name",
      "full_name",
    ]),
    prospect_email: firstString(payload, [
      "email",
      "contactEmail",
      "contact.email",
    ]),
    prospect_phone: firstString(payload, [
      "phone",
      "contactPhone",
      "contact.phone",
    ]),
    calendar_name: firstString(payload, [
      "calendarName",
      "calendar_name",
      "calendar.name",
    ]),
    assigned_user_id: firstString(payload, [
      "assignedUserId",
      "assigned_user_id",
      "assignedUser.id",
      "assigned_user.id",
    ]),
    assigned_user_name: firstString(payload, [
      "assignedUserName",
      "assigned_user_name",
      "assignedUser.name",
      "assigned_user.name",
    ]),
    assigned_user_email: assignedEmail,
    scheduled_at: scheduledAt,
    status:
      firstString(payload, [
        "appointmentStatus",
        "appointment.status",
        "calendarEvent.status",
        "status",
      ]) ?? "booked",
    source: "webhook",
    raw_payload: payload,
  };
  if (externalId) {
    const { data: existing } = await admin
      .from("sales_appointments")
      .select("id")
      .eq("user_id", appointmentUserId)
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

function firstValue(payload: Record<string, unknown>, paths: string[]) {
  for (const path of paths) {
    const value = valueAtPath(payload, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}
function valueAtPath(payload: Record<string, unknown>, path: string) {
  let value: unknown = payload;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
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
      const speaker = row.speaker ?? row.role ?? row.name;
      const speakerName =
        speaker && typeof speaker === "object"
          ? String(
              (speaker as Record<string, unknown>).display_name ??
                (speaker as Record<string, unknown>).name ??
                "Speaker",
            )
          : typeof speaker === "string"
          ? speaker
          : "Speaker";
      const text = row.text ?? row.utterance ?? row.message;
      return typeof text === "string" ? `${speakerName}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
}

export async function parseWebhookPayload(req: Request) {
  const requestCopy = req.clone();
  const rawBody = await req.text();
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (!rawBody.trim()) return { rawBody, payload: {} as Record<string, unknown> };
  if (contentType.includes("application/json") || rawBody.trimStart().startsWith("{")) {
    try {
      return { rawBody, payload: JSON.parse(rawBody) as Record<string, unknown> };
    } catch {
      return { rawBody, payload: null };
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return { rawBody, payload: formPayload(new URLSearchParams(rawBody)) };
  }
  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await requestCopy.formData();
      const params = new URLSearchParams();
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") params.append(key, value);
      }
      return { rawBody, payload: formPayload(params) };
    } catch {
      return { rawBody, payload: null };
    }
  }
  return { rawBody, payload: null };
}

function formPayload(entries: URLSearchParams) {
  const payload: Record<string, unknown> = {};
  for (const [key, rawValue] of entries.entries()) {
    let value: unknown = rawValue;
    if (/^[\[{]/.test(rawValue.trim())) {
      try {
        value = JSON.parse(rawValue);
      } catch {
        /* keep the submitted string */
      }
    }
    setPath(payload, key.replaceAll("[", ".").replaceAll("]", ""), value);
  }
  return payload;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  let cursor = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else {
      if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
  });
}
