"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Bot,
  Check,
  Clipboard,
  CloudCog,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { supabase, supabaseProjectUrl } from "@/lib/supabase";

export type SalesModule = "pipeline" | "charles" | "team" | "sales-settings";
type Connection = {
  provider: string;
  status: string;
  account_name?: string;
  metadata?: Record<string, unknown>;
};
type IntegrationState = {
  membership?: { role?: string };
  settings?: Record<string, unknown>;
  connections?: Connection[];
  webhook?: { token?: string };
};
type OwnerDashboard = {
  ok?: boolean;
  totals?: Record<string, unknown>;
  roster?: Record<string, unknown>[];
  coaching?: Record<string, unknown> | null;
};

const demoAppointments = [
  {
    id: "ap1",
    prospect_name: "Harbor Dental",
    scheduled_at: "2026-09-14T15:00:00Z",
    status: "confirmed",
    assigned_user_name: "Maya Chen",
  },
  {
    id: "ap2",
    prospect_name: "Summit HVAC",
    scheduled_at: "2026-09-15T17:30:00Z",
    status: "booked",
    assigned_user_name: "Jon Bell",
  },
];
const demoOpportunities = [
  {
    id: "op1",
    name: "Harbor Dental - Growth Plan",
    status: "open",
    monetary_value: 12500,
    last_activity_at: "2026-09-13T11:00:00Z",
  },
  {
    id: "op2",
    name: "Summit HVAC - Retainer",
    status: "open",
    monetary_value: 8400,
    last_activity_at: "2026-09-11T08:20:00Z",
  },
];
const demoGrades = [
  {
    id: "g1",
    title: "Northstar Dental discovery",
    rep_name: "Maya Chen",
    overall_score: 92,
    script_adherence_pct: 88,
    coaching_notes: "Strong discovery. Tighten the dated next step.",
    graded_at: "2026-09-13T10:00:00Z",
  },
];

export function SalesManagerModule({
  module,
  isDemo,
}: {
  module: SalesModule;
  isDemo: boolean;
}) {
  if (module === "pipeline") return <PipelinePanel isDemo={isDemo} />;
  if (module === "charles") return <CharlesPanel isDemo={isDemo} />;
  if (module === "team") return <TeamPanel isDemo={isDemo} />;
  return <SalesSettingsPanel isDemo={isDemo} />;
}

function PipelinePanel({ isDemo }: { isDemo: boolean }) {
  const [appointments, setAppointments] = useState<Record<string, unknown>[]>(
    isDemo ? demoAppointments : [],
  );
  const [opportunities, setOpportunities] = useState<Record<string, unknown>[]>(
    isDemo ? demoOpportunities : [],
  );
  const [grades, setGrades] = useState<Record<string, unknown>[]>(
    isDemo ? demoGrades : [],
  );
  const [contacts, setContacts] = useState<Record<string, unknown>[]>([]);
  const [references, setReferences] = useState<Record<string, unknown>[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo || !supabase) return;
    const [a, o, g, c, r] = await Promise.all([
      supabase
        .from("sales_appointments")
        .select("*")
        .order("scheduled_at", { ascending: false })
        .limit(100),
      supabase
        .from("sales_opportunities")
        .select("*")
        .order("last_activity_at", { ascending: false })
        .limit(100),
      supabase
        .from("sales_call_gradings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("sales_ghl_contacts").select("*").order("score", { ascending: false }).limit(50),
      supabase.from("sales_ghl_reference").select("*").order("kind").limit(200),
    ]);
    if (a.data) setAppointments(a.data);
    if (o.data) setOpportunities(o.data);
    if (g.data) setGrades(g.data);
    if (c.data) setContacts(c.data);
    if (r.data) setReferences(r.data);
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  async function sync() {
    if (isDemo) {
      setNotice("Demo GoHighLevel sync completed.");
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("ghl-proxy", {
      body: { action: "syncAll" },
    });
    setBusy(false);
    setNotice(
      error
        ? error.message
        : `Synced ${data?.appointments?.saved ?? 0} appointments, ${data?.opportunities?.saved ?? data?.opportunities?.received ?? 0} opportunities, and ${data?.intelligence?.contacts ?? 0} contacts.`,
    );
    if (!error) await load();
  }
  async function grade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (isDemo) {
      setNotice("Demo transcript graded: 86/100.");
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("grade-call", {
      body: {
        title: values.get("title"),
        transcript: values.get("transcript"),
      },
    });
    setBusy(false);
    setNotice(
      error ? error.message : "Call graded and added to coaching history.",
    );
    if (!error) {
      event.currentTarget.reset();
      await load();
    }
  }
  return (
    <section>
      <ModuleHeading
        eyebrow="GHL SALES OS"
        title="Pipeline, appointments, and call intelligence."
        detail="Sync GoHighLevel, ingest call recordings, and turn every transcript into a coaching score."
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
      <div className="ops-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">APPOINTMENTS</span>
              <h3>Upcoming and recent</h3>
            </div>
            <strong>{appointments.length}</strong>
          </div>
          <div className="stack-list">
            {appointments.slice(0, 8).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <b>{String(row.prospect_name ?? "Appointment")}</b>
                  <small>
                    {new Date(String(row.scheduled_at)).toLocaleString()} ·{" "}
                    {String(row.assigned_user_name ?? "Unassigned")}
                  </small>
                </span>
                <i>{String(row.status ?? "booked")}</i>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">PIPELINE</span>
              <h3>Open opportunities</h3>
            </div>
            <strong>{opportunities.length}</strong>
          </div>
          <div className="stack-list">
            {opportunities.slice(0, 8).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <b>{String(row.name)}</b>
                  <small>
                    Last activity{" "}
                    {row.last_activity_at
                      ? new Date(
                          String(row.last_activity_at),
                        ).toLocaleDateString()
                      : "unknown"}
                  </small>
                </span>
                <i>${Number(row.monetary_value ?? 0).toLocaleString()}</i>
              </div>
            ))}
          </div>
        </article>
      </div>
      <div className="ops-grid">
        <article className="panel"><div className="panel-head"><div><span className="eyebrow">CONTACT INTELLIGENCE</span><h3>Highest-priority contacts</h3></div><strong>{contacts.length}</strong></div><div className="stack-list">{contacts.slice(0, 8).map((row) => <div key={String(row.id)}><span><b>{String(row.name ?? row.email ?? row.phone ?? "Contact")}</b><small>{String(row.source ?? "Unknown source")} · {row.last_activity_at ? new Date(String(row.last_activity_at)).toLocaleDateString() : "No activity"}</small></span><i>{Number(row.score ?? 0).toFixed(0)} score</i></div>)}</div></article>
        <article className="panel"><div className="panel-head"><div><span className="eyebrow">GHL CONFIGURATION</span><h3>Users, calendars, pipelines & stages</h3></div><strong>{references.length}</strong></div><div className="stack-list">{["user", "calendar", "pipeline", "stage"].map((kind) => <div key={kind}><span><b>{kind[0].toUpperCase() + kind.slice(1)}s</b><small>{references.filter((row) => row.kind === kind).slice(0, 3).map((row) => row.name).join(" · ") || "None synced"}</small></span><i>{references.filter((row) => row.kind === kind).length}</i></div>)}</div></article>
      </div>
      <section className="panel grading-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">CALL GRADING</span>
            <h3>Coach from the actual conversation</h3>
          </div>
          <ShieldCheck size={19} />
        </div>
        <form className="grade-form" onSubmit={grade}>
          <input required name="title" placeholder="Call title" />
          <textarea
            required
            minLength={40}
            name="transcript"
            placeholder="Paste a transcript, or use the GHL/Fathom webhook for automatic grading."
          />
          <button className="primary-btn" disabled={busy}>
            Grade call
          </button>
        </form>
        <div className="grade-grid">
          {grades.slice(0, 6).map((row) => (
            <article key={String(row.id)}>
              <strong>{Number(row.overall_score ?? 0).toFixed(0)}</strong>
              <span>
                <b>{String(row.title ?? "Sales call")}</b>
                <small>
                  {String(row.rep_name ?? "Rep")} ·{" "}
                  {Number(row.script_adherence_pct ?? 0).toFixed(0)}% adherence
                </small>
                <p>
                  {String(row.coaching_notes ?? "Awaiting coaching notes.")}
                </p>
              </span>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function CharlesPanel({ isDemo }: { isDemo: boolean }) {
  const [messages, setMessages] = useState<Record<string, unknown>[]>(
    isDemo
      ? [
          {
            id: "welcome",
            role: "assistant",
            content:
              "I am Charles. Ask me about calls, pipeline, objections, appointments, team execution, or the next revenue move.",
          },
        ]
      : [],
  );
  const [memories, setMemories] = useState<Record<string, unknown>[]>(
    isDemo
      ? [
          {
            id: "m1",
            kind: "coaching",
            content: "The team responds best to specific, dated next actions.",
          },
        ]
      : [],
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (isDemo || !supabase) return;
    const [m, mem] = await Promise.all([
      supabase
        .from("charles_messages")
        .select("*")
        .order("created_at")
        .limit(100),
      supabase
        .from("charles_memories")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (m.data) setMessages(m.data);
    if (mem.data) setMemories(mem.data);
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message) return;
    setInput("");
    if (isDemo) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: message },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Focus the next coaching block on objection handling, then make every open deal carry an owner and a dated next step.",
        },
      ]);
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("charles-chat", {
      body: { message },
    });
    setBusy(false);
    if (error)
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: error.message },
      ]);
    else await load();
  }
  async function forget(id: unknown) {
    if (isDemo) { setMemories((current) => current.filter((row) => row.id !== id)); return; }
    if (!supabase) return;
    const { error } = await supabase.from("charles_memories").delete().eq("id", id);
    if (!error) await load();
  }
  return (
    <section>
      <ModuleHeading
        eyebrow="CHARLES AI"
        title="Your sales operating partner."
        detail="Charles remembers durable context and answers from calls, CRM opportunities, appointments, EOD reports, and your playbooks."
      />
      <div className="charles-layout">
        <article className="panel chat-panel">
          <div className="chat-stream">
            {messages.map((row, index) => (
              <div
                className={`chat-message ${row.role}`}
                key={String(row.id ?? index)}
              >
                <span>
                  {row.role === "assistant" ? <Bot size={16} /> : "You"}
                </span>
                <p>{String(row.content)}</p>
              </div>
            ))}
          </div>
          <form className="chat-composer" onSubmit={send}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask Charles what needs attention, or say ‘remember…’ to save context."
            />
            <button className="primary-btn" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Send size={16} />
              )}{" "}
              Send
            </button>
          </form>
        </article>
        <aside className="panel memory-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">MEMORY</span>
              <h3>What Charles retains</h3>
            </div>
            <Sparkles size={18} />
          </div>
          {memories.length ? (
            memories.map((row) => (
              <div className="memory-item" key={String(row.id)}>
                <small>{String(row.kind ?? "context")}</small>
                <p>{String(row.content)}</p>
                <button className="danger-link" onClick={() => void forget(row.id)}>Forget</button>
              </div>
            ))
          ) : (
            <p className="empty-copy">
              Tell Charles “remember…” to save durable context.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

function TeamPanel({ isDemo }: { isDemo: boolean }) {
  const [members, setMembers] = useState<Record<string, unknown>[]>(
    isDemo
      ? [
          {
            member_user_id: "owner",
            role: "owner",
            is_active: true,
            display_name: "Maya Chen",
            email: "maya@example.com",
            eod_url: "https://app.example/eod/demo",
          },
          {
            member_user_id: "rep",
            role: "sales_rep",
            is_active: true,
            display_name: "Jon Bell",
            email: "jon@example.com",
            eod_url: "https://app.example/eod/demo-rep",
          },
        ]
      : [],
  );
  const [dashboard, setDashboard] = useState<OwnerDashboard | null>(
    isDemo
      ? {
          totals: {
            calls: 18,
            wins: 5,
            revenue: 37400,
            appointments: 12,
            eod_reports: 9,
          },
          roster: [],
        }
      : null,
  );
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (isDemo || !supabase) return;
    const [team, owner] = await Promise.all([
      supabase.functions.invoke("team-manager", { body: { action: "list" } }),
      supabase.functions.invoke("owner-dashboard", { body: {} }),
    ]);
    if (team.data?.members) setMembers(team.data.members);
    if (owner.data?.ok) setDashboard(owner.data);
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (isDemo) {
      setNotice("Demo invitation prepared.");
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("team-manager", {
      body: {
        action: "invite",
        email: values.get("email"),
        name: values.get("name"),
        role: values.get("role"),
        managerUserId: values.get("managerUserId") || null,
        slackUserId: values.get("slackUserId") || null,
      },
    });
    setBusy(false);
    setNotice(error ? error.message : "Team member invited and assigned.");
    if (!error) {
      event.currentTarget.reset();
      await load();
    }
  }
  async function toggle(member: Record<string, unknown>) {
    if (isDemo || !supabase) {
      setNotice("Demo team status updated.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.functions.invoke("team-manager", {
      body: {
        action: member.is_active ? "deactivate" : "reactivate",
        memberUserId: member.member_user_id,
      },
    });
    setBusy(false);
    setNotice(error ? error.message : "Team status updated.");
    if (!error) await load();
  }
  return (
    <section>
      <ModuleHeading
        eyebrow="OWNER COMMAND"
        title="Coach the team from one operating view."
        detail="Invite reps, distribute private EOD links, and review seven-day execution and coaching signals."
      />
      {dashboard?.totals && (
        <div className="metrics-grid compact-metrics">
          {Object.entries(dashboard.totals).map(([key, value]) => (
            <article className="metric-card" key={key}>
              <span>{key.replaceAll("_", " ")}</span>
              <strong>
                {key === "revenue"
                  ? `$${Number(value).toLocaleString()}`
                  : String(value)}
              </strong>
            </article>
          ))}
        </div>
      )}
      <div className="ops-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">TEAM</span>
              <h3>Members and EOD access</h3>
            </div>
            <strong>{members.length}</strong>
          </div>
          {notice && <p className="inline-notice">{notice}</p>}
          <div className="team-list">
            {members.map((row) => (
              <div key={String(row.member_user_id)}>
                <span>
                  <b>{String(row.display_name ?? row.email ?? "Member")}</b>
                  <small>
                    {String(row.role)} · {row.is_active ? "active" : "inactive"}
                  </small>
                </span>
                <div>
                  {row.eod_url && (
                    <button
                      title="Copy EOD link"
                      onClick={() =>
                        void navigator.clipboard.writeText(String(row.eod_url))
                      }
                    >
                      <Clipboard size={14} />
                    </button>
                  )}
                  {row.role !== "owner" && (
                    <button disabled={busy} onClick={() => void toggle(row)}>
                      {row.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">ADD A TEAM MEMBER</span>
              <h3>Invite and assign</h3>
            </div>
            <UserPlus size={18} />
          </div>
          <form className="form-stack" onSubmit={invite}>
            <label>
              Name
              <input name="name" placeholder="Sales rep name" />
            </label>
            <label>
              Email
              <input
                required
                type="email"
                name="email"
                placeholder="rep@company.com"
              />
            </label>
            <label>Role<select name="role" defaultValue="sales_rep"><option value="sales_rep">Sales rep</option><option value="sales_manager">Sales manager</option><option value="support">Support</option></select></label>
            <label>Reports to<select name="managerUserId" defaultValue=""><option value="">Account owner</option>{members.filter((member) => member.role === "sales_manager" && member.is_active).map((manager) => <option key={String(manager.member_user_id)} value={String(manager.member_user_id)}>{String(manager.display_name ?? manager.email)}</option>)}</select></label>
            <label>Slack member ID<input name="slackUserId" placeholder="U0123456789 (optional)" /></label>
            <button className="primary-btn" disabled={busy}>
              Send invitation
            </button>
          </form>
        </article>
      </div>
      {dashboard?.roster?.length > 0 && (
        <article className="panel roster-panel">
          <div className="data-table">
            <div className="data-row header">
              <span>Rep</span>
              <span>Calls</span>
              <span>Wins</span>
              <span>Revenue</span>
              <span>Score</span>
              <span>CRM</span>
            </div>
            {dashboard.roster.map((row: Record<string, unknown>) => (
              <div className="data-row" key={String(row.member_user_id)}>
                <span>
                  <b>
                    {String(row.display_name ?? row.invited_email ?? "Rep")}
                  </b>
                </span>
                <span>{String(row.calls)}</span>
                <span>{String(row.wins)}</span>
                <span>${Number(row.revenue ?? 0).toLocaleString()}</span>
                <span>
                  {row.average_score
                    ? Number(row.average_score).toFixed(0)
                    : "—"}
                </span>
                <span>
                  {row.crm_compliance !== null ? `${row.crm_compliance}%` : "—"}
                </span>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

function SalesSettingsPanel({ isDemo }: { isDemo: boolean }) {
  const [state, setState] = useState<IntegrationState>({
    settings: { autopilot_enabled: true },
    connections: [
      {
        provider: "ghl",
        status: "connected",
        account_name: "Acme Growth Location",
      },
      {
        provider: "ai",
        status: "connected",
        account_name: "OpenAI",
        metadata: { model: "gpt-5-mini", last4: "demo" },
      },
      {
        provider: "fathom",
        status: "connected",
        account_name: "Fathom webhook",
      },
    ],
    webhook: { token: "demo-token" },
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo || !supabase) return;
    const { data, error } = await supabase.functions.invoke(
      "sales-integrations",
      { body: { action: "state" } },
    );
    if (error) setNotice(error.message);
    else setState(data);
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  async function invoke(body: Record<string, unknown>, success: string) {
    if (isDemo) {
      setNotice(`Demo: ${success}`);
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("sales-integrations", {
      body,
    });
    setBusy(false);
    setNotice(error ? error.message : success);
    if (!error) await load();
  }
  async function saveGhl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await invoke(
      {
        action: "saveGhl",
        pit: values.get("pit"),
        locationId: values.get("locationId"),
      },
      "GoHighLevel connected.",
    );
    if (!isDemo) event.currentTarget.reset();
  }
  async function saveAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await invoke(
      {
        action: "saveAi",
        provider: values.get("provider"),
        model: values.get("model"),
        apiKey: values.get("apiKey"),
      },
      "AI provider connected.",
    );
    if (!isDemo) event.currentTarget.reset();
  }
  async function saveFathom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await invoke(
      {
        action: "saveFathom",
        webhookSecret: values.get("webhookSecret"),
      },
      "Fathom webhook signature connected.",
    );
    if (!isDemo) event.currentTarget.reset();
  }
  async function saveSlack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await invoke({ action: "saveSlack", botToken: values.get("botToken"), channel: values.get("channel") }, "Slack connected for rep reminders and escalations.");
    if (!isDemo) event.currentTarget.reset();
  }
  async function saveOperatingSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await invoke(
      {
        action: "saveSettings",
        instructions: values.get("instructions"),
        soul: values.get("soul"),
        timezone: values.get("timezone"),
        daily_appointment_target: Number(
          values.get("daily_appointment_target"),
        ),
        crm_stuck_days: Number(values.get("crm_stuck_days")),
        crm_wait_minutes: Number(values.get("crm_wait_minutes")),
        eod_link_send_time: values.get("eod_link_send_time"),
        eod_link_template: values.get("eod_link_template"),
        delivery_channel: values.get("delivery_channel"),
        command_report_send_time: values.get("command_report_send_time"),
        disposition_due_minutes: Number(values.get("disposition_due_minutes")),
      },
      "Charles operating instructions saved.",
    );
  }
  async function toggleMode(mode: string, enabled: boolean) {
    const current =
      state.settings?.autopilot_functions &&
      typeof state.settings.autopilot_functions === "object"
        ? (state.settings.autopilot_functions as Record<string, boolean>)
        : {};
    const autopilotFunctions = { ...current, [mode]: enabled };
    setState((value) => ({
      ...value,
      settings: { ...value.settings, autopilot_functions: autopilotFunctions },
    }));
    await invoke(
      { action: "saveSettings", autopilot_functions: autopilotFunctions },
      `${mode} ${enabled ? "enabled" : "disabled"}.`,
    );
  }
  const ghl = state.connections?.find((row) => row.provider === "ghl");
  const ai = state.connections?.find((row) => row.provider === "ai");
  const fathom = state.connections?.find((row) => row.provider === "fathom");
  const slack = state.connections?.find((row) => row.provider === "slack");
  const token = state.webhook?.token ?? "";
  const base = supabaseProjectUrl
    ? `${supabaseProjectUrl}/functions/v1`
    : "https://YOUR_PROJECT_REF.supabase.co/functions/v1";
  return (
    <section>
      <ModuleHeading
        eyebrow="SALES MANAGER SETUP"
        title="Connect Charles to the operating system."
        detail="Credentials are encrypted server-side. Sales reps inherit the owner’s provider connections without seeing the secrets."
      />
      {notice && <p className="inline-notice">{notice}</p>}
      <div className="ops-grid">
        <article className="panel integration-form">
          <StatusLine
            icon={<CloudCog size={18} />}
            name="GoHighLevel"
            connected={ghl?.status === "connected"}
            detail={
              ghl?.account_name ?? "Private Integration Token + Location ID"
            }
          />
          <form className="form-stack" onSubmit={saveGhl}>
            <label>
              Location ID
              <input required name="locationId" />
            </label>
            <label>
              Private Integration Token
              <input required type="password" name="pit" />
            </label>
            <button className="primary-btn" disabled={busy}>
              {ghl ? "Update GHL" : "Connect GHL"}
            </button>
            {ghl && (
              <button
                type="button"
                className="danger-link"
                onClick={() =>
                  void invoke(
                    { action: "disconnectGhl" },
                    "GoHighLevel disconnected.",
                  )
                }
              >
                Disconnect
              </button>
            )}
          </form>
        </article>
        <article className="panel integration-form">
          <StatusLine icon={<MessageSquareText size={18} />} name="Slack delivery" connected={slack?.status === "connected"} detail={slack ? `${slack.account_name} · channel ${String(slack.metadata?.channel ?? "")}` : "Optional bot delivery for direct rep reminders and owner escalation"} />
          <form className="form-stack" onSubmit={saveSlack}>
            <label>Bot token<input required type="password" name="botToken" placeholder="xoxb-..." /></label>
            <label>Default channel ID<input required name="channel" placeholder="C0123456789" /></label>
            <button className="primary-btn" disabled={busy}>{slack ? "Update Slack" : "Connect Slack"}</button>
            {slack && <button type="button" className="danger-link" onClick={() => void invoke({ action: "removeSlack" }, "Slack disconnected.")}>Remove</button>}
          </form>
        </article>
        <article className="panel integration-form">
          <StatusLine
            icon={<Sparkles size={18} />}
            name="Charles AI provider"
            connected={ai?.status === "connected"}
            detail={
              ai
                ? `${ai.account_name} · ${String(ai.metadata?.model ?? "")}`
                : "OpenAI or GLM / Z.ai"
            }
          />
          <form className="form-stack" onSubmit={saveAi}>
            <label>
              Provider
              <select name="provider">
                <option value="openai">OpenAI</option>
                <option value="glm">GLM / Z.ai</option>
              </select>
            </label>
            <label>
              Model
              <input required name="model" defaultValue="gpt-5-mini" />
            </label>
            <label>
              API key
              <input required type="password" name="apiKey" />
            </label>
            <button className="primary-btn" disabled={busy}>
              {ai ? "Update AI provider" : "Connect AI provider"}
            </button>
            {ai && (
              <button
                type="button"
                className="danger-link"
                onClick={() =>
                  void invoke({ action: "removeAi" }, "AI provider removed.")
                }
              >
                Remove
              </button>
            )}
          </form>
        </article>
        <article className="panel integration-form">
          <StatusLine
            icon={<ShieldCheck size={18} />}
            name="Fathom webhook"
            connected={fathom?.status === "connected"}
            detail={
              fathom
                ? "Signed meeting transcripts"
                : "Add the whsec_ secret issued by Fathom"
            }
          />
          <form className="form-stack" onSubmit={saveFathom}>
            <label>
              Webhook signing secret
              <input
                required
                type="password"
                name="webhookSecret"
                placeholder="whsec_..."
              />
            </label>
            <button className="primary-btn" disabled={busy}>
              {fathom ? "Update Fathom secret" : "Secure Fathom webhook"}
            </button>
            {fathom && (
              <button
                type="button"
                className="danger-link"
                onClick={() =>
                  void invoke(
                    { action: "removeFathom" },
                    "Fathom signature removed.",
                  )
                }
              >
                Remove
              </button>
            )}
          </form>
        </article>
      </div>
      <article className="panel operating-settings">
        <div className="panel-head">
          <div>
            <span className="eyebrow">INSTRUCTIONS &amp; SOUL</span>
            <h3>How Charles should run sales</h3>
          </div>
          <Bot size={18} />
        </div>
        <form
          className="form-stack"
          onSubmit={saveOperatingSettings}
          key={String(state.settings?.updated_at ?? "settings")}
        >
          <label>
            Operating instructions
            <textarea
              name="instructions"
              defaultValue={String(state.settings?.instructions ?? "")}
              placeholder="Your offer, sales process, qualification rules, escalation rules, and coaching priorities."
            />
          </label>
          <label>
            Charles personality
            <textarea
              name="soul"
              defaultValue={String(state.settings?.soul ?? "")}
              placeholder="Direct, calm, analytical, demanding…"
            />
          </label>
          <div className="form-grid three">
            <label>
              Timezone
              <input
                name="timezone"
                defaultValue={String(
                  state.settings?.timezone ?? "America/Chicago",
                )}
              />
            </label>
            <label>
              Daily appointment target
              <input
                name="daily_appointment_target"
                type="number"
                min="0"
                defaultValue={Number(
                  state.settings?.daily_appointment_target ?? 8,
                )}
              />
            </label>
            <label>
              Stuck deal days
              <input
                name="crm_stuck_days"
                type="number"
                min="1"
                defaultValue={Number(state.settings?.crm_stuck_days ?? 7)}
              />
            </label>
            <label>
              Lead wait minutes
              <input
                name="crm_wait_minutes"
                type="number"
                min="1"
                defaultValue={Number(state.settings?.crm_wait_minutes ?? 15)}
              />
            </label>
            <label>
              EOD send time
              <input
                name="eod_link_send_time"
                type="time"
                defaultValue={String(
                  state.settings?.eod_link_send_time ?? "16:00",
                ).slice(0, 5)}
              />
            </label>
            <label>Command report time<input name="command_report_send_time" type="time" defaultValue={String(state.settings?.command_report_send_time ?? "17:30").slice(0, 5)} /></label>
            <label>Disposition due minutes<input name="disposition_due_minutes" type="number" min="1" max="1440" defaultValue={Number(state.settings?.disposition_due_minutes ?? 10)} /></label>
            <label>Delivery channel<select name="delivery_channel" defaultValue={String(state.settings?.delivery_channel ?? "clickup")}><option value="clickup">ClickUp</option><option value="slack">Slack with ClickUp fallback</option><option value="both">Slack and ClickUp</option></select></label>
          </div>
          <label>
            EOD task template
            <input
              name="eod_link_template"
              defaultValue={String(
                state.settings?.eod_link_template ??
                  "Please complete today's EOD report: {url}",
              )}
            />
          </label>
          <button className="primary-btn" disabled={busy}>
            Save instructions
          </button>
        </form>
      </article>
      <article className="panel autopilot-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">AUTOPILOT</span>
            <h3>Thirteen recurring Charles workflows</h3>
          </div>
          <label className="switch-line">
            <input
              type="checkbox"
              checked={Boolean(state.settings?.autopilot_enabled)}
              onChange={(event) => {
                setState((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    autopilot_enabled: event.target.checked,
                  },
                }));
                void invoke(
                  {
                    action: "saveSettings",
                    autopilot_enabled: event.target.checked,
                  },
                  event.target.checked
                    ? "Autopilot enabled."
                    : "Autopilot paused.",
                );
              }}
            />{" "}
            Enabled
          </label>
        </div>
        <div className="autopilot-grid">
          {[
            "scan",
            "dropball",
            "crm",
            "morale",
            "leadsdigest",
            "briefing",
            "eodEnforce",
            "eodLink",
            "coaching",
            "appointments",
            "accountability",
            "commandReport",
            "transition",
          ].map((item) => (
            <label key={item}>
              <input
                type="checkbox"
                checked={
                  (
                    state.settings?.autopilot_functions as
                      Record<string, boolean> | undefined
                  )?.[item] !== false
                }
                onChange={(event) =>
                  void toggleMode(item, event.target.checked)
                }
              />
              <Check size={13} /> {item}
            </label>
          ))}
        </div>
        <p>
          Due reminders, CRM exceptions, dropped balls, lead digests, daily
          briefings, EOD links and chasers, morale reports, and weekly coaching
          are delivered through the selected channel. Slack can target a rep directly; ClickUp remains the fallback and durable owner queue.
        </p>
      </article>
      <article className="panel webhook-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">INBOUND AUTOMATION</span>
            <h3>Webhook endpoints</h3>
          </div>
          <ShieldCheck size={18} />
        </div>
        <p>
          Use the tokenized URLs in GoHighLevel and Fathom. Rotate the token if
          a URL is exposed.
        </p>
        {[
          ["GHL appointments", "ghl-appointment-webhook"],
          ["GHL calls", "ghl-call-webhook"],
          ["Fathom calls", "fathom-webhook"],
        ].map(([label, endpoint]) => (
          <label className="webhook-row" key={endpoint}>
            <span>{label}</span>
            <code>
              {base}/{endpoint}?token={token || "YOUR_TOKEN"}
            </code>
            <button
              onClick={() =>
                void navigator.clipboard.writeText(
                  `${base}/${endpoint}?token=${token}`,
                )
              }
            >
              <Clipboard size={14} />
            </button>
          </label>
        ))}
        <button
          className="quiet-btn"
          disabled={busy}
          onClick={() =>
            void invoke(
              { action: "rotateWebhookToken" },
              "Webhook token rotated. Update all providers now.",
            )
          }
        >
          Rotate webhook token
        </button>
      </article>
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
function StatusLine({
  icon,
  name,
  connected,
  detail,
}: {
  icon: React.ReactNode;
  name: string;
  connected: boolean;
  detail: string;
}) {
  return (
    <div className="status-line">
      <span>{icon}</span>
      <div>
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
      <i className={connected ? "connected" : ""}>
        {connected ? "Connected" : "Not connected"}
      </i>
    </div>
  );
}
