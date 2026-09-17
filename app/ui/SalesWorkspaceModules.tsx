"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bot,
  CalendarDays,
  ClipboardCheck,
  Copy,
  ExternalLink,
  LoaderCircle,
  Medal,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { supabase, supabaseProjectUrl } from "@/lib/supabase";
import {
  blankEodAnswers,
  cloneDefaultEodSchema,
  DEFAULT_EOD_FORM_SCHEMA,
  EOD_FIELD_TYPES,
  eodAnswersFromRow,
  type EodAnswers,
  type EodField,
  type EodFormSchema,
  isCoreEodField,
  normalizeEodSchema,
  serializeEodAnswers,
} from "@/lib/eod-schema";
import { EodDynamicFields } from "./EodDynamicForm";

export type SalesWorkspaceModule =
  | "responsibilities"
  | "instructions"
  | "process"
  | "offer"
  | "call-reporting"
  | "call-grading"
  | "eod-report"
  | "eod-dashboard"
  | "appointments"
  | "knowledge";

type Row = Record<string, unknown>;
type SalesState = {
  membership?: Row;
  settings?: Row;
  connections?: Row[];
  webhook?: Row | null;
};

const autopilotFunctions = [
  {
    key: "appointments",
    title: "Appointment target pacing",
    cadence: "Every 15 minutes",
    detail: "Compare today's booked appointments with the configured per-rep target and escalate the gap.",
    group: "Real-time monitoring",
  },
  {
    key: "accountability",
    title: "Rep accountability cadence",
    cadence: "Immediate, +10, +30, +60",
    detail: "Remind the assigned rep to record appointment disposition, notes, objections, revenue, and next action.",
    group: "Real-time monitoring",
  },
  {
    key: "scan",
    title: "Due-reminder scan",
    cadence: "Every 5 minutes",
    detail: "Find due commitments and turn them into ClickUp follow-up tasks.",
    group: "Real-time monitoring",
  },
  {
    key: "dropball",
    title: "Dropped-ball detection",
    cadence: "Every 15 minutes",
    detail:
      "Find stalled opportunities and missed follow-ups, then escalate them in ClickUp.",
    group: "Real-time monitoring",
  },
  {
    key: "crm",
    title: "CRM monitoring",
    cadence: "Every 15 minutes",
    detail:
      "Refresh GoHighLevel and flag waiting leads, stale deals, and missing activity.",
    group: "Real-time monitoring",
  },
  {
    key: "leadsdigest",
    title: "Lead digest",
    cadence: "Daily",
    detail:
      "Summarize new opportunities, unworked leads, and pipeline value in ClickUp.",
    group: "Daily workflow",
  },
  {
    key: "briefing",
    title: "Daily rep briefing",
    cadence: "Every morning",
    detail:
      "Create the appointment, follow-up, and highest-value priority brief.",
    group: "Daily workflow",
  },
  {
    key: "eodLink",
    title: "EOD link delivery",
    cadence: "Configured local time",
    detail: "Deliver each rep's private EOD submission link as a ClickUp task.",
    group: "End of day",
  },
  {
    key: "eodEnforce",
    title: "EOD enforcement",
    cadence: "End of day",
    detail: "Chase missing reports and escalate gaps to the owner in ClickUp.",
    group: "End of day",
  },
  {
    key: "morale",
    title: "Team morale monitor",
    cadence: "Daily",
    detail:
      "Read EOD sentiment and report team momentum, blockers, and support needs.",
    group: "Coaching",
  },
  {
    key: "coaching",
    title: "Weekly coaching",
    cadence: "Friday",
    detail:
      "Create team scorecards and focused coaching actions from calls and CRM execution.",
    group: "Coaching",
  },
  {
    key: "commandReport",
    title: "Daily Sales Command Report",
    cadence: "Daily",
    detail: "Aggregate EOD completion, appointments, closes, cash, grading, blockers, and overdue dispositions.",
    group: "Daily workflow",
  },
  {
    key: "transition",
    title: "New-client transition",
    cadence: "Hourly",
    detail: "Create a handoff checklist for every recent won opportunity and escalate incomplete onboarding steps.",
    group: "Daily workflow",
  },
] as const;

const demoRoster: Row[] = [
  {
    member_user_id: "maya",
    display_name: "Maya Chen",
    calls: 42,
    reported_calls: 118,
    connects: 54,
    appointments_set: 18,
    appointments: 17,
    closes: 7,
    reported_revenue: 37400,
    call_close_rate: 5.93,
    average_score: 92,
    crm_compliance: 100,
  },
  {
    member_user_id: "jon",
    display_name: "Jon Bell",
    calls: 35,
    reported_calls: 104,
    connects: 46,
    appointments_set: 14,
    appointments: 13,
    closes: 5,
    reported_revenue: 26800,
    call_close_rate: 4.81,
    average_score: 84,
    crm_compliance: 86,
  },
  {
    member_user_id: "ria",
    display_name: "Ria Santos",
    calls: 31,
    reported_calls: 95,
    connects: 40,
    appointments_set: 12,
    appointments: 11,
    closes: 4,
    reported_revenue: 21400,
    call_close_rate: 4.21,
    average_score: 88,
    crm_compliance: 93,
  },
];

const demoEods: Row[] = [
  {
    id: "e1",
    user_id: "maya",
    display_name: "Maya Chen",
    report_date: "2026-09-14",
    calls_taken: 19,
    connects: 9,
    appointments_set: 3,
    closes: 1,
    revenue: 6200,
    mood: "great",
    crm_updated: true,
    wins: "Recovered an at-risk opportunity.",
    blockers: "None",
    priorities: "Follow up with Harbor Dental.",
  },
  {
    id: "e2",
    user_id: "jon",
    display_name: "Jon Bell",
    report_date: "2026-09-14",
    calls_taken: 16,
    connects: 7,
    appointments_set: 2,
    closes: 1,
    revenue: 4800,
    mood: "good",
    crm_updated: true,
    wins: "Booked two qualified appointments.",
    blockers: "Pricing objection on two calls.",
    priorities: "Review objection handling.",
  },
];

const demoGrades: Row[] = [
  {
    id: "g1",
    title: "Northstar Dental discovery",
    rep_name: "Maya Chen",
    provider: "fathom",
    status: "graded",
    overall_score: 92,
    script_adherence_pct: 88,
    category_scores: {
      discovery: 94,
      objections: 86,
      closing: 90,
      tonality: 93,
    },
    strengths: ["Clear discovery", "Strong consequence questions"],
    improvements: ["Confirm the dated next step"],
    coaching_notes: "Strong discovery. Tighten the final commitment.",
    graded_at: "2026-09-14T06:00:00Z",
  },
];

const demoAppointments: Row[] = [
  {
    id: "a1",
    prospect_name: "Harbor Dental",
    prospect_email: "owner@harbordental.example",
    calendar_name: "Growth consultation",
    assigned_user_name: "Maya Chen",
    scheduled_at: "2026-09-15T15:00:00Z",
    status: "confirmed",
    outcome: "pending",
    revenue: 0,
  },
  {
    id: "a2",
    prospect_name: "Summit HVAC",
    prospect_email: "ops@summithvac.example",
    calendar_name: "Strategy call",
    assigned_user_name: "Jon Bell",
    scheduled_at: "2026-09-14T17:30:00Z",
    status: "completed",
    outcome: "won",
    revenue: 8400,
    next_steps: "Send agreement and onboarding form.",
  },
];

export function SalesWorkspaceModules({
  module,
  isDemo,
}: {
  module: SalesWorkspaceModule;
  isDemo: boolean;
}) {
  if (module === "responsibilities")
    return <ResponsibilitiesPanel isDemo={isDemo} />;
  if (module === "instructions") return <InstructionsPanel isDemo={isDemo} />;
  if (module === "process")
    return (
      <DocumentPanel
        isDemo={isDemo}
        slug="sales-process"
        title="Sales Process"
        category="playbook"
        detail="Document the exact route from lead to close: qualification, discovery, presentation, objections, commitment, and follow-up."
      />
    );
  if (module === "offer")
    return (
      <DocumentPanel
        isDemo={isDemo}
        slug="offer"
        title="The Offer"
        category="playbook"
        detail="Keep the promise, ideal customer, pricing, proof, guarantee, qualification rules, pitch, and call to action current."
      />
    );
  if (module === "call-reporting")
    return <CallReportingPanel isDemo={isDemo} />;
  if (module === "call-grading") return <CallGradingPanel isDemo={isDemo} />;
  if (module === "eod-report") return <EodReportPanel isDemo={isDemo} />;
  if (module === "eod-dashboard") return <EodDashboardPanel isDemo={isDemo} />;
  if (module === "appointments") return <AppointmentsPanel isDemo={isDemo} />;
  return (
    <DocumentPanel
      isDemo={isDemo}
      slug="industry-knowledge"
      title="Industry Knowledge"
      category="knowledge"
      detail="Give Charles current terminology, product facts, objections, approved claims, disclosures, and compliance boundaries."
    />
  );
}

async function salesState() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke(
    "sales-integrations",
    {
      body: { action: "state" },
    },
  );
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return (data ?? {}) as SalesState;
}

async function saveSettings(values: Row) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke(
    "sales-integrations",
    {
      body: { action: "saveSettings", ...values },
    },
  );
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
}

function ResponsibilitiesPanel({ isDemo }: { isDemo: boolean }) {
  const defaultFunctions = Object.fromEntries(
    autopilotFunctions.map((item) => [item.key, true]),
  );
  const [state, setState] = useState<SalesState>({
    settings: {
      autopilot_enabled: false,
      autopilot_functions: defaultFunctions,
    },
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo) return;
    setBusy(true);
    try {
      setState(await salesState());
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not load Autopilot.",
      );
    } finally {
      setBusy(false);
    }
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  const settings = state.settings ?? {};
  const functions = (settings.autopilot_functions ??
    defaultFunctions) as Record<string, boolean>;
  async function update(patch: Row, success: string) {
    const previous = state;
    setState((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
    setNotice("");
    if (isDemo) {
      setNotice(`Demo: ${success}`);
      return;
    }
    setBusy(true);
    try {
      await saveSettings(patch);
      setNotice(success);
    } catch (error) {
      setState(previous);
      setNotice(
        error instanceof Error
          ? error.message
          : "Autopilot could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }
  const groups = [
    "Real-time monitoring",
    "Daily workflow",
    "End of day",
    "Coaching",
  ];
  return (
    <section>
      <ModuleHeading
        eyebrow="CHARLES AUTOPILOT"
        title="Choose exactly what Charles owns."
        detail="All nine production workflows remain independently controllable. Deliveries go to ClickUp; Slack is not used."
      />
      {notice && <p className="inline-notice">{notice}</p>}
      <article className="panel autopilot-master">
        <div className="autopilot-identity">
          <span>
            <Bot size={20} />
          </span>
          <div>
            <b>Charles - AI Director of Sales Operations</b>
            <small>
              Monitors execution, coaches the team, protects CRM hygiene, and
              closes the accountability loop.
            </small>
          </div>
        </div>
        <label className="toggle-row compact">
          <span>
            <b>Master Autopilot</b>
            <small>Individual choices stay saved while paused.</small>
          </span>
          <input
            type="checkbox"
            disabled={busy}
            checked={Boolean(settings.autopilot_enabled)}
            onChange={(event) =>
              void update(
                { autopilot_enabled: event.target.checked },
                event.target.checked
                  ? "Charles Autopilot enabled."
                  : "Charles Autopilot paused.",
              )
            }
          />
        </label>
      </article>
      <div className="responsibility-groups">
        {groups.map((group) => {
          const rows = autopilotFunctions.filter(
            (item) => item.group === group,
          );
          const enabled = rows.some((item) => functions[item.key] !== false);
          return (
            <details className="panel responsibility-section" open key={group}>
              <summary>
                <span>
                  <Activity size={17} />
                  <b>{group}</b>
                  <small>{rows.length} responsibilities</small>
                </span>
                <i className={enabled ? "enabled" : ""}>
                  {enabled ? "On" : "Off"}
                </i>
              </summary>
              <div className="responsibility-list">
                {rows.map((item) => (
                  <label key={item.key}>
                    <span>
                      <b>{item.title}</b>
                      <small>{item.detail}</small>
                      <em>{item.cadence}</em>
                    </span>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={functions[item.key] !== false}
                      onChange={(event) => {
                        const next = {
                          ...functions,
                          [item.key]: event.target.checked,
                        };
                        void update(
                          { autopilot_functions: next },
                          `${item.title} ${event.target.checked ? "enabled" : "disabled"}.`,
                        );
                      }}
                    />
                  </label>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      <article className="panel autopilot-scope">
        <ShieldCheck size={20} />
        <div>
          <b>Autopilot execution model</b>
          <p>
            Scheduled jobs run server-side with service-role authorization,
            respect the master switch and every function toggle, deduplicate
            recurring deliveries, refresh GoHighLevel where required, and create
            ClickUp tasks without exposing provider credentials to the browser.
          </p>
        </div>
      </article>
    </section>
  );
}

function InstructionsPanel({ isDemo }: { isDemo: boolean }) {
  const [state, setState] = useState<SalesState>({ settings: {} });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo) {
      setState({
        settings: {
          instructions:
            "Coach from evidence. Name the owner and the dated next action. Escalate stalled revenue without hype.",
          soul: "Calm, direct, demanding, practical, and respectful.",
          timezone: "America/Chicago",
          daily_appointment_target: 8,
          crm_stuck_days: 7,
          crm_wait_minutes: 15,
          eod_link_send_time: "16:00",
          eod_enforce_delay_minutes: 30,
          briefing_send_time: "07:00",
          leads_digest_send_time: "16:30",
          morale_send_time: "17:00",
          coaching_send_time: "16:00",
          eod_link_template: "Please complete today's EOD report: {url}",
          eod_form_schema: DEFAULT_EOD_FORM_SCHEMA,
        },
        membership: { role: "owner" },
      });
      return;
    }
    setBusy(true);
    try {
      setState(await salesState());
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not load instructions.",
      );
    } finally {
      setBusy(false);
    }
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    values.daily_appointment_target = Number(values.daily_appointment_target);
    values.crm_stuck_days = Number(values.crm_stuck_days);
    values.crm_wait_minutes = Number(values.crm_wait_minutes);
    values.eod_enforce_delay_minutes = Number(values.eod_enforce_delay_minutes);
    if (isDemo) {
      setNotice("Demo instructions saved.");
      return;
    }
    setBusy(true);
    try {
      await saveSettings(values);
      setNotice("Charles instructions and operating targets saved.");
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Instructions could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  const settings = state.settings ?? {};
  return (
    <section>
      <ModuleHeading
        eyebrow="INSTRUCTIONS & SOUL"
        title="Define how Charles should lead."
        detail="These instructions are included in Charles's coaching, grading, summaries, and recommended actions."
      />
      {notice && <p className="inline-notice">{notice}</p>}
      <article className="panel">
        <form
          className="form-stack flush"
          key={String(settings.updated_at ?? "instructions")}
          onSubmit={submit}
        >
          <label>
            Operating instructions
            <textarea
              name="instructions"
              defaultValue={String(settings.instructions ?? "")}
              placeholder="Offer context, sales process, qualification rules, escalation rules, and coaching priorities..."
            />
          </label>
          <label>
            Charles personality / soul
            <textarea
              name="soul"
              defaultValue={String(settings.soul ?? "")}
              placeholder="Direct, calm, analytical, demanding..."
            />
          </label>
          <div className="form-grid three">
            <label>
              Timezone
              <input
                required
                name="timezone"
                defaultValue={String(settings.timezone ?? "America/Chicago")}
              />
            </label>
            <label>
              Daily appointment target
              <input
                required
                type="number"
                min="0"
                name="daily_appointment_target"
                defaultValue={Number(settings.daily_appointment_target ?? 8)}
              />
            </label>
            <label>
              Stuck opportunity days
              <input
                required
                type="number"
                min="1"
                name="crm_stuck_days"
                defaultValue={Number(settings.crm_stuck_days ?? 7)}
              />
            </label>
            <label>
              Lead wait threshold
              <input
                required
                type="number"
                min="1"
                name="crm_wait_minutes"
                defaultValue={Number(settings.crm_wait_minutes ?? 15)}
              />
            </label>
            <label>
              EOD delivery time
              <input
                required
                type="time"
                name="eod_link_send_time"
                defaultValue={String(
                  settings.eod_link_send_time ?? "16:00",
                ).slice(0, 5)}
              />
            </label>
            <label>
              EOD chase delay (minutes)
              <input
                required
                type="number"
                min="0"
                max="720"
                name="eod_enforce_delay_minutes"
                defaultValue={Number(settings.eod_enforce_delay_minutes ?? 30)}
              />
            </label>
            <label>
              Morning briefing time
              <input
                required
                type="time"
                name="briefing_send_time"
                defaultValue={String(
                  settings.briefing_send_time ?? "07:00",
                ).slice(0, 5)}
              />
            </label>
            <label>
              Lead digest time
              <input
                required
                type="time"
                name="leads_digest_send_time"
                defaultValue={String(
                  settings.leads_digest_send_time ?? "16:30",
                ).slice(0, 5)}
              />
            </label>
            <label>
              Morale report time
              <input
                required
                type="time"
                name="morale_send_time"
                defaultValue={String(
                  settings.morale_send_time ?? "17:00",
                ).slice(0, 5)}
              />
            </label>
            <label>
              Friday coaching time
              <input
                required
                type="time"
                name="coaching_send_time"
                defaultValue={String(
                  settings.coaching_send_time ?? "16:00",
                ).slice(0, 5)}
              />
            </label>
          </div>
          <label>
            EOD ClickUp task template
            <input
              required
              name="eod_link_template"
              defaultValue={String(
                settings.eod_link_template ??
                  "Please complete today's EOD report: {url}",
              )}
            />
          </label>
          <button className="primary-btn" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Save size={16} />
            )}{" "}
            Save instructions
          </button>
        </form>
      </article>
      {(isDemo || state.membership?.role === "owner") && (
        <EodFormBuilder
          key={String(settings.updated_at ?? "eod-builder")}
          initialSchema={normalizeEodSchema(settings.eod_form_schema)}
          isDemo={isDemo}
          onSaved={load}
        />
      )}
    </section>
  );
}

function EodFormBuilder({
  initialSchema,
  isDemo,
  onSaved,
}: {
  initialSchema: EodFormSchema;
  isDemo: boolean;
  onSaved: () => Promise<void>;
}) {
  const [schema, setSchema] = useState(() => normalizeEodSchema(initialSchema));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  function updateSection(index: number, patch: Partial<EodFormSchema["sections"][number]>) {
    setSchema((current) => ({
      ...current,
      sections: current.sections.map((section, sectionIndex) =>
        sectionIndex === index ? { ...section, ...patch } : section
      ),
    }));
  }

  function updateField(sectionIndex: number, fieldIndex: number, patch: Partial<EodField>) {
    setSchema((current) => ({
      ...current,
      sections: current.sections.map((section, currentSection) =>
        currentSection === sectionIndex
          ? {
              ...section,
              fields: section.fields.map((field, currentField) =>
                currentField === fieldIndex ? { ...field, ...patch } : field
              ),
            }
          : section
      ),
    }));
  }

  function moveSection(index: number, direction: -1 | 1) {
    setSchema((current) => {
      const sections = [...current.sections];
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= sections.length) return current;
      [sections[index], sections[nextIndex]] = [sections[nextIndex], sections[index]];
      return { ...current, sections };
    });
  }

  function moveField(sectionIndex: number, fieldIndex: number, direction: -1 | 1) {
    setSchema((current) => ({
      ...current,
      sections: current.sections.map((section, currentSection) => {
        if (currentSection !== sectionIndex) return section;
        const fields = [...section.fields];
        const nextIndex = fieldIndex + direction;
        if (nextIndex < 0 || nextIndex >= fields.length) return section;
        [fields[fieldIndex], fields[nextIndex]] = [fields[nextIndex], fields[fieldIndex]];
        return { ...section, fields };
      }),
    }));
  }

  async function save() {
    const normalized = normalizeEodSchema(schema);
    setSchema(normalized);
    if (isDemo) {
      setNotice("Demo EOD form saved for this preview.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await saveSettings({ eod_form_schema: normalized });
      setNotice("EOD form customization saved for the team and private links.");
      await onSaved();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The EOD form could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel eod-builder">
      <div className="panel-head">
        <div>
          <span className="eyebrow">EOD FORM BUILDER</span>
          <h3>Customize the team&apos;s report</h3>
          <p>
            This one template controls the signed-in report and every private EOD link.
            Core sales metrics continue feeding reporting and leaderboards.
          </p>
        </div>
      </div>
      {notice && <p className="inline-notice">{notice}</p>}
      <div className="form-stack flush">
        <div className="form-grid">
          <label>
            Report title
            <input value={schema.title} onChange={(event) => setSchema((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label>
            Intro message
            <input value={schema.description} onChange={(event) => setSchema((current) => ({ ...current, description: event.target.value }))} />
          </label>
        </div>
        <div className="eod-builder-sections">
          {schema.sections.map((section, sectionIndex) => (
            <div className="eod-builder-section" key={section.id}>
              <div className="eod-builder-section-head">
                <input aria-label="Section title" value={section.title} onChange={(event) => updateSection(sectionIndex, { title: event.target.value })} />
                <div className="eod-builder-actions">
                  <button type="button" title="Move section up" onClick={() => moveSection(sectionIndex, -1)} disabled={sectionIndex === 0}><ArrowUp size={14} /></button>
                  <button type="button" title="Move section down" onClick={() => moveSection(sectionIndex, 1)} disabled={sectionIndex === schema.sections.length - 1}><ArrowDown size={14} /></button>
                  <button type="button" title="Remove section" onClick={() => setSchema((current) => ({ ...current, sections: current.sections.filter((_, index) => index !== sectionIndex) }))} disabled={schema.sections.length === 1}><Trash2 size={14} /></button>
                </div>
              </div>
              <input
                className="eod-section-description"
                aria-label="Section description"
                placeholder="Optional section guidance"
                value={section.description ?? ""}
                onChange={(event) => updateSection(sectionIndex, { description: event.target.value })}
              />
              <div className="eod-builder-fields">
                {section.fields.map((field, fieldIndex) => (
                  <div className="eod-builder-field" key={field.id}>
                    <label>
                      Question label
                      <input value={field.label} onChange={(event) => updateField(sectionIndex, fieldIndex, { label: event.target.value })} />
                    </label>
                    <label>
                      Answer type
                      <select value={field.type} disabled={isCoreEodField(field.id)} onChange={(event) => updateField(sectionIndex, fieldIndex, { type: event.target.value as EodField["type"] })}>
                        {EOD_FIELD_TYPES.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}
                      </select>
                    </label>
                    <label>
                      Placeholder
                      <input value={field.placeholder ?? ""} onChange={(event) => updateField(sectionIndex, fieldIndex, { placeholder: event.target.value })} />
                    </label>
                    {field.type === "select" && !isCoreEodField(field.id) && (
                      <label>
                        Options (comma-separated)
                        <input value={(field.options ?? []).join(", ")} onChange={(event) => updateField(sectionIndex, fieldIndex, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })} />
                      </label>
                    )}
                    <label className="check-label">
                      <input type="checkbox" checked={field.required === true} onChange={(event) => updateField(sectionIndex, fieldIndex, { required: event.target.checked })} /> Required
                    </label>
                    <div className="eod-builder-actions">
                      <button type="button" title="Move question up" onClick={() => moveField(sectionIndex, fieldIndex, -1)} disabled={fieldIndex === 0}><ArrowUp size={14} /></button>
                      <button type="button" title="Move question down" onClick={() => moveField(sectionIndex, fieldIndex, 1)} disabled={fieldIndex === section.fields.length - 1}><ArrowDown size={14} /></button>
                      <button type="button" title="Remove question" onClick={() => updateSection(sectionIndex, { fields: section.fields.filter((_, index) => index !== fieldIndex) })} disabled={section.fields.length === 1}><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="quiet-btn"
                type="button"
                onClick={() => updateSection(sectionIndex, {
                  fields: [...section.fields, { id: `custom_${crypto.randomUUID().replaceAll("-", "")}`, label: "New question", type: "short_text" }],
                })}
              ><Plus size={14} /> Add question</button>
            </div>
          ))}
        </div>
        <div className="eod-builder-footer">
          <button
            className="quiet-btn"
            type="button"
            onClick={() => setSchema((current) => ({
              ...current,
              sections: [...current.sections, {
                id: `section_${crypto.randomUUID().replaceAll("-", "")}`,
                title: "New section",
                fields: [{ id: `custom_${crypto.randomUUID().replaceAll("-", "")}`, label: "New question", type: "short_text" }],
              }],
            }))}
          ><Plus size={14} /> Add section</button>
          <button className="quiet-btn" type="button" onClick={() => setSchema(cloneDefaultEodSchema())}>Restore reference template</button>
          <button className="primary-btn" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Save EOD form
          </button>
        </div>
      </div>
    </article>
  );
}

function DocumentPanel({
  isDemo,
  slug,
  title,
  category,
  detail,
}: {
  isDemo: boolean;
  slug: string;
  title: string;
  category: string;
  detail: string;
}) {
  const sample =
    slug === "sales-process"
      ? "# Sales Process\n\n## Qualification\n- Confirm fit, urgency, authority, and next step.\n\n## Discovery\n- Understand the current situation, cost of inaction, and desired outcome.\n\n## Close\n- Resolve objections and agree on a dated next action."
      : slug === "offer"
        ? "# The Offer\n\n## Promise\nDescribe the outcome without unverifiable guarantees.\n\n## Pricing and terms\nDocument current pricing, inclusions, exclusions, and refund terms.\n\n## Proof\nList only proof the team may verify and use."
        : "# Industry Knowledge\n\n## Fundamentals\nAdd current product facts and terminology.\n\n## Objections\nDocument approved, accurate responses.\n\n## Compliance\nList prohibited claims and required disclosures.";
  const [body, setBody] = useState(isDemo ? sample : "");
  const [updatedAt, setUpdatedAt] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo || !supabase) return;
    setBusy(true);
    try {
      await salesState();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Sign in is required.");
      const result = await supabase
        .from("sales_os_documents")
        .select("body_md,updated_at")
        .eq("slug", slug)
        .maybeSingle();
      let data = result.data;
      if (result.error) throw result.error;
      if (!data) {
        const created = await supabase
          .from("sales_os_documents")
          .insert({ user_id: userId, slug, title, category, body_md: sample })
          .select("body_md,updated_at")
          .single();
        if (created.error) throw created.error;
        data = created.data;
      }
      setBody(String(data.body_md ?? ""));
      setUpdatedAt(String(data.updated_at ?? ""));
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Document could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }, [category, isDemo, sample, slug, title]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  async function save() {
    if (isDemo) {
      setNotice("Demo document saved.");
      setEditing(false);
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase
      .from("sales_os_documents")
      .update({ body_md: body })
      .eq("slug", slug);
    setBusy(false);
    if (error) setNotice(error.message);
    else {
      setNotice(`${title} saved.`);
      setEditing(false);
      await load();
    }
  }
  return (
    <section>
      <ModuleHeading
        eyebrow={category.toUpperCase()}
        title={title}
        detail={detail}
        action={
          !editing ? (
            <button className="small-primary" onClick={() => setEditing(true)}>
              Edit document
            </button>
          ) : undefined
        }
      />
      {notice && <p className="inline-notice">{notice}</p>}
      <article className="panel document-panel">
        <div className="document-meta">
          <small>
            {updatedAt
              ? `Last updated ${new Date(updatedAt).toLocaleString()}`
              : "Private workspace document"}
          </small>
          {editing && (
            <div>
              <button
                className="quiet-btn"
                onClick={() => {
                  setEditing(false);
                  void load();
                }}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                disabled={busy}
                onClick={() => void save()}
              >
                <Save size={15} /> Save
              </button>
            </div>
          )}
        </div>
        {editing ? (
          <textarea
            className="document-editor"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        ) : (
          <SimpleMarkdown body={body} />
        )}
      </article>
    </section>
  );
}

function CallReportingPanel({ isDemo }: { isDemo: boolean }) {
  const [daily, setDaily] = useState<Row[]>(isDemo ? demoEods : []);
  const [roster, setRoster] = useState<Row[]>(isDemo ? demoRoster : []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo || !supabase) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "owner-dashboard",
        { body: { periodDays: 7 } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      setDaily(Array.isArray(data.daily) ? data.daily : []);
      setRoster(Array.isArray(data.roster) ? data.roster : []);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Reporting could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  const totals = useMemo(
    () =>
      roster.reduce(
        (sum, row) => ({
          calls: sum.calls + Number(row.reported_calls ?? 0),
          connects: sum.connects + Number(row.connects ?? 0),
          appointments: sum.appointments + Number(row.appointments_set ?? 0),
          closes: sum.closes + Number(row.closes ?? 0),
        }),
        { calls: 0, connects: 0, appointments: 0, closes: 0 },
      ),
    [roster],
  );
  const quality = average(roster.map((row) => row.average_score));
  const adherence = average(roster.map((row) => row.crm_compliance));
  return (
    <section>
      <ModuleHeading
        eyebrow="CALL REPORTING"
        title="Review activity and choose the next coaching priority."
        detail="EOD activity, conversion movement, and AI-graded call quality stay in one report."
        action={
          <button
            className="small-primary"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw className={busy ? "spin" : ""} size={14} /> Refresh
          </button>
        }
      />
      {notice && <p className="inline-notice">{notice}</p>}
      <div className="report-scorecard">
        {[
          { label: "Calls", value: totals.calls, helper: "EOD reported" },
          {
            label: "Connect rate",
            value: totals.calls
              ? `${Math.round((totals.connects / totals.calls) * 100)}%`
              : "-",
            helper: `${totals.connects} connects`,
          },
          {
            label: "Appointments",
            value: totals.appointments,
            helper: "Set by team",
          },
          {
            label: "Closes",
            value: totals.closes,
            helper: "Reported outcomes",
          },
          {
            label: "Call quality",
            value: quality === null ? "-" : quality.toFixed(0),
            helper: "AI grade",
          },
          {
            label: "CRM",
            value: adherence === null ? "-" : `${adherence.toFixed(0)}%`,
            helper: "Compliance",
          },
        ].map((metric) => (
          <article key={metric.label}>
            <small>{metric.label}</small>
            <b>{metric.value}</b>
            <span>{metric.helper}</span>
          </article>
        ))}
      </div>
      <article className="panel report-history">
        <div className="panel-head">
          <div>
            <span className="eyebrow">DAILY ACTIVITY</span>
            <h3>Report history</h3>
          </div>
          <span className="freshness">Last 7 days</span>
        </div>
        <div className="report-row header">
          <span>Date</span>
          <span>Rep</span>
          <span>Calls</span>
          <span>Connects</span>
          <span>Appts</span>
          <span>Closes</span>
          <span>CRM</span>
        </div>
        {daily.map((row) => (
          <div className="report-row" key={String(row.id)}>
            <span>{String(row.report_date)}</span>
            <span>
              <b>{String(row.display_name ?? "Team member")}</b>
            </span>
            <span>{String(row.calls_taken ?? 0)}</span>
            <span>{String(row.connects ?? 0)}</span>
            <span>{String(row.appointments_set ?? 0)}</span>
            <span>{String(row.closes ?? 0)}</span>
            <span>
              {row.crm_updated ? (
                <i className="text-good">Updated</i>
              ) : (
                <i className="text-warn">Missing</i>
              )}
            </span>
          </div>
        ))}
        {!daily.length && (
          <p className="empty-copy">
            No EOD reports are available in this period.
          </p>
        )}
      </article>
    </section>
  );
}

function CallGradingPanel({ isDemo }: { isDemo: boolean }) {
  const [grades, setGrades] = useState<Row[]>(isDemo ? demoGrades : []);
  const [selected, setSelected] = useState<Row | null>(isDemo ? demoGrades[0] : null);
  const [workspace, setWorkspace] = useState<SalesState>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo || !supabase) return;
    setBusy(true);
    try {
      const [state, result] = await Promise.all([
        salesState(),
        supabase.from("sales_call_gradings").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      if (result.error) throw result.error;
      setWorkspace(state);
      setGrades(result.data ?? []);
      setSelected((current) =>
        (result.data ?? []).find((row) => row.id === current?.id) ?? result.data?.[0] ?? null,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Call grading could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
    if (isDemo || !supabase) return;
    const channel = supabase
      .channel("sales-call-gradings")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_call_gradings" }, () => void load())
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [isDemo, load]);

  async function runGrade(body: Row, success: string) {
    if (isDemo) {
      setNotice("Demo transcript graded: 86/100.");
      return true;
    }
    if (!supabase) return false;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("grade-call", { body });
    setBusy(false);
    if (error || data?.error) {
      setNotice(error?.message ?? String(data.error));
      return false;
    }
    setNotice(success);
    await load();
    return true;
  }
  async function grade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (await runGrade({ title: values.get("title"), repName: values.get("repName"), transcript: values.get("transcript") }, "Call graded and added to coaching history.")) form.reset();
  }
  async function copyUrl(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice("Webhook URL copied.");
  }
  const token = String(workspace.webhook?.token ?? "");
  const base = supabaseProjectUrl ? `${supabaseProjectUrl}/functions/v1` : "";
  const fathomUrl = token && base ? `${base}/fathom-webhook?token=${token}` : "";
  const ghlUrl = token && base ? `${base}/ghl-call-webhook?token=${token}` : "";
  const categories = selected?.category_scores && typeof selected.category_scores === "object"
    ? Object.entries(selected.category_scores as Row)
    : [];
  const status = String(selected?.status ?? "pending");
  return (
    <section>
      <ModuleHeading
        eyebrow="CALL GRADING"
        title="Coach from the actual conversation."
        detail="Fathom and GoHighLevel calls use the same IUL Demand Capture scorecard as the reference app. Other calls can be graded by pasting a transcript."
      />
      {notice && <p className="inline-notice">{notice}</p>}
      {fathomUrl && (
        <div className="call-webhook-grid">
          {[
            { label: "Fathom webhook", url: fathomUrl, detail: "Use Fathom meeting_content_ready with transcript enabled. Direct Fathom signatures are verified when a webhook secret is connected." },
            { label: "GHL phone call webhook", url: ghlUrl, detail: "Use a Call Status / Recording Ready workflow and send call_id, transcript, recording_url, duration, and the assigned user's email." },
          ].map((item) => (
            <article className="panel webhook-card" key={item.label}>
              <b>{item.label}</b>
              <div><code>{item.url}</code><button className="secondary-btn" type="button" onClick={() => void copyUrl(item.url)}><Copy size={15} /> Copy</button></div>
              <small>{item.detail}</small>
            </article>
          ))}
        </div>
      )}
      <div className="grading-workspace">
        <article className="panel">
          <form className="form-stack flush" onSubmit={grade}>
            <label>Call title<input required name="title" placeholder="Discovery call - Prospect" /></label>
            <label>Sales rep<input name="repName" placeholder="Rep name" /></label>
            <label>Transcript<textarea required minLength={40} name="transcript" placeholder="Paste the complete transcript..." /></label>
            <button className="primary-btn" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} Grade other call</button>
          </form>
          <div className="grade-history">
            {grades.map((row) => (
              <button className={selected?.id === row.id ? "active" : ""} key={String(row.id)} onClick={() => setSelected(row)}>
                <span>
                  <b>{String(row.title ?? "Sales call")}</b>
                  <small>{new Date(String(row.call_started_at ?? row.created_at)).toLocaleDateString()} · {String(row.rep_name ?? row.rep_email ?? "Unassigned")} · {String(row.provider ?? "manual")}</small>
                  <small className={`grade-status ${String(row.status)}`}>{String(row.status ?? "pending")}</small>
                </span>
                <strong>{row.overall_score == null ? "-" : Number(row.overall_score).toFixed(0)}</strong>
              </button>
            ))}
            {!grades.length && <p className="empty-copy">No calls yet. Add a webhook or paste a transcript above.</p>}
          </div>
        </article>
        <article className="panel grade-detail">
          {selected ? (
            <>
              <div className="grade-detail-header">
                <span><b>{String(selected.title ?? "Sales call")}</b><small>{String(selected.rep_name ?? selected.rep_email ?? "Unassigned")} · {status}</small></span>
                <button className="secondary-btn" type="button" disabled={busy || !selected.transcript} onClick={() => void runGrade({ gradingId: selected.id }, "Call regraded.")}><RefreshCw size={15} /> Regrade</button>
              </div>
              {status === "failed" && <p className="inline-notice error">Grading failed: {String(selected.error_message ?? "Unknown error")}</p>}
              {(status === "pending" || status === "grading") && <p className="empty-copy">{status === "grading" ? "AI grading is in progress…" : "Waiting for a usable transcript."}</p>}
              <div className="grade-score">
                <strong>{selected.overall_score == null ? "-" : Number(selected.overall_score).toFixed(0)}</strong>
                <span><b>Overall call score</b><small>{selected.script_adherence_pct == null ? "-" : Number(selected.script_adherence_pct).toFixed(0)}% script adherence</small></span>
              </div>
              <div className="category-bars">
                {categories.map(([name, value]) => <div key={name}><span><b>{name.replaceAll("_", " ")}</b><small>{Number(value).toFixed(0)}</small></span><i><em style={{ width: `${Math.min(100, Number(value))}%` }} /></i></div>)}
              </div>
              <ResultList title="Strengths" values={selected.strengths} />
              <ResultList title="Improvements" values={selected.improvements} />
              {selected.coaching_notes && <p className="coach-note">{String(selected.coaching_notes)}</p>}
              {selected.rep_feedback && <div className="rep-feedback"><b>Rep feedback</b><p>{String(selected.rep_feedback)}</p></div>}
              {selected.recording_url && <a className="recording-link" href={String(selected.recording_url)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open recording</a>}
              {selected.transcript && <details className="transcript-detail"><summary>View transcript</summary><pre>{String(selected.transcript)}</pre></details>}
            </>
          ) : <p className="empty-copy">Select a call to review its coaching breakdown.</p>}
        </article>
      </div>
    </section>
  );
}

function EodReportPanel({ isDemo }: { isDemo: boolean }) {
  const [schema, setSchema] = useState<EodFormSchema>(() => cloneDefaultEodSchema());
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [answers, setAnswers] = useState<EodAnswers>(() => blankEodAnswers(DEFAULT_EOD_FORM_SCHEMA));
  const [history, setHistory] = useState<Row[]>(isDemo ? demoEods : []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo) {
      const nextSchema = cloneDefaultEodSchema();
      setSchema(nextSchema);
      setAnswers((current) => Object.keys(current).length ? current : blankEodAnswers(nextSchema));
      return;
    }
    if (!supabase) return;
    setBusy(true);
    try {
      const [workspace, reports] = await Promise.all([
        salesState(),
        supabase.from("sales_eod_reports").select("*").order("report_date", { ascending: false }).limit(60),
      ]);
      if (reports.error) throw reports.error;
      const nextSchema = normalizeEodSchema(workspace.settings?.eod_form_schema);
      const rows = reports.data ?? [];
      setSchema(nextSchema);
      setHistory(rows);
      const current = rows.find((row) => String(row.report_date) === reportDate);
      setAnswers(current ? eodAnswersFromRow(nextSchema, current) : blankEodAnswers(nextSchema));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The EOD report could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [isDemo, reportDate]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const submission = serializeEodAnswers(schema, answers);
    if (Number(answers.closes ?? 0) > Number(answers.calls_taken ?? 0)) {
      setNotice("Closes cannot exceed calls taken.");
      return;
    }
    if (isDemo) {
      setNotice("Demo EOD report saved.");
      return;
    }
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getSession();
    const userId = auth.session?.user.id;
    if (!userId) {
      setNotice("Sign in is required.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("sales_eod_reports").upsert(
      {
        user_id: userId,
        report_date: reportDate,
        ...submission.core,
        custom_answers: submission.customAnswers,
        submitted_via: "app",
      },
      { onConflict: "user_id,report_date" },
    );
    setBusy(false);
    if (error) setNotice(error.message);
    else {
      setNotice("End-of-day report saved.");
      await load();
    }
  }
  function edit(row: Row) {
    setReportDate(String(row.report_date));
    setAnswers(eodAnswersFromRow(schema, row));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  return (
    <section>
      <ModuleHeading
        eyebrow="EOD REPORT"
        title={schema.title}
        detail={schema.description || "Saving the same date updates that report."}
      />
      {notice && <p className="inline-notice">{notice}</p>}
      <article className="panel">
        <form className="form-stack flush" onSubmit={submit}>
          <div className="form-grid three">
            <label>
              Report date
              <input
                type="date"
                required
                value={reportDate}
                onChange={(event) => {
                  const nextDate = event.target.value;
                  setReportDate(nextDate);
                  const saved = history.find((row) => String(row.report_date) === nextDate);
                  setAnswers(saved ? eodAnswersFromRow(schema, saved) : blankEodAnswers(schema));
                }}
              />
            </label>
          </div>
          <EodDynamicFields
            schema={schema}
            answers={answers}
            onChange={(fieldId, value) => setAnswers((current) => ({ ...current, [fieldId]: value }))}
          />
          <button className="primary-btn" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Save size={16} />
            )}{" "}
            Save EOD report
          </button>
        </form>
      </article>
      <article className="panel eod-history">
        <div className="panel-head">
          <div>
            <span className="eyebrow">MY HISTORY</span>
            <h3>Saved reports</h3>
          </div>
          <strong>{history.length}</strong>
        </div>
        <div className="report-row header">
          <span>Date</span>
          <span>Mood</span>
          <span>Calls</span>
          <span>Connects</span>
          <span>Appts</span>
          <span>Closes</span>
          <span>Action</span>
        </div>
        {history.map((row) => (
          <div className="report-row" key={String(row.id)}>
            <span>{String(row.report_date)}</span>
            <span>{String(row.mood ?? "-")}</span>
            <span>{String(row.calls_taken ?? 0)}</span>
            <span>{String(row.connects ?? 0)}</span>
            <span>{String(row.appointments_set ?? 0)}</span>
            <span>{String(row.closes ?? 0)}</span>
            <span>
              <button className="table-action" onClick={() => edit(row)}>
                Edit
              </button>
            </span>
          </div>
        ))}
      </article>
    </section>
  );
}

type Weights = {
  closes: number;
  revenue: number;
  closeRate: number;
  appointments: number;
  quality: number;
  crm: number;
};
const defaultWeights: Weights = {
  closes: 25,
  revenue: 25,
  closeRate: 15,
  appointments: 15,
  quality: 10,
  crm: 10,
};

function EodDashboardPanel({ isDemo }: { isDemo: boolean }) {
  const [periodDays, setPeriodDays] = useState(7);
  const [roster, setRoster] = useState<Row[]>(isDemo ? demoRoster : []);
  const [daily, setDaily] = useState<Row[]>(isDemo ? demoEods : []);
  const [schema, setSchema] = useState<EodFormSchema>(() => cloneDefaultEodSchema());
  const [weights, setWeights] = useState<Weights>(defaultWeights);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo || !supabase) return;
    setBusy(true);
    setNotice("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "owner-dashboard",
        { body: { periodDays } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      setRoster(Array.isArray(data.roster) ? data.roster : []);
      setDaily(Array.isArray(data.daily) ? data.daily : []);
      setSchema(normalizeEodSchema(data.eodFormSchema));
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Owner dashboard could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }, [isDemo, periodDays]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  const board = useMemo(
    () => buildLeaderboard(roster, weights),
    [roster, weights],
  );
  const reportFields = useMemo(
    () => schema.sections.flatMap((section) => section.fields),
    [schema],
  );
  const leaders = [
    { label: "Revenue leader", metric: "reported_revenue", suffix: "cash" },
    { label: "Close leader", metric: "closes", suffix: "closes" },
    { label: "Call quality", metric: "average_score", suffix: "score" },
    { label: "Appointments", metric: "appointments_set", suffix: "set" },
    { label: "CRM discipline", metric: "crm_compliance", suffix: "%" },
  ].map((item) => ({
    ...item,
    row: [...roster].sort(
      (a, b) => Number(b[item.metric] ?? 0) - Number(a[item.metric] ?? 0),
    )[0],
  }));
  return (
    <section>
      <ModuleHeading
        eyebrow="EOD DASHBOARD & LEADERBOARD"
        title="Review the weighted team outcome."
        detail="Rank the team across closes, cash, call conversion, appointments, call quality, and CRM compliance. Adjust the weights to match the current operating priority."
        action={
          <label className="period-select">
            Showing
            <select
              value={periodDays}
              onChange={(e) => setPeriodDays(Number(e.target.value))}
            >
              <option value="1">24 hours</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
        }
      />
      {notice && <p className="inline-notice">{notice}</p>}
      <div className="leader-cards">
        {leaders.map((leader) => (
          <article key={leader.label}>
            <Medal size={16} />
            <small>{leader.label}</small>
            <b>{String(leader.row?.display_name ?? "-")}</b>
            <span>
              {leader.suffix === "cash"
                ? money(leader.row?.[leader.metric])
                : `${Number(leader.row?.[leader.metric] ?? 0).toFixed(leader.suffix === "%" ? 0 : 1)} ${leader.suffix}`}
            </span>
          </article>
        ))}
      </div>
      <article className="panel weight-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">RANKING WEIGHTS</span>
            <h3>What matters most right now?</h3>
          </div>
          <button onClick={() => setWeights(defaultWeights)}>Reset</button>
        </div>
        <div className="weight-grid">
          {(Object.keys(weights) as (keyof Weights)[]).map((key) => (
            <label key={key}>
              <span>
                <b>{key.replace(/([A-Z])/g, " $1")}</b>
                <small>{weights[key]}%</small>
              </span>
              <input
                type="range"
                min="0"
                max="50"
                step="5"
                value={weights[key]}
                onChange={(e) =>
                  setWeights((current) => ({
                    ...current,
                    [key]: Number(e.target.value),
                  }))
                }
              />
            </label>
          ))}
        </div>
      </article>
      <article className="panel leaderboard-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">WEIGHTED LEADERBOARD</span>
            <h3>Team rankings</h3>
          </div>
          {busy && <LoaderCircle className="spin" size={17} />}
        </div>
        <div className="leaderboard-row header">
          <span>Rank</span>
          <span>Rep</span>
          <span>Closes</span>
          <span>Cash</span>
          <span>Close %</span>
          <span>Appts</span>
          <span>Quality</span>
          <span>CRM</span>
          <span>Score</span>
        </div>
        {board.map((row, index) => (
          <div
            className={`leaderboard-row rank-${index + 1}`}
            key={String(row.member_user_id)}
          >
            <span>
              <b>#{index + 1}</b>
            </span>
            <span>
              <strong>
                {String(row.display_name ?? row.invited_email ?? "Team member")}
              </strong>
            </span>
            <span>{String(row.closes ?? 0)}</span>
            <span>{money(row.reported_revenue)}</span>
            <span>{Number(row.call_close_rate ?? 0).toFixed(1)}%</span>
            <span>{String(row.appointments_set ?? 0)}</span>
            <span>
              {row.average_score === null
                ? "-"
                : Number(row.average_score).toFixed(0)}
            </span>
            <span>
              {row.crm_compliance === null
                ? "-"
                : `${Number(row.crm_compliance).toFixed(0)}%`}
            </span>
            <span>
              <i>{Number(row.weightedScore).toFixed(1)}</i>
            </span>
          </div>
        ))}
        {!board.length && (
          <p className="empty-copy">
            No team reports are available for this period.
          </p>
        )}
      </article>
      <article className="panel eod-daily">
        <div className="panel-head">
          <div>
            <span className="eyebrow">TEAM EOD FEED</span>
            <h3>Wins, blockers, and next moves</h3>
          </div>
          <ClipboardCheck size={18} />
        </div>
        {daily.slice(0, 20).map((row) => (
          <details key={String(row.id)}>
            <summary>
              <span>
                <b>{String(row.display_name ?? "Team member")}</b>
                <small>
                  {String(row.report_date)} - {String(row.mood ?? "no mood")}
                </small>
              </span>
              <strong>{money(row.revenue)}</strong>
            </summary>
            <div className="eod-answer-grid">
              {reportFields.map((field) => {
                const custom = row.custom_answers && typeof row.custom_answers === "object"
                  ? row.custom_answers as Row
                  : {};
                const raw = isCoreEodField(field.id) ? row[field.id] : custom[field.id];
                if (raw === "" || raw === null || raw === undefined) return null;
                const value = field.type === "checkbox"
                  ? raw ? "Yes" : "No"
                  : field.type === "currency"
                    ? money(raw)
                    : String(raw);
                return <p key={field.id}><b>{field.label}:</b> {value}</p>;
              })}
            </div>
          </details>
        ))}
      </article>
    </section>
  );
}

function AppointmentsPanel({ isDemo }: { isDemo: boolean }) {
  const [rows, setRows] = useState<Row[]>(isDemo ? demoAppointments : []);
  const [selected, setSelected] = useState<Row | null>(
    isDemo ? demoAppointments[0] : null,
  );
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo || !supabase) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("sales_appointments")
      .select("*")
      .order("scheduled_at", { ascending: false })
      .limit(200);
    setBusy(false);
    if (error) setNotice(error.message);
    else {
      setRows(data ?? []);
      setSelected((current) => current ?? data?.[0] ?? null);
    }
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  async function sync() {
    if (isDemo) {
      setNotice("Demo GoHighLevel appointments refreshed.");
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("ghl-proxy", {
      body: { action: "syncAll" },
    });
    setBusy(false);
    if (error || data?.error) setNotice(error?.message ?? String(data.error));
    else {
      setNotice(`Synced ${data?.appointments?.saved ?? 0} appointments.`);
      await load();
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (isDemo) {
      setNotice("Demo appointment outcome saved.");
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase
      .from("sales_appointments")
      .update({
        status: values.status,
        outcome: values.outcome,
        revenue: Number(values.revenue),
        call_summary: values.call_summary,
        objections: values.objections,
        next_steps: values.next_steps,
        follow_up_at: values.follow_up_at || null,
        outcome_reported_at: new Date().toISOString(),
        client_transition_required: values.outcome === "won",
      })
      .eq("id", selected.id);
    setBusy(false);
    if (error) setNotice(error.message);
    else {
      setNotice("Appointment outcome and next step saved.");
      await load();
    }
  }
  const visible =
    filter === "all"
      ? rows
      : rows.filter(
          (row) =>
            String(row.status) === filter || String(row.outcome) === filter,
        );
  return (
    <section>
      <ModuleHeading
        eyebrow="APPOINTMENTS"
        title="Resolve every booking outcome."
        detail="Sync GoHighLevel appointments, assign outcomes, capture objections and revenue, and leave every record with a dated next step."
        action={
          <button
            className="small-primary"
            disabled={busy}
            onClick={() => void sync()}
          >
            <RefreshCw className={busy ? "spin" : ""} size={14} /> Sync GHL
          </button>
        }
      />
      {notice && <p className="inline-notice">{notice}</p>}
      <div className="appointment-toolbar">
        <label>
          Filter
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="booked">Booked</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="no_show">No-show</option>
          </select>
        </label>
        <span>{visible.length} records</span>
      </div>
      <div className="appointment-layout">
        <article className="panel appointment-list">
          {visible.map((row) => (
            <button
              className={selected?.id === row.id ? "active" : ""}
              key={String(row.id)}
              onClick={() => setSelected(row)}
            >
              <span>
                <b>{String(row.prospect_name ?? "Appointment")}</b>
                <small>
                  {new Date(String(row.scheduled_at)).toLocaleString()} -{" "}
                  {String(row.assigned_user_name ?? "Unassigned")}
                </small>
              </span>
              <i className={`outcome ${String(row.outcome)}`}>
                {String(row.outcome ?? row.status)}
              </i>
            </button>
          ))}
          {!visible.length && (
            <p className="empty-copy">No appointments match this filter.</p>
          )}
        </article>
        <article className="panel appointment-detail">
          {selected ? (
            <form
              className="form-stack flush"
              key={String(selected.updated_at ?? selected.id)}
              onSubmit={save}
            >
              <div className="appointment-person">
                <CalendarDays size={18} />
                <span>
                  <b>{String(selected.prospect_name ?? "Appointment")}</b>
                  <small>
                    {String(
                      selected.prospect_email ??
                        selected.prospect_phone ??
                        "No contact detail",
                    )}
                  </small>
                </span>
              </div>
              <div className="form-grid">
                <label>
                  Status
                  <select
                    name="status"
                    defaultValue={String(selected.status ?? "booked")}
                  >
                    <option value="booked">Booked</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="no_show">No-show</option>
                  </select>
                </label>
                <label>
                  Outcome
                  <select
                    name="outcome"
                    defaultValue={String(selected.outcome ?? "pending")}
                  >
                    <option value="pending">Pending</option>
                    <option value="follow_up">Follow-up</option>
                    <option value="won">Won</option>
                    <option value="lost">Lost</option>
                    <option value="no_show">No-show</option>
                  </select>
                </label>
                <label>
                  Revenue
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    name="revenue"
                    defaultValue={Number(selected.revenue ?? 0)}
                  />
                </label>
                <label>
                  Follow-up date
                  <input
                    type="datetime-local"
                    name="follow_up_at"
                    defaultValue={
                      selected.follow_up_at
                        ? String(selected.follow_up_at).slice(0, 16)
                        : ""
                    }
                  />
                </label>
              </div>
              <label>
                Call summary
                <textarea
                  name="call_summary"
                  defaultValue={String(selected.call_summary ?? "")}
                />
              </label>
              <label>
                Objections
                <textarea
                  name="objections"
                  defaultValue={String(selected.objections ?? "")}
                />
              </label>
              <label>
                Next steps
                <textarea
                  name="next_steps"
                  defaultValue={String(selected.next_steps ?? "")}
                />
              </label>
              <button className="primary-btn" disabled={busy}>
                <Save size={15} /> Save outcome
              </button>
            </form>
          ) : (
            <p className="empty-copy">
              Select an appointment to update its outcome.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}

function ModuleHeading({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="module-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {action}
    </div>
  );
}

function ResultList({ title, values }: { title: string; values: unknown }) {
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) return null;
  return (
    <div className="grade-result-list">
      <b>{title}</b>
      <ul>
        {rows.map((value, index) => (
          <li key={index}>{String(value)}</li>
        ))}
      </ul>
    </div>
  );
}

function SimpleMarkdown({ body }: { body: string }) {
  return (
    <div className="simple-markdown">
      {body.split("\n").map((line, index) =>
        line.startsWith("### ") ? (
          <h4 key={index}>{line.slice(4)}</h4>
        ) : line.startsWith("## ") ? (
          <h3 key={index}>{line.slice(3)}</h3>
        ) : line.startsWith("# ") ? (
          <h2 key={index}>{line.slice(2)}</h2>
        ) : line.startsWith("- ") ? (
          <p className="bullet" key={index}>
            {line.slice(2)}
          </p>
        ) : line ? (
          <p key={index}>{line}</p>
        ) : (
          <br key={index} />
        ),
      )}
    </div>
  );
}

function average(values: unknown[]) {
  const numbers = values
    .filter((value) => value !== null && value !== undefined)
    .map(Number)
    .filter(Number.isFinite);
  return numbers.length
    ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    : null;
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function buildLeaderboard(roster: Row[], weights: Weights) {
  const metrics: { key: keyof Weights; field: string }[] = [
    { key: "closes", field: "closes" },
    { key: "revenue", field: "reported_revenue" },
    { key: "closeRate", field: "call_close_rate" },
    { key: "appointments", field: "appointments_set" },
    { key: "quality", field: "average_score" },
    { key: "crm", field: "crm_compliance" },
  ];
  const totalWeight =
    Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  const ranks = new Map<string, Record<string, number>>();
  for (const metric of metrics) {
    [...roster]
      .sort(
        (a, b) => Number(b[metric.field] ?? 0) - Number(a[metric.field] ?? 0),
      )
      .forEach((row, index) => {
        const id = String(row.member_user_id);
        ranks.set(id, { ...(ranks.get(id) ?? {}), [metric.key]: index + 1 });
      });
  }
  return roster
    .map((row) => {
      const rowRanks = ranks.get(String(row.member_user_id)) ?? {};
      const weightedRank =
        metrics.reduce(
          (sum, metric) =>
            sum +
            Number(rowRanks[metric.key] ?? roster.length) * weights[metric.key],
          0,
        ) / totalWeight;
      const weightedScore =
        roster.length <= 1
          ? 100
          : Math.max(0, 100 - ((weightedRank - 1) / (roster.length - 1)) * 100);
      return { ...row, weightedScore };
    })
    .sort((a, b) => Number(b.weightedScore) - Number(a.weightedScore));
}
