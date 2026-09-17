"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  BellRing,
  CheckCircle2,
  ExternalLink,
  Eye,
  History,
  LoaderCircle,
  Megaphone,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

export type MediaModule =
  | "media-tools"
  | "media-structure"
  | "media-history"
  | "media-automation"
  | "media-settings";

type Row = Record<string, unknown>;
type ToolAction =
  | "audit-ad-account"
  | "spy-ads"
  | "script-ads"
  | "launch-meta-ads";

const demoAudit: Row = {
  metrics: {
    spend: 5240,
    impressions: 184300,
    clicks: 3940,
    leads: 128,
    purchases: 18,
    revenue: 16850,
    ctr: 2.14,
    cpc: 1.33,
    cpl: 40.94,
    roas: 3.22,
    currency: "USD",
  },
  adsAnalyzed: 14,
  analysis: {
    status: "green",
    report:
      "Efficiency is healthy. Protect the proof-led winner and increase budget in controlled increments while the next hook test learns.",
    highlights: ["Proof Stack V3", "Founder Story - Short"],
    alerts: ["Frequency is rising on the retargeting ad set."],
    next_actions: [
      "Scale the strongest ad set by 15%.",
      "Replace the fatigued retargeting creative.",
      "Validate qualified-lead rate in the CRM.",
    ],
  },
  historyId: "demo-audit",
};

const demoScript: Row = {
  analysis: {
    analysis: "Use proof and process clarity without promising outcomes.",
    positioning:
      "A practical operating system for faster, more consistent follow-up.",
    angles: [
      {
        name: "Hidden cost",
        rationale: "Makes the operational problem concrete.",
        hook: "Your leads may not be cold. Your response time may be.",
        primaryText:
          "See a practical follow-up system your team can review, adapt, and run consistently.",
        headline: "Build a clearer follow-up system",
        cta: "Learn More",
      },
      {
        name: "Proof process",
        rationale: "Explains the mechanism before asking for action.",
        hook: "Better follow-up starts with a visible process.",
        primaryText:
          "Review the workflow behind consistent lead handling and decide whether it fits your team.",
        headline: "See how the workflow works",
        cta: "Learn More",
      },
      {
        name: "Guided next step",
        rationale: "Invites a low-pressure next action.",
        hook: "Ready to review your follow-up gaps?",
        primaryText:
          "Get a clear look at your current process and the next practical improvements.",
        headline: "Review your next step",
        cta: "Contact Us",
      },
    ],
    testingPlan: [
      "Hold audience and budget constant.",
      "Test one angle at a time.",
    ],
    compliance: ["Verify every claim and disclosure before publishing."],
  },
  generationFallback: false,
  historyId: "demo-script",
};

const demoStructure: Row = {
  period: "last_7d",
  campaigns: [
    {
      id: "12001",
      name: "Proof Stack",
      status: "ACTIVE",
      objective: "OUTCOME_LEADS",
    },
    {
      id: "12002",
      name: "Founder Story",
      status: "PAUSED",
      objective: "OUTCOME_TRAFFIC",
    },
  ],
  campaignMetrics: [
    {
      campaign_id: "12001",
      spend: "3220",
      impressions: "104000",
      clicks: "2510",
      ctr: "2.41",
      cpc: "1.28",
    },
    {
      campaign_id: "12002",
      spend: "2020",
      impressions: "80300",
      clicks: "1430",
      ctr: "1.78",
      cpc: "1.41",
    },
  ],
  adSets: [
    {
      id: "22001",
      campaign_id: "12001",
      name: "Broad - US",
      status: "ACTIVE",
      optimization_goal: "LEAD_GENERATION",
    },
  ],
  adSetMetrics: [
    {
      adset_id: "22001",
      spend: "3220",
      impressions: "104000",
      clicks: "2510",
      ctr: "2.41",
      cpc: "1.28",
    },
  ],
  ads: [
    {
      id: "32001",
      adset_id: "22001",
      name: "Proof Stack V3",
      status: "ACTIVE",
      creative: { id: "42001", name: "Proof V3" },
    },
  ],
  adMetrics: [
    {
      ad_id: "32001",
      spend: "1880",
      impressions: "59000",
      clicks: "1530",
      ctr: "2.59",
      cpc: "1.23",
    },
  ],
};

const demoRuns: Row[] = [
  {
    id: "demo-audit",
    action: "audit-ad-account",
    ad_account_id: "123456789",
    result: demoAudit,
    created_at: "2026-09-14T08:00:00Z",
  },
  {
    id: "demo-script",
    action: "script-ads",
    ad_account_id: "123456789",
    result: demoScript,
    created_at: "2026-09-13T08:00:00Z",
  },
];
const demoDrafts: Row[] = [
  {
    id: "demo-draft",
    ad_account_id: "123456789",
    campaign_id: "12000000001",
    adset_id: "12000000002",
    creative_id: "12000000003",
    ad_id: "12000000004",
    status: "created",
    created_at: "2026-09-14T08:10:00Z",
  },
];

const toolDefinitions: {
  action: ToolAction;
  name: string;
  detail: string;
  icon: typeof Search;
}[] = [
  {
    action: "audit-ad-account",
    name: "Account audit",
    detail: "Analyze seven-day performance, waste, winners, and next actions.",
    icon: BarChart3,
  },
  {
    action: "spy-ads",
    name: "Ad Library research",
    detail:
      "Search active EU/UK commercial ads and open the public library fallback.",
    icon: Search,
  },
  {
    action: "script-ads",
    name: "Compliant ad scripts",
    detail:
      "Generate three testable angles, copy, testing steps, and compliance checks.",
    icon: WandSparkles,
  },
  {
    action: "launch-meta-ads",
    name: "Create paused draft",
    detail: "Create a campaign, ad set, creative, and ad in Meta, all paused.",
    icon: Megaphone,
  },
];

export function MediaBuyerModule({
  module,
  isDemo,
  onConnectMeta,
  initialTool,
}: {
  module: MediaModule;
  isDemo: boolean;
  onConnectMeta?: () => void;
  initialTool?: "audit" | "spy" | "script" | "draft";
}) {
  if (module === "media-tools")
    return <ToolsPanel isDemo={isDemo} initialTool={initialTool} />;
  if (module === "media-structure") return <StructurePanel isDemo={isDemo} />;
  if (module === "media-history") return <HistoryPanel isDemo={isDemo} />;
  if (module === "media-automation") return <AutomationPanel isDemo={isDemo} />;
  return <SettingsPanel isDemo={isDemo} onConnectMeta={onConnectMeta} />;
}

function AutomationPanel({ isDemo }: { isDemo: boolean }) {
  const demo = {
    recommendations: [{ id: 1, status: "open", action: "scale", title: "Scale Proof Stack by 15%", detail: "CPL is below target and CRM revenue confirms healthy ROAS.", proposed_payload: { operation: "set_daily_budget", value: 17250 } }],
    alerts: [{ id: 1, severity: "warning", title: "Founder Story: Creative fatigue signal", detail: "CTR fell 29% versus the prior three days." }],
    attribution: [{ meta_campaign_id: "12001", leads: 18, won: 4, revenue: 12400, spend: 3220 }],
  };
  const [data, setData] = useState<Row>(isDemo ? demo : {});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo) return;
    setBusy(true);
    try { setData(await invoke("recommendations")); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Automation data could not be loaded."); }
    finally { setBusy(false); }
  }, [isDemo]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  async function runMonitor() {
    if (isDemo) { setNotice("Demo monitor completed: one alert and one proposal created."); return; }
    setBusy(true);
    try { const result = await invoke("run-monitor"); setNotice(`Monitor completed: ${Number(result.alerts ?? 0)} alerts and ${Number(result.proposals ?? 0)} proposals.`); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Monitor failed."); }
    finally { setBusy(false); }
  }
  async function decide(id: unknown, decision: "approved" | "rejected") {
    if (isDemo) { setData((current) => ({ ...current, recommendations: (current.recommendations as Row[]).map((item) => item.id === id ? { ...item, status: decision } : item) })); return; }
    setBusy(true);
    try { await invoke("decide-recommendation", { id, decision }); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Decision failed."); }
    finally { setBusy(false); }
  }
  async function execute(id: unknown) {
    if (isDemo) { setNotice("Demo approved change executed."); return; }
    setBusy(true);
    try { await invoke("execute-recommendation", { id }); setNotice("Approved Meta change executed and logged."); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Execution failed."); }
    finally { setBusy(false); }
  }
  const queue = Array.isArray(data.recommendations) ? data.recommendations as Row[] : [];
  const alerts = Array.isArray(data.alerts) ? data.alerts as Row[] : [];
  const attribution = Array.isArray(data.attribution) ? data.attribution as Row[] : [];
  return <section>
    <ModuleHeading eyebrow="MEDIA BUYER AUTOPILOT" title="Monitor continuously. Change campaigns only after approval." detail="Detect spend, CPL, ROAS, tracking, delivery, and fatigue problems; reconcile Meta campaigns with GHL revenue; then review every proposed action before execution." action={<button className="small-primary" disabled={busy} onClick={() => void runMonitor()}><RefreshCw className={busy ? "spin" : ""} size={14}/> Run monitor</button>} />
    {notice && <p className="inline-notice">{notice}</p>}
    <div className="ops-grid">
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">APPROVAL QUEUE</span><h3>Recommended campaign actions</h3></div><ShieldCheck size={18}/></div>
        <div className="history-list">{queue.map((item) => <div key={String(item.id)} className="history-card"><span><b>{String(item.title)}</b><small>{String(item.detail ?? "")}</small></span><i className={`outcome ${String(item.status)}`}>{String(item.status)}</i>{item.status === "open" && <div className="button-row"><button disabled={busy} onClick={() => void decide(item.id, "approved")}>Approve</button><button disabled={busy} onClick={() => void decide(item.id, "rejected")}>Reject</button></div>}{item.status === "approved" && <button className="small-primary" disabled={busy} onClick={() => void execute(item.id)}>Execute approved change</button>}</div>)}{!queue.length && <p className="empty-copy">No recommendations yet. Run the monitor after connecting Meta.</p>}</div>
      </article>
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">ANOMALY ALERTS</span><h3>What needs attention</h3></div><BellRing size={18}/></div><div className="history-list">{alerts.map((item) => <div key={String(item.id)} className="history-card"><span><b>{String(item.title)}</b><small>{String(item.detail ?? "")}</small></span><i className={`outcome ${String(item.severity)}`}>{String(item.severity)}</i></div>)}{!alerts.length && <p className="empty-copy">No anomalies detected.</p>}</div></article>
    </div>
    <article className="panel structure-table"><div className="panel-head"><div><span className="eyebrow">CLOSED-LOOP ATTRIBUTION</span><h3>Meta spend to GHL wins</h3></div><BarChart3 size={18}/></div><div className="structure-row header"><span>Campaign</span><span>Leads</span><span>Won</span><span>Revenue</span><span>Spend</span><span>CRM ROAS</span><span>Source</span></div>{attribution.map((row) => <div className="structure-row" key={`${row.meta_campaign_id}-${row.report_date}`}><span>{String(row.meta_campaign_id)}</span><span>{Number(row.leads ?? 0)}</span><span>{Number(row.won ?? 0)}</span><span>{formatMoney(row.revenue)}</span><span>{formatMoney(row.spend)}</span><span>{Number(row.spend) ? `${(Number(row.revenue) / Number(row.spend)).toFixed(2)}x` : "-"}</span><span>GHL attribution</span></div>)}</article>
  </section>;
}

async function invoke(action: string, input: Row = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke("media-buyer-tools", {
    body: { action, input },
  });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return (data ?? {}) as Row;
}

function ToolsPanel({
  isDemo,
  initialTool = "audit",
}: {
  isDemo: boolean;
  initialTool?: "audit" | "spy" | "script" | "draft";
}) {
  const actionMap: Record<typeof initialTool, ToolAction> = {
    audit: "audit-ad-account",
    spy: "spy-ads",
    script: "script-ads",
    draft: "launch-meta-ads",
  };
  const [action, setAction] = useState<ToolAction>(actionMap[initialTool]);
  const [result, setResult] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState({
    campaignName: "",
    pageId: "",
    destinationUrl: "",
    imageUrl: "",
    primaryText: "",
    headline: "",
    description: "",
    country: "US",
    dailyBudget: "25",
  });

  async function run(nextAction: ToolAction, input: Row = {}) {
    setBusy(true);
    setNotice("");
    setResult(null);
    try {
      let data: Row;
      if (isDemo) {
        data =
          nextAction === "audit-ad-account"
            ? demoAudit
            : nextAction === "script-ads"
              ? demoScript
              : nextAction === "spy-ads"
                ? {
                    query: input.searchTerms,
                    country: input.country,
                    ads: [],
                    apiAvailable: false,
                    libraryUrl: "https://www.facebook.com/ads/library/",
                    notice:
                      "Demo mode prepared a public Meta Ad Library search.",
                    historyId: "demo-spy",
                  }
                : {
                    ok: true,
                    status: "PAUSED",
                    campaignId: "12000000001",
                    adsetId: "12000000002",
                    creativeId: "12000000003",
                    adId: "12000000004",
                    historyId: "demo-draft",
                    safety: "All entities were created paused in this demo.",
                  };
      } else data = await invoke(nextAction, input);
      setResult(data);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The tool could not run.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await run(action, values);
  }

  async function sendToClickUp() {
    const runId = String(result?.historyId ?? "");
    if (!runId) return;
    if (isDemo) {
      setNotice("Demo result sent to the selected ClickUp List.");
      return;
    }
    setBusy(true);
    try {
      const data = await invoke("send-clickup", { runId });
      setNotice("Result sent to ClickUp.");
      if (data.taskUrl)
        window.open(String(data.taskUrl), "_blank", "noopener,noreferrer");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "ClickUp delivery failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  function useAngle(angle: Row) {
    setDraft((current) => ({
      ...current,
      primaryText: String(angle.primaryText ?? ""),
      headline: String(angle.headline ?? ""),
    }));
    setAction("launch-meta-ads");
    setResult(null);
  }

  return (
    <section>
      <ModuleHeading
        eyebrow="AI MEDIA BUYER TOOLS"
        title="Research, write, audit, and build safely."
        detail="Every completed run is saved. Meta launch creates only paused entities so a human can review tracking, compliance, and budget before activation."
      />
      <div className="media-tool-picker">
        {toolDefinitions.map((tool) => (
          <button
            className={action === tool.action ? "active" : ""}
            key={tool.action}
            onClick={() => {
              setAction(tool.action);
              setResult(null);
              setNotice("");
            }}
          >
            <tool.icon size={17} />
            <span>
              <b>{tool.name}</b>
              <small>{tool.detail}</small>
            </span>
          </button>
        ))}
      </div>
      {notice && <p className="inline-notice">{notice}</p>}
      <div className="media-workbench">
        <article className="panel media-tool-form">
          {action === "audit-ad-account" && (
            <div className="tool-callout">
              <ShieldCheck size={23} />
              <div>
                <h3>Audit the selected Meta account</h3>
                <p>
                  Reads ad-level insights for the last seven days and returns a
                  grounded action plan.
                </p>
              </div>
              <button
                className="primary-btn"
                disabled={busy}
                onClick={() => void run(action)}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <BarChart3 size={16} />
                )}{" "}
                Run audit
              </button>
            </div>
          )}
          {action === "spy-ads" && (
            <form className="form-stack flush" onSubmit={submit}>
              <h3>Research active ads</h3>
              <label>
                Competitor, brand, or keyword
                <input
                  required
                  name="searchTerms"
                  placeholder="e.g. dental lead generation"
                />
              </label>
              <label>
                Reached country
                <select name="country" defaultValue="GB">
                  <option value="GB">United Kingdom</option>
                  <option value="DE">Germany</option>
                  <option value="FR">France</option>
                  <option value="ES">Spain</option>
                  <option value="IT">Italy</option>
                  <option value="NL">Netherlands</option>
                  <option value="SE">Sweden</option>
                  <option value="IE">Ireland</option>
                </select>
              </label>
              <small className="field-help">
                Meta limits commercial Ad Library API queries to the EU and
                United Kingdom. The tool always provides a public-library
                fallback.
              </small>
              <button className="primary-btn" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Search size={16} />
                )}{" "}
                Search Ad Library
              </button>
            </form>
          )}
          {action === "script-ads" && (
            <form className="form-stack flush" onSubmit={submit}>
              <h3>Generate compliant ad angles</h3>
              <label>
                Offer
                <textarea
                  required
                  name="offer"
                  placeholder="What you sell, mechanism, proof you can verify, price or conditions..."
                />
              </label>
              <label>
                Audience
                <textarea
                  required
                  name="audience"
                  placeholder="Who the offer is designed for and what they need help deciding..."
                />
              </label>
              <button className="primary-btn" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <WandSparkles size={16} />
                )}{" "}
                Generate three angles
              </button>
            </form>
          )}
          {action === "launch-meta-ads" && (
            <form className="form-stack flush" onSubmit={submit}>
              <div className="draft-warning">
                <ShieldCheck size={17} />
                <span>
                  <b>Paused by design.</b> This creates real Meta objects but
                  never activates delivery.
                </span>
              </div>
              <div className="form-grid">
                <label>
                  Campaign name
                  <input
                    required
                    name="campaignName"
                    value={draft.campaignName}
                    onChange={(e) =>
                      setDraft({ ...draft, campaignName: e.target.value })
                    }
                  />
                </label>
                <label>
                  Facebook Page ID
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]+"
                    name="pageId"
                    value={draft.pageId}
                    onChange={(e) =>
                      setDraft({ ...draft, pageId: e.target.value })
                    }
                  />
                </label>
                <label>
                  Daily budget
                  <input
                    required
                    min="1"
                    step="0.01"
                    type="number"
                    name="dailyBudget"
                    value={draft.dailyBudget}
                    onChange={(e) =>
                      setDraft({ ...draft, dailyBudget: e.target.value })
                    }
                  />
                </label>
                <label>
                  Target country
                  <input
                    required
                    maxLength={2}
                    name="country"
                    value={draft.country}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        country: e.target.value.toUpperCase(),
                      })
                    }
                  />
                </label>
              </div>
              <label>
                Destination URL
                <input
                  required
                  type="url"
                  name="destinationUrl"
                  placeholder="https://..."
                  value={draft.destinationUrl}
                  onChange={(e) =>
                    setDraft({ ...draft, destinationUrl: e.target.value })
                  }
                />
              </label>
              <label>
                Public image URL
                <input
                  required
                  type="url"
                  name="imageUrl"
                  placeholder="https://.../creative.jpg"
                  value={draft.imageUrl}
                  onChange={(e) =>
                    setDraft({ ...draft, imageUrl: e.target.value })
                  }
                />
              </label>
              <label>
                Primary text
                <textarea
                  required
                  name="primaryText"
                  value={draft.primaryText}
                  onChange={(e) =>
                    setDraft({ ...draft, primaryText: e.target.value })
                  }
                />
              </label>
              <label>
                Headline
                <input
                  required
                  name="headline"
                  value={draft.headline}
                  onChange={(e) =>
                    setDraft({ ...draft, headline: e.target.value })
                  }
                />
              </label>
              <label>
                Description
                <input
                  name="description"
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
              <button className="primary-btn" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Megaphone size={16} />
                )}{" "}
                Create paused Meta draft
              </button>
            </form>
          )}
        </article>
        <article className="panel media-result">
          <div className="panel-head">
            <div>
              <span className="eyebrow">RESULT</span>
              <h3>{result ? "Saved analysis" : "Ready when you are"}</h3>
            </div>
            {result?.historyId && (
              <button
                className="small-primary"
                disabled={busy}
                onClick={() => void sendToClickUp()}
              >
                <Send size={14} /> Send to ClickUp
              </button>
            )}
          </div>
          {result ? (
            <ToolResult action={action} result={result} onUseAngle={useAngle} />
          ) : (
            <p className="empty-copy">
              Run a tool to see the structured result here. Live runs are stored
              in History automatically.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}

function ToolResult({
  action,
  result,
  onUseAngle,
}: {
  action: ToolAction;
  result: Row;
  onUseAngle: (angle: Row) => void;
}) {
  if (action === "audit-ad-account") {
    const metrics = (result.metrics ?? {}) as Row;
    const analysis = (result.analysis ?? {}) as Row;
    return (
      <div className="result-stack">
        <div className="mini-metrics">
          {["spend", "ctr", "cpc", "cpl", "roas"].map((key) => (
            <div key={key}>
              <small>{key.toUpperCase()}</small>
              <b>{formatMetric(key, metrics[key])}</b>
            </div>
          ))}
        </div>
        <p className="result-report">
          {String(analysis.report ?? "No report returned.")}
        </p>
        <ResultList title="Next actions" values={analysis.next_actions} />
        <ResultList title="Alerts" values={analysis.alerts} />
      </div>
    );
  }
  if (action === "script-ads") {
    const analysis = (result.analysis ?? {}) as Row;
    const angles = Array.isArray(analysis.angles)
      ? (analysis.angles as Row[])
      : [];
    return (
      <div className="result-stack">
        <p className="result-report">
          {String(analysis.positioning ?? analysis.analysis ?? "")}
        </p>
        <div className="angle-list">
          {angles.map((angle, index) => (
            <article key={index}>
              <small>ANGLE {index + 1}</small>
              <h4>{String(angle.name ?? "Angle")}</h4>
              <b>{String(angle.hook ?? "")}</b>
              <p>{String(angle.primaryText ?? "")}</p>
              <strong>{String(angle.headline ?? "")}</strong>
              <button onClick={() => onUseAngle(angle)}>
                Use in paused draft
              </button>
            </article>
          ))}
        </div>
        <ResultList title="Testing plan" values={analysis.testingPlan} />
        <ResultList title="Compliance review" values={analysis.compliance} />
      </div>
    );
  }
  if (action === "spy-ads") {
    const ads = Array.isArray(result.ads) ? (result.ads as Row[]) : [];
    return (
      <div className="result-stack">
        <p className="result-report">
          {String(
            result.notice ??
              `${ads.length} active ads returned for ${result.country}.`,
          )}
        </p>
        {result.libraryUrl && (
          <a
            className="external-result"
            href={String(result.libraryUrl)}
            target="_blank"
            rel="noreferrer"
          >
            Open this search in Meta Ad Library <ExternalLink size={14} />
          </a>
        )}
        <div className="angle-list">
          {ads.map((ad) => (
            <article key={String(ad.id)}>
              <small>{String(ad.page_name ?? "Advertiser")}</small>
              <p>
                {Array.isArray(ad.ad_creative_bodies)
                  ? String(ad.ad_creative_bodies[0] ?? "")
                  : ""}
              </p>
              {ad.ad_snapshot_url && (
                <a
                  href={String(ad.ad_snapshot_url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View ad
                </a>
              )}
            </article>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="result-stack">
      <div className="success-banner">
        <CheckCircle2 size={20} />
        <div>
          <b>Meta draft created as PAUSED</b>
          <p>
            {String(
              result.safety ??
                "Review it in Meta Ads Manager before activation.",
            )}
          </p>
        </div>
      </div>
      <div className="id-list">
        {["campaignId", "adsetId", "creativeId", "adId"].map((key) => (
          <div key={key}>
            <small>{key.replace("Id", " ID")}</small>
            <code>{String(result[key] ?? "Not created")}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function StructurePanel({ isDemo }: { isDemo: boolean }) {
  const [data, setData] = useState<Row>(isDemo ? demoStructure : {});
  const [level, setLevel] = useState<"campaigns" | "adSets" | "ads">(
    "campaigns",
  );
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo) {
      setData(demoStructure);
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      setData(await invoke("list-meta-structure"));
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not load Meta structure.",
      );
    } finally {
      setBusy(false);
    }
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  const rows = Array.isArray(data[level]) ? (data[level] as Row[]) : [];
  const metricKey =
    level === "campaigns"
      ? "campaignMetrics"
      : level === "adSets"
        ? "adSetMetrics"
        : "adMetrics";
  const idKey =
    level === "campaigns"
      ? "campaign_id"
      : level === "adSets"
        ? "adset_id"
        : "ad_id";
  const metrics = Array.isArray(data[metricKey])
    ? (data[metricKey] as Row[])
    : [];
  async function showPreview(adId: string) {
    setBusy(true);
    setNotice("");
    setPreview("");
    try {
      if (isDemo)
        setPreview(
          "<!doctype html><body style='font-family:Arial;padding:28px'><h2>Demo Meta ad preview</h2><p>Proof Stack V3</p><button>Learn more</button></body>",
        );
      else
        setPreview(
          String((await invoke("preview-meta-ad", { adId })).previewHtml ?? ""),
        );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Preview unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <ModuleHeading
        eyebrow="META ACCOUNT STRUCTURE"
        title="Inspect campaigns down to the ad."
        detail="Live structure and seven-day metrics are read directly from the selected Meta account. Ad previews are isolated in a sandboxed frame."
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
      <div className="level-tabs">
        <button
          className={level === "campaigns" ? "active" : ""}
          onClick={() => setLevel("campaigns")}
        >
          Campaigns
        </button>
        <button
          className={level === "adSets" ? "active" : ""}
          onClick={() => setLevel("adSets")}
        >
          Ad sets
        </button>
        <button
          className={level === "ads" ? "active" : ""}
          onClick={() => setLevel("ads")}
        >
          Ads
        </button>
      </div>
      <article className="panel structure-table">
        <div className="structure-row header">
          <span>Name</span>
          <span>Status</span>
          <span>Spend</span>
          <span>Impressions</span>
          <span>Clicks</span>
          <span>CTR</span>
          <span>Action</span>
        </div>
        {rows.map((row) => {
          const metric =
            metrics.find((item) => String(item[idKey]) === String(row.id)) ??
            {};
          return (
            <div className="structure-row" key={String(row.id)}>
              <span>
                <b>{String(row.name ?? row.id)}</b>
                <small>
                  {String(row.objective ?? row.optimization_goal ?? row.id)}
                </small>
              </span>
              <span>
                <i className={`outcome ${String(row.status).toLowerCase()}`}>
                  {String(row.effective_status ?? row.status ?? "UNKNOWN")}
                </i>
              </span>
              <span>{formatMoney(metric.spend)}</span>
              <span>{Number(metric.impressions ?? 0).toLocaleString()}</span>
              <span>{Number(metric.clicks ?? 0).toLocaleString()}</span>
              <span>{Number(metric.ctr ?? 0).toFixed(2)}%</span>
              <span>
                {level === "ads" ? (
                  <button
                    className="table-action"
                    disabled={busy}
                    onClick={() => void showPreview(String(row.id))}
                  >
                    <Eye size={14} /> Preview
                  </button>
                ) : (
                  "-"
                )}
              </span>
            </div>
          );
        })}
        {!rows.length && (
          <p className="empty-copy">No {level.toLowerCase()} were returned.</p>
        )}
      </article>
      {preview && (
        <article className="panel preview-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">META PREVIEW</span>
              <h3>Mobile feed</h3>
            </div>
            <button onClick={() => setPreview("")}>Close</button>
          </div>
          <iframe
            title="Meta ad preview"
            sandbox="allow-scripts allow-popups"
            srcDoc={preview}
          />
        </article>
      )}
    </section>
  );
}

function HistoryPanel({ isDemo }: { isDemo: boolean }) {
  const [runs, setRuns] = useState<Row[]>(isDemo ? demoRuns : []);
  const [drafts, setDrafts] = useState<Row[]>(isDemo ? demoDrafts : []);
  const [selected, setSelected] = useState<Row | null>(
    isDemo ? demoRuns[0] : null,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo) return;
    setBusy(true);
    setNotice("");
    try {
      const [history, draftData] = await Promise.all([
        invoke("history"),
        invoke("drafts"),
      ]);
      setRuns(Array.isArray(history.runs) ? (history.runs as Row[]) : []);
      setDrafts(
        Array.isArray(draftData.drafts) ? (draftData.drafts as Row[]) : [],
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not load history.",
      );
    } finally {
      setBusy(false);
    }
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  async function send(runId: string) {
    if (isDemo) {
      setNotice("Demo result sent to ClickUp.");
      return;
    }
    setBusy(true);
    try {
      await invoke("send-clickup", { runId });
      setNotice("Saved result sent to ClickUp.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "ClickUp delivery failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <ModuleHeading
        eyebrow="MEDIA BUYER HISTORY"
        title="A durable record of every decision."
        detail="Review saved analyses and the exact IDs created by paused Meta draft runs."
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
      <div className="history-layout">
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">TOOL RUNS</span>
              <h3>Saved results</h3>
            </div>
            <History size={18} />
          </div>
          <div className="history-list">
            {runs.map((run) => (
              <button
                className={selected?.id === run.id ? "active" : ""}
                key={String(run.id)}
                onClick={() => setSelected(run)}
              >
                <span>
                  <b>{String(run.action).replaceAll("-", " ")}</b>
                  <small>
                    {new Date(String(run.created_at)).toLocaleString()}
                  </small>
                </span>
                <small>act_{String(run.ad_account_id)}</small>
              </button>
            ))}
            {!runs.length && (
              <p className="empty-copy">No saved tool runs yet.</p>
            )}
          </div>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">DETAIL</span>
              <h3>
                {selected
                  ? String(selected.action).replaceAll("-", " ")
                  : "Select a result"}
              </h3>
            </div>
            {selected && (
              <button
                className="small-primary"
                disabled={busy}
                onClick={() => void send(String(selected.id))}
              >
                <Send size={14} /> ClickUp
              </button>
            )}
          </div>
          {selected ? (
            <pre className="json-result">
              {JSON.stringify(selected.result, null, 2)}
            </pre>
          ) : (
            <p className="empty-copy">
              Choose a run to inspect its saved output.
            </p>
          )}
        </article>
      </div>
      <article className="panel draft-ledger">
        <div className="panel-head">
          <div>
            <span className="eyebrow">DRAFT LEDGER</span>
            <h3>Meta objects created</h3>
          </div>
          <Megaphone size={18} />
        </div>
        <div className="structure-row header">
          <span>Created</span>
          <span>Status</span>
          <span>Campaign</span>
          <span>Ad set</span>
          <span>Creative</span>
          <span>Ad</span>
          <span>Account</span>
        </div>
        {drafts.map((draft) => (
          <div className="structure-row" key={String(draft.id)}>
            <span>
              {new Date(String(draft.created_at)).toLocaleDateString()}
            </span>
            <span>
              <i className={`outcome ${draft.status}`}>
                {String(draft.status)}
              </i>
            </span>
            <span>{String(draft.campaign_id ?? "-")}</span>
            <span>{String(draft.adset_id ?? "-")}</span>
            <span>{String(draft.creative_id ?? "-")}</span>
            <span>{String(draft.ad_id ?? "-")}</span>
            <span>act_{String(draft.ad_account_id)}</span>
          </div>
        ))}
      </article>
    </section>
  );
}

function SettingsPanel({
  isDemo,
  onConnectMeta,
}: {
  isDemo: boolean;
  onConnectMeta?: () => void;
}) {
  const demoState: Row = {
    meta: {
      status: "connected",
      account_id: "123456789",
      account_name: "Operator AI Demo",
      accounts: [
        {
          id: "123456789",
          name: "Operator AI Demo",
          currency: "USD",
          timezone: "America/Los_Angeles",
        },
        {
          id: "987654321",
          name: "Sandbox Store",
          currency: "USD",
          timezone: "America/New_York",
        },
      ],
    },
    ai: {
      status: "connected",
      account_name: "OpenAI",
      metadata: { model: "gpt-5-mini", last4: "demo" },
    },
    settings: { tools_enabled: true, review_policy: "paused_only" },
  };
  const [state, setState] = useState<Row>(isDemo ? demoState : {});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (isDemo) return;
    setBusy(true);
    try {
      setState(await invoke("state"));
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not load settings.",
      );
    } finally {
      setBusy(false);
    }
  }, [isDemo]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  async function run(action: string, input: Row, success: string) {
    if (isDemo) {
      setNotice(`Demo: ${success}`);
      if (action === "set-enabled")
        setState((current) => ({
          ...current,
          settings: {
            ...((current.settings ?? {}) as Row),
            tools_enabled: input.enabled,
          },
        }));
      return;
    }
    setBusy(true);
    try {
      await invoke(action, input);
      setNotice(success);
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Setting could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await run("save-ai", values, "AI provider saved.");
    if (!isDemo) event.currentTarget.reset();
  }
  const meta = (state.meta ?? {}) as Row;
  const ai = (state.ai ?? {}) as Row;
  const settings = (state.settings ?? {}) as Row;
  const accounts = Array.isArray(meta.accounts) ? (meta.accounts as Row[]) : [];
  return (
    <section>
      <ModuleHeading
        eyebrow="MEDIA BUYER SETUP"
        title="Control the account and its safeguards."
        detail="Select the Meta ad account, configure AI generation, and keep all write operations locked to paused-only review."
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
      <div className="ops-grid">
        <article className="panel integration-form">
          <StatusLine
            name="Meta Ads Manager"
            connected={meta.status === "connected"}
            detail={String(
              meta.account_name ?? "OAuth with ads_read and ads_management",
            )}
            icon={<Megaphone size={18} />}
          />
          {meta.status === "connected" ? (
            <div className="form-stack flush">
              <label>
                Active ad account
                <select
                  value={String(meta.account_id ?? "")}
                  onChange={(event) =>
                    void run(
                      "select-account",
                      { accountId: event.target.value },
                      "Meta ad account selected.",
                    )
                  }
                >
                  {accounts.map((account) => (
                    <option key={String(account.id)} value={String(account.id)}>
                      {String(account.name)} - act_{String(account.id)} (
                      {String(account.currency ?? "")})
                    </option>
                  ))}
                </select>
              </label>
              <p className="field-help">
                Audit, structure, preview, sync, and draft creation use this
                account.
              </p>
              <button
                className="danger-link"
                disabled={busy}
                onClick={() =>
                  void run("disconnect-meta", {}, "Meta disconnected.")
                }
              >
                Disconnect Meta
              </button>
            </div>
          ) : (
            <div className="form-stack flush">
              <button
                className="primary-btn"
                disabled={busy}
                onClick={onConnectMeta}
              >
                Connect Meta with OAuth
              </button>
            </div>
          )}
        </article>
        <article className="panel integration-form">
          <StatusLine
            name="AI copy provider"
            connected={ai.status === "connected"}
            detail={
              ai.status === "connected"
                ? `${String(ai.account_name)} - ${String((ai.metadata as Row | undefined)?.model ?? "")}`
                : "OpenAI or GLM / Z.ai"
            }
            icon={<Sparkles size={18} />}
          />
          <form className="form-stack flush" onSubmit={saveAi}>
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
              {ai.status === "connected"
                ? "Update provider"
                : "Connect provider"}
            </button>
            {ai.status === "connected" && (
              <button
                type="button"
                className="danger-link"
                onClick={() =>
                  void run("remove-ai", {}, "AI provider removed.")
                }
              >
                Remove
              </button>
            )}
          </form>
        </article>
      </div>
      <article className="panel integration-form">
        <div className="panel-head"><div><span className="eyebrow">AUTOPILOT GUARDRAILS</span><h3>Monitoring and decision thresholds</h3></div><BellRing size={18} /></div>
        <form className="form-stack" onSubmit={(event) => {
          event.preventDefault();
          const values = Object.fromEntries(new FormData(event.currentTarget));
          void run("save-settings", {
            autopilot_enabled: values.autopilot_enabled === "on",
            target_cpl: Number(values.target_cpl), target_roas: Number(values.target_roas),
            max_daily_spend: Number(values.max_daily_spend), fatigue_ctr_drop_pct: Number(values.fatigue_ctr_drop_pct),
            timezone: values.timezone, brief_send_time: values.brief_send_time,
            clickup_alerts: values.clickup_alerts === "on",
          }, "Autopilot guardrails saved.");
        }}>
          <label className="toggle-row"><span><b>Scheduled Media Buyer monitor</b><small>Run hourly anomaly, fatigue, attribution, and recommendation checks.</small></span><input name="autopilot_enabled" type="checkbox" defaultChecked={settings.autopilot_enabled === true} /></label>
          <label className="toggle-row"><span><b>Send new alerts to ClickUp</b><small>Create one deduplicated daily task for newly detected campaign risks.</small></span><input name="clickup_alerts" type="checkbox" defaultChecked={settings.clickup_alerts !== false} /></label>
          <div className="form-grid two"><label>Target CPL<input name="target_cpl" type="number" min="1" step="0.01" defaultValue={Number(settings.target_cpl ?? 45)} /></label><label>Target ROAS<input name="target_roas" type="number" min="0.1" step="0.1" defaultValue={Number(settings.target_roas ?? 2.5)} /></label><label>Max daily spend<input name="max_daily_spend" type="number" min="0" step="0.01" defaultValue={Number(settings.max_daily_spend ?? 1000)} /></label><label>Fatigue CTR drop %<input name="fatigue_ctr_drop_pct" type="number" min="1" max="100" defaultValue={Number(settings.fatigue_ctr_drop_pct ?? 25)} /></label><label>Timezone<input name="timezone" defaultValue={String(settings.timezone ?? "America/Chicago")} /></label><label>Brief time<input name="brief_send_time" type="time" defaultValue={String(settings.brief_send_time ?? "08:00").slice(0, 5)} /></label></div>
          <button className="primary-btn" disabled={busy}>Save autopilot guardrails</button>
        </form>
      </article>
      <article className="panel safety-settings">
        <div>
          <ShieldCheck size={24} />
          <span>
            <b>Paused-only review policy</b>
            <small>
              Campaigns, ad sets, and ads are always created PAUSED. Activation
              is intentionally not exposed.
            </small>
          </span>
        </div>
        <label className="toggle-row">
          <span>
            <b>Media Buyer tools</b>
            <small>
              Disable all live audit, research, structure, preview, copy, and
              draft actions.
            </small>
          </span>
          <input
            type="checkbox"
            checked={settings.tools_enabled !== false}
            onChange={(event) =>
              void run(
                "set-enabled",
                { enabled: event.target.checked },
                `Media Buyer tools ${event.target.checked ? "enabled" : "disabled"}.`,
              )
            }
          />
        </label>
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

function ResultList({ title, values }: { title: string; values: unknown }) {
  const items = Array.isArray(values) ? values : [];
  if (!items.length) return null;
  return (
    <div className="result-list">
      <b>{title}</b>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            {typeof item === "string" ? item : JSON.stringify(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatMetric(key: string, value: unknown) {
  const amount = Number(value ?? 0);
  if (key === "ctr") return `${amount.toFixed(2)}%`;
  if (key === "roas") return `${amount.toFixed(2)}x`;
  return formatMoney(amount);
}
