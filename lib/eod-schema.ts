export type EodFieldType =
  | "short_text"
  | "long_text"
  | "number"
  | "currency"
  | "select"
  | "checkbox";

export type EodField = {
  id: string;
  label: string;
  type: EodFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

export type EodSection = {
  id: string;
  title: string;
  description?: string;
  fields: EodField[];
};

export type EodFormSchema = {
  version: 1;
  title: string;
  description: string;
  sections: EodSection[];
};

export type EodAnswer = string | boolean;
export type EodAnswers = Record<string, EodAnswer>;

const coreFieldTypes: Record<string, EodFieldType> = {
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

export const EOD_CORE_FIELD_IDS = new Set(Object.keys(coreFieldTypes));
export const EOD_FIELD_TYPES: { value: EodFieldType; label: string }[] = [
  { value: "short_text", label: "Short answer" },
  { value: "long_text", label: "Long answer" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];

export const DEFAULT_EOD_FORM_SCHEMA: EodFormSchema = {
  version: 1,
  title: "Daily sales report",
  description:
    "Close out the day with activity, pipeline movement, results, lessons, and tomorrow's exact priorities.",
  sections: [
    {
      id: "day_overview",
      title: "Day overview",
      fields: [
        {
          id: "working_hours",
          label: "Working hours",
          type: "short_text",
          placeholder: "8:30 AM-5:30 PM",
        },
        {
          id: "mood",
          label: "Energy",
          type: "select",
          required: true,
          options: ["great", "good", "neutral", "tough", "blocked"],
        },
      ],
    },
    {
      id: "outbound_activity",
      title: "Outbound activity",
      fields: [
        { id: "calls_taken", label: "Calls", type: "number", required: true },
        { id: "texts_sent", label: "Texts", type: "number" },
        { id: "emails_sent", label: "Emails", type: "number" },
        { id: "dms_sent", label: "DMs", type: "number" },
        { id: "voicemails_left", label: "Voicemails", type: "number" },
        { id: "videos_sent", label: "Videos", type: "number" },
        {
          id: "proof_assets_sent",
          label: "Proof assets sent",
          type: "short_text",
          placeholder: "What was sent, and to whom?",
        },
      ],
    },
    {
      id: "pipeline_activity",
      title: "Pipeline activity",
      fields: [
        { id: "new_inbound_inquiries", label: "Inbound prospects dialed", type: "number" },
        { id: "outbound_prospects_contacted", label: "Outbound prospects dialed", type: "number" },
        { id: "reactivated_prospects", label: "Reactivated prospects", type: "number" },
        { id: "connects", label: "Connects", type: "number", required: true },
        { id: "appointments_set", label: "New appointments set", type: "number", required: true },
        { id: "appointments_on_calendar", label: "Appointments on calendar", type: "number" },
        { id: "appointments_showed", label: "Appointments showed", type: "number" },
      ],
    },
    {
      id: "results",
      title: "Results",
      fields: [
        { id: "offers_made", label: "Offers made", type: "number" },
        { id: "deposits_taken", label: "Deposits taken", type: "number" },
        { id: "closes", label: "Closed prospects", type: "number", required: true },
        { id: "revenue", label: "Cash collected", type: "currency", required: true },
        {
          id: "expected_revenue",
          label: "Expected revenue",
          type: "short_text",
          placeholder: "Expected value and timing",
        },
        {
          id: "closed_lost",
          label: "Closed lost (count and reasons)",
          type: "long_text",
        },
      ],
    },
    {
      id: "objections",
      title: "Top objections",
      fields: [
        { id: "top_objection_1", label: "Objection #1 and response used", type: "long_text" },
        { id: "top_objection_2", label: "Objection #2 and response used", type: "long_text" },
        { id: "top_objection_3", label: "Objection #3 and response used", type: "long_text" },
      ],
    },
    {
      id: "reflection",
      title: "Reflection",
      fields: [
        { id: "best_conversation", label: "Best conversation and next step", type: "long_text" },
        { id: "biggest_lesson", label: "Biggest lesson", type: "long_text" },
        { id: "wins", label: "Wins", type: "long_text" },
        { id: "blockers", label: "Blockers and losses", type: "long_text" },
        { id: "help_needed", label: "Help needed from manager", type: "long_text" },
      ],
    },
    {
      id: "tomorrow",
      title: "Tomorrow",
      fields: [
        {
          id: "priorities",
          label: "Top priorities and exact next actions",
          type: "long_text",
          required: true,
          placeholder: "Name the prospect, owner, and next action.",
        },
      ],
    },
    {
      id: "crm_hygiene",
      title: "CRM hygiene",
      fields: [
        { id: "crm_updated", label: "CRM is fully updated", type: "checkbox" },
        {
          id: "crm_exceptions",
          label: "CRM exceptions",
          type: "long_text",
          placeholder: "List records that are not updated and why.",
        },
      ],
    },
  ],
};

const validTypes = new Set(EOD_FIELD_TYPES.map((item) => item.value));

export function cloneDefaultEodSchema(): EodFormSchema {
  return JSON.parse(JSON.stringify(DEFAULT_EOD_FORM_SCHEMA)) as EodFormSchema;
}

export function normalizeEodSchema(value: unknown): EodFormSchema {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cloneDefaultEodSchema();
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.sections)) return cloneDefaultEodSchema();
  const usedIds = new Set<string>();
  const sections: EodSection[] = [];
  for (const [sectionIndex, item] of raw.sections.slice(0, 20).entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const section = item as Record<string, unknown>;
    const fields: EodField[] = [];
    const rawFields = Array.isArray(section.fields) ? section.fields : [];
    for (const candidate of rawFields.slice(0, 60)) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const field = candidate as Record<string, unknown>;
      const id = String(field.id ?? "").trim().slice(0, 80);
      const label = String(field.label ?? "").trim().slice(0, 160);
      const requestedType = String(field.type ?? "short_text") as EodFieldType;
      if (!/^[a-z][a-z0-9_]*$/.test(id) || !label || usedIds.has(id)) continue;
      usedIds.add(id);
      const type = coreFieldTypes[id] ?? (validTypes.has(requestedType) ? requestedType : "short_text");
      const options = type === "select"
        ? id === "mood"
          ? ["great", "good", "neutral", "tough", "blocked"]
          : Array.isArray(field.options)
            ? field.options.map(String).map((option) => option.trim().slice(0, 80)).filter(Boolean).slice(0, 20)
            : []
        : undefined;
      fields.push({
        id,
        label,
        type,
        required: Boolean(field.required),
        placeholder: String(field.placeholder ?? "").slice(0, 240),
        ...(options?.length ? { options } : {}),
      });
    }
    if (!fields.length) continue;
    sections.push({
      id: String(section.id ?? `section_${sectionIndex + 1}`).replace(/[^a-z0-9_]/gi, "_").slice(0, 80),
      title: String(section.title ?? `Section ${sectionIndex + 1}`).trim().slice(0, 160),
      description: String(section.description ?? "").trim().slice(0, 500),
      fields,
    });
  }
  if (!sections.length) return cloneDefaultEodSchema();
  return {
    version: 1,
    title: String(raw.title ?? "Daily sales report").trim().slice(0, 160) || "Daily sales report",
    description: String(raw.description ?? "").trim().slice(0, 1000),
    sections,
  };
}

export function blankEodAnswers(schema: EodFormSchema): EodAnswers {
  const answers: EodAnswers = {};
  for (const section of schema.sections) {
    for (const field of section.fields) {
      answers[field.id] = field.type === "checkbox"
        ? false
        : field.type === "select"
          ? field.id === "mood"
            ? "good"
            : (field.options?.[0] ?? "")
          : field.type === "number" || field.type === "currency"
            ? "0"
            : "";
    }
  }
  return answers;
}

export function eodAnswersFromRow(
  schema: EodFormSchema,
  row: Record<string, unknown>,
): EodAnswers {
  const answers = blankEodAnswers(schema);
  const custom = row.custom_answers && typeof row.custom_answers === "object" && !Array.isArray(row.custom_answers)
    ? row.custom_answers as Record<string, unknown>
    : {};
  for (const section of schema.sections) {
    for (const field of section.fields) {
      const value = EOD_CORE_FIELD_IDS.has(field.id) ? row[field.id] : custom[field.id];
      if (field.type === "checkbox") answers[field.id] = Boolean(value);
      else if (value !== null && value !== undefined) answers[field.id] = String(value);
    }
  }
  return answers;
}

export function serializeEodAnswers(schema: EodFormSchema, answers: EodAnswers) {
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
  const customAnswers: Record<string, string | number | boolean> = {};
  for (const section of schema.sections) {
    for (const field of section.fields) {
      const raw = answers[field.id];
      let value: string | number | boolean | null;
      if (field.type === "checkbox") value = raw === true;
      else if (field.type === "number" || field.type === "currency") {
        const number = Number(raw ?? 0);
        value = Number.isFinite(number) ? Math.max(0, number) : 0;
      } else {
        value = String(raw ?? "").slice(0, field.type === "long_text" ? 10000 : 1000);
      }
      if (field.id === "mood") {
        value = ["great", "good", "neutral", "tough", "blocked"].includes(String(value)) ? value : null;
      }
      if (EOD_CORE_FIELD_IDS.has(field.id)) core[field.id] = value;
      else customAnswers[field.id] = value ?? "";
    }
  }
  core.closes = Math.min(Number(core.closes ?? 0), Number(core.calls_taken ?? 0));
  return { core, customAnswers };
}

export function isCoreEodField(id: string) {
  return EOD_CORE_FIELD_IDS.has(id);
}
