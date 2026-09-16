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
    .select("timezone,eod_form_schema")
    .eq("user_id", member.owner_user_id)
    .maybeSingle();
  const reportDate = businessDate(settings?.timezone ?? "America/Chicago");
  const schema = normalizeSchema(settings?.eod_form_schema);
  if (req.method === "GET") {
    const { data: existing } = await admin
      .from("sales_eod_reports")
      .select(
        "calls_taken,connects,appointments_set,closes,revenue,wins,blockers,priorities,mood,help_needed,crm_updated,custom_answers",
      )
      .eq("user_id", member.member_user_id)
      .eq("report_date", reportDate)
      .maybeSingle();
    return json({
      ok: true,
      repName: member.display_name ?? member.invited_email ?? "Sales rep",
      reportDate,
      existing,
      schema,
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const answers = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
    ? body.answers as Record<string, unknown>
    : body;
  const sanitized = sanitizeAnswers(schema, answers);
  if (sanitized.missing.length) {
    return json({ error: `Complete the required field: ${sanitized.missing[0]}.` }, 400);
  }
  const callsTaken = Number(sanitized.core.calls_taken ?? 0);
  const closes = Math.min(Number(sanitized.core.closes ?? 0), callsTaken);
  const row = {
    user_id: member.member_user_id,
    report_date: reportDate,
    calls_taken: callsTaken,
    connects: sanitized.core.connects,
    appointments_set: sanitized.core.appointments_set,
    closes,
    revenue: sanitized.core.revenue,
    wins: sanitized.core.wins,
    blockers: sanitized.core.blockers,
    priorities: sanitized.core.priorities,
    mood: sanitized.core.mood,
    help_needed: sanitized.core.help_needed,
    crm_updated: sanitized.core.crm_updated,
    custom_answers: sanitized.custom,
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

type EodField = {
  id: string;
  label: string;
  type: "short_text" | "long_text" | "number" | "currency" | "select" | "checkbox";
  required?: boolean;
  options?: string[];
};
type EodSchema = {
  version: 1;
  title: string;
  description: string;
  sections: { id: string; title: string; description?: string; fields: EodField[] }[];
};

const coreTypes: Record<string, EodField["type"]> = {
  calls_taken: "number",
  connects: "number",
  appointments_set: "number",
  closes: "number",
  revenue: "currency",
  mood: "select",
  wins: "long_text",
  blockers: "long_text",
  priorities: "long_text",
  help_needed: "long_text",
  crm_updated: "checkbox",
};

const fallbackSchema: EodSchema = {
  version: 1,
  title: "Daily sales report",
  description: "Give your manager a clean operating picture.",
  sections: [{
    id: "daily_report",
    title: "Daily report",
    fields: [
      { id: "calls_taken", label: "Calls", type: "number", required: true },
      { id: "connects", label: "Connects", type: "number" },
      { id: "appointments_set", label: "Appointments", type: "number" },
      { id: "closes", label: "Closes", type: "number", required: true },
      { id: "revenue", label: "Revenue", type: "currency", required: true },
      { id: "mood", label: "Energy", type: "select", options: ["great", "good", "neutral", "tough", "blocked"] },
      { id: "wins", label: "Wins", type: "long_text" },
      { id: "blockers", label: "Blockers", type: "long_text" },
      { id: "priorities", label: "Tomorrow's priorities", type: "long_text" },
      { id: "help_needed", label: "Help needed", type: "long_text" },
      { id: "crm_updated", label: "CRM is updated", type: "checkbox" },
    ],
  }],
};

function normalizeSchema(value: unknown): EodSchema {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallbackSchema;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.sections)) return fallbackSchema;
  const used = new Set<string>();
  const validTypes = new Set(["short_text", "long_text", "number", "currency", "select", "checkbox"]);
  const sections = raw.sections.slice(0, 20).flatMap((item, sectionIndex) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const section = item as Record<string, unknown>;
    const candidates = Array.isArray(section.fields) ? section.fields : [];
    const fields = candidates.slice(0, 60).flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const field = item as Record<string, unknown>;
      const id = shortText(field.id, 80).trim();
      const label = shortText(field.label, 160).trim();
      if (!/^[a-z][a-z0-9_]*$/.test(id) || !label || used.has(id)) return [];
      used.add(id);
      const requested = String(field.type ?? "short_text") as EodField["type"];
      const type = coreTypes[id] ?? (validTypes.has(requested) ? requested : "short_text");
      const options = type === "select"
        ? id === "mood"
          ? ["great", "good", "neutral", "tough", "blocked"]
          : Array.isArray(field.options)
            ? field.options.map((option) => shortText(option, 80).trim()).filter(Boolean).slice(0, 20)
            : []
        : undefined;
      return [{ id, label, type, required: field.required === true, ...(options?.length ? { options } : {}) } satisfies EodField];
    });
    if (!fields.length) return [];
    return [{
      id: shortText(section.id ?? `section_${sectionIndex + 1}`, 80),
      title: shortText(section.title ?? `Section ${sectionIndex + 1}`, 160),
      description: shortText(section.description, 500),
      fields,
    }];
  });
  return sections.length
    ? {
        version: 1,
        title: shortText(raw.title || "Daily sales report", 160),
        description: shortText(raw.description, 1000),
        sections,
      }
    : fallbackSchema;
}

function sanitizeAnswers(schema: EodSchema, answers: Record<string, unknown>) {
  const core: Record<string, unknown> = {
    calls_taken: 0,
    connects: 0,
    appointments_set: 0,
    closes: 0,
    revenue: 0,
    mood: null,
    wins: "",
    blockers: "",
    priorities: "",
    help_needed: "",
    crm_updated: false,
  };
  const custom: Record<string, string | number | boolean> = {};
  const missing: string[] = [];
  for (const section of schema.sections) {
    for (const field of section.fields) {
      const raw = answers[field.id];
      let value: string | number | boolean | null;
      if (field.type === "checkbox") value = raw === true;
      else if (field.type === "number" || field.type === "currency") value = nonnegative(raw);
      else if (field.type === "select") {
        const candidate = shortText(raw, 1000);
        value = field.options?.includes(candidate) ? candidate : "";
      } else value = shortText(raw, field.type === "long_text" ? 10000 : 1000);
      if (field.id === "mood") {
        value = ["great", "good", "neutral", "tough", "blocked"].includes(String(value)) ? value : null;
      }
      if (field.required && (value === "" || value === null || value === undefined)) missing.push(field.label);
      if (field.id in core) core[field.id] = value;
      else custom[field.id] = value ?? "";
    }
  }
  return { core, custom, missing };
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
