import {
  adminClient,
  authorizeUser,
  corsHeaders,
  json,
} from "../_shared/supabase.ts";
import {
  ensureSalesWorkspace,
  ghlCredentials,
  ghlFetch,
} from "../_shared/sales.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { user } = await authorizeUser(req);
  if (!user) return json({ error: "Sign in is required." }, 401);
  const admin = adminClient();
  await ensureSalesWorkspace(admin, user.id, user.email);
  const { ownerId, pit, locationId } = await ghlCredentials(admin, user.id);
  if (!pit || !locationId)
    return json({ error: "Connect GoHighLevel first." }, 409);
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    days?: number;
  };
  const action = body.action ?? "syncAll";

  try {
    if (action === "test") {
      const payload = await ghlFetch(
        pit,
        `/locations/${encodeURIComponent(locationId)}`,
      );
      return json({ ok: true, location: payload.location ?? payload });
    }
    const result: Record<string, unknown> = { ok: true };
    if (action === "syncAll" || action === "syncAppointments")
      result.appointments = await syncAppointments(
        admin,
        ownerId,
        pit,
        locationId,
        body.days ?? 30,
      );
    if (action === "syncAll" || action === "syncOpportunities")
      result.opportunities = await syncOpportunities(
        admin,
        ownerId,
        pit,
        locationId,
      );
    if (action === "syncAll" || action === "syncIntelligence")
      result.intelligence = await syncIntelligence(admin, ownerId, pit, locationId);
    if (!["syncAll", "syncAppointments", "syncOpportunities", "syncIntelligence"].includes(action))
      return json({ error: "Unsupported GoHighLevel action." }, 400);
    await admin
      .from("integration_connections")
      .update({ refreshed_at: new Date().toISOString() })
      .eq("user_id", ownerId)
      .eq("provider", "ghl");
    return json(result);
  } catch (error) {
    console.error("ghl-proxy", error);
    return json(
      {
        error:
          error instanceof Error ? error.message : "GoHighLevel sync failed.",
      },
      502,
    );
  }
});

async function syncAppointments(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  pit: string,
  locationId: string,
  days: number,
) {
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 180);
  const now = Date.now();
  const payload = await ghlFetch(pit, "/calendars/events", {
    locationId,
    startTime: now - windowDays * 86400000,
    endTime: now + windowDays * 86400000,
  });
  const events = Array.isArray(payload.events)
    ? (payload.events as Array<Record<string, unknown>>)
    : [];
  let saved = 0;
  for (const event of events.slice(0, 500)) {
    const externalId = String(event.id ?? event.appointmentId ?? "");
    const scheduledAt = String(
      event.startTime ?? event.startTimeUTC ?? event.start ?? "",
    );
    if (!externalId || !scheduledAt || Number.isNaN(Date.parse(scheduledAt)))
      continue;
    const row = {
      user_id: userId,
      ghl_appointment_id: externalId,
      prospect_name: String(
        event.title ?? event.contactName ?? "GHL appointment",
      ),
      prospect_email: stringOrNull(event.email),
      prospect_phone: stringOrNull(event.phone),
      calendar_name: stringOrNull(event.calendarName),
      assigned_user_id: stringOrNull(event.assignedUserId),
      assigned_user_name: stringOrNull(event.assignedUserName),
      scheduled_at: scheduledAt,
      disposition_due_at: new Date(Date.parse(scheduledAt) + 10 * 60000).toISOString(),
      status: String(event.appointmentStatus ?? event.status ?? "booked"),
      source: "ghl",
      raw_payload: event,
    };
    const { data: existing } = await admin
      .from("sales_appointments")
      .select("id")
      .eq("user_id", userId)
      .eq("ghl_appointment_id", externalId)
      .maybeSingle();
    const query = existing?.id
      ? admin.from("sales_appointments").update(row).eq("id", existing.id)
      : admin.from("sales_appointments").insert(row);
    const { error } = await query;
    if (!error) saved++;
  }
  return { received: events.length, saved };
}

async function syncIntelligence(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  pit: string,
  locationId: string,
) {
  const [contactsPayload, usersPayload, calendarsPayload, pipelinesPayload] = await Promise.all([
    ghlFetch(pit, "/contacts/", { locationId, limit: 100 }),
    ghlFetch(pit, "/users/", { locationId }),
    ghlFetch(pit, "/calendars/", { locationId }),
    ghlFetch(pit, "/opportunities/pipelines", { locationId }),
  ]);
  const contacts = arrayFrom(contactsPayload, "contacts");
  if (contacts.length) {
    const { error } = await admin.from("sales_ghl_contacts").upsert(contacts.map((contact) => {
      const tags = Array.isArray(contact.tags) ? contact.tags : [];
      const attributions = Array.isArray(contact.attributions) ? contact.attributions : [];
      const lastActivity = validDate(contact.dateUpdated ?? contact.lastActivity ?? contact.dateAdded);
      const ageDays = lastActivity ? Math.max(0, (Date.now() - Date.parse(lastActivity)) / 86400000) : 365;
      const score = Math.max(0, Math.round(100 - Math.min(60, ageDays * 3) + Math.min(20, tags.length * 4) + Math.min(20, attributions.length * 5)));
      return {
        user_id: userId, ghl_contact_id: String(contact.id),
        name: stringOrNull(contact.name) ?? ([contact.firstName, contact.lastName].filter(Boolean).join(" ") || null),
        email: stringOrNull(contact.email), phone: stringOrNull(contact.phone),
        assigned_to: stringOrNull(contact.assignedTo), source: stringOrNull(contact.source),
        score, conversation_count: Number(contact.conversationCount ?? 0) || 0,
        last_activity_at: lastActivity, raw_payload: contact, synced_at: new Date().toISOString(),
      };
    }), { onConflict: "user_id,ghl_contact_id" });
    if (error) throw error;
  }
  const references: Array<Record<string, unknown>> = [];
  for (const [kind, rows] of [
    ["user", arrayFrom(usersPayload, "users")],
    ["calendar", arrayFrom(calendarsPayload, "calendars")],
    ["pipeline", arrayFrom(pipelinesPayload, "pipelines")],
  ] as const) {
    for (const row of rows) {
      if (!row.id) continue;
      references.push({ user_id: userId, kind, external_id: String(row.id), name: String(row.name ?? row.email ?? ""), data: row, synced_at: new Date().toISOString() });
      if (kind === "pipeline" && Array.isArray(row.stages)) {
        for (const stage of row.stages as Array<Record<string, unknown>>) if (stage.id) references.push({
          user_id: userId, kind: "stage", external_id: String(stage.id), name: String(stage.name ?? ""),
          data: { ...stage, pipelineId: row.id }, synced_at: new Date().toISOString(),
        });
      }
    }
  }
  if (references.length) {
    const { error } = await admin.from("sales_ghl_reference").upsert(references, { onConflict: "user_id,kind,external_id" });
    if (error) throw error;
  }
  return { contacts: contacts.length, references: references.length };
}

function arrayFrom(payload: Record<string, unknown>, key: string) {
  return Array.isArray(payload[key]) ? payload[key] as Array<Record<string, unknown>> : [];
}

async function syncOpportunities(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  pit: string,
  locationId: string,
) {
  const payload = await ghlFetch(pit, "/opportunities/search", {
    locationId,
    status: "all",
    limit: 100,
  });
  const opportunities = Array.isArray(payload.opportunities)
    ? (payload.opportunities as Array<Record<string, unknown>>)
    : [];
  const rows = opportunities
    .filter((row) => row.id)
    .map((row) => ({
      user_id: userId,
      ghl_opportunity_id: String(row.id),
      contact_id: stringOrNull(row.contactId),
      name: String(
        row.name ??
          (row.contact as Record<string, unknown> | undefined)?.name ??
          "Opportunity",
      ),
      pipeline_id: stringOrNull(row.pipelineId),
      pipeline_stage_id: stringOrNull(row.pipelineStageId),
      status: String(row.status ?? "open"),
      monetary_value: Math.max(0, Number(row.monetaryValue ?? 0)),
      assigned_to: stringOrNull(row.assignedTo),
      last_activity_at: validDate(row.lastActionDate ?? row.updatedAt),
      raw_payload: row,
      synced_at: new Date().toISOString(),
    }));
  if (rows.length) {
    const { error } = await admin
      .from("sales_opportunities")
      .upsert(rows, { onConflict: "user_id,ghl_opportunity_id" });
    if (error) throw error;
  }
  return { received: opportunities.length, saved: rows.length };
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
function validDate(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}
