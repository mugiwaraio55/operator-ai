"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileText,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Megaphone,
  MessageSquareText,
  PlugZap,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  UserRoundCheck,
  Users,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  demoCalls,
  demoCampaigns,
  demoConnections,
  type Campaign,
  type Connection,
  type SalesCall,
} from "./demoData";
import { SalesManagerModule, type SalesModule } from "./SalesManagerModules";
import { MediaBuyerModule, type MediaModule } from "./MediaBuyerModules";

type Workspace = "sales" | "media";
type View =
  | "overview"
  | "records"
  | "pipeline"
  | "charles"
  | "team"
  | "media-tools"
  | "media-structure"
  | "media-history"
  | "integrations";
type Modal = "ask" | "call" | "eod" | "tool" | null;
type ToolKey = "audit" | "spy" | "script" | "draft";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const mediaTools: {
  key: ToolKey;
  title: string;
  detail: string;
  icon: typeof Search;
}[] = [
  {
    key: "audit",
    title: "Audit account",
    detail: "Find waste, winners, and the next budget move.",
    icon: BarChart3,
  },
  {
    key: "spy",
    title: "Research angles",
    detail: "Turn a competitor or keyword into test ideas.",
    icon: Search,
  },
  {
    key: "script",
    title: "Script ads",
    detail: "Create hooks, body copy, and headlines.",
    icon: WandSparkles,
  },
  {
    key: "draft",
    title: "Create Meta draft",
    detail: "Prepare a paused campaign launch brief.",
    icon: Megaphone,
  },
];

function outcomeLabel(value: SalesCall["outcome"]) {
  return value === "follow_up"
    ? "Follow-up"
    : value === "no_show"
      ? "No-show"
      : value[0].toUpperCase() + value.slice(1);
}

function metricFor(campaign: Campaign) {
  const cpl = campaign.leads ? campaign.spend / campaign.leads : 0;
  const roas = campaign.spend ? campaign.revenue / campaign.spend : 0;
  const ctr = campaign.impressions
    ? (campaign.clicks / campaign.impressions) * 100
    : 0;
  return { cpl, roas, ctr };
}

function recommendationFor(campaign: Campaign) {
  const { cpl, roas } = metricFor(campaign);
  if (roas >= 3 && cpl <= 45)
    return {
      action: "Scale",
      tone: "good",
      detail: "Increase budget 15–20% and watch frequency.",
    };
  if (roas < 1.5 || cpl > 65)
    return {
      action: "Kill",
      tone: "bad",
      detail: "Pause spend and replace the creative angle.",
    };
  return {
    action: "Iterate",
    tone: "warn",
    detail: "Keep budget flat and test a stronger hook.",
  };
}

export function AppShell() {
  const [workspace, setWorkspace] = useState<Workspace>("sales");
  const [view, setView] = useState<View>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [activeTool, setActiveTool] = useState<ToolKey>("audit");
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [forceDemo, setForceDemo] = useState(!isSupabaseConfigured);
  const [calls, setCalls] = useState<SalesCall[]>(demoCalls);
  const [campaigns, setCampaigns] = useState<Campaign[]>(demoCampaigns);
  const [connections, setConnections] = useState<Connection[]>(demoConnections);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState("");
  const [prompt, setPrompt] = useState("");
  const [clickupListId, setClickupListId] = useState(
    isSupabaseConfigured ? "" : "901234567890",
  );

  const isDemo = forceDemo || !isSupabaseConfigured;

  const loadLiveData = useCallback(async () => {
    if (!supabase || !session) return;
    setBusy(true);
    const [callResult, campaignResult, connectionResult] = await Promise.all([
      supabase
        .from("sales_calls")
        .select(
          "id,prospect_name,rep_name,outcome,score,revenue,primary_objection,happened_at",
        )
        .order("happened_at", { ascending: false })
        .limit(50),
      supabase
        .from("meta_campaign_snapshots")
        .select(
          "id,campaign_name,status,spend,impressions,clicks,leads,purchases,revenue,date_start",
        )
        .order("date_start", { ascending: false })
        .limit(50),
      supabase
        .from("integration_connections")
        .select("provider,status,account_name,metadata"),
    ]);
    if (callResult.data) setCalls(callResult.data as SalesCall[]);
    if (campaignResult.data) setCampaigns(campaignResult.data as Campaign[]);
    if (connectionResult.data) {
      const nextConnections = connectionResult.data as Connection[];
      setConnections(nextConnections);
      const clickup = nextConnections.find(
        (connection) => connection.provider === "clickup",
      );
      if (typeof clickup?.metadata?.list_id === "string")
        setClickupListId(clickup.metadata.list_id);
    }
    const firstError =
      callResult.error ?? campaignResult.error ?? connectionResult.error;
    if (firstError) setNotice(firstError.message);
    setBusy(false);
  }, [session]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isDemo || !session) return;
    const timer = window.setTimeout(() => void loadLiveData(), 0);
    return () => window.clearTimeout(timer);
  }, [isDemo, session, loadLiveData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const connectionError = params.get("connection_error");
    if (!connected && !connectionError) return;
    const message = connected
      ? `${connected === "meta" ? "Meta Ads" : "ClickUp"} connected successfully.`
      : `${connectionError === "meta" ? "Meta Ads" : "ClickUp"} connection was not completed.`;
    const timer = window.setTimeout(() => setNotice(message), 0);
    window.history.replaceState({}, "", window.location.pathname);
    return () => window.clearTimeout(timer);
  }, []);

  const salesSummary = useMemo(() => {
    const booked = calls.filter((call) => call.outcome !== "no_show").length;
    const won = calls.filter((call) => call.outcome === "won").length;
    return {
      booked,
      closeRate: booked ? (won / booked) * 100 : 0,
      revenue: calls.reduce((sum, call) => sum + Number(call.revenue), 0),
      score: calls.length
        ? calls.reduce((sum, call) => sum + Number(call.score), 0) /
          calls.length
        : 0,
    };
  }, [calls]);

  const mediaSummary = useMemo(() => {
    const spend = campaigns.reduce((sum, row) => sum + Number(row.spend), 0);
    const leads = campaigns.reduce((sum, row) => sum + Number(row.leads), 0);
    const revenue = campaigns.reduce(
      (sum, row) => sum + Number(row.revenue),
      0,
    );
    const impressions = campaigns.reduce(
      (sum, row) => sum + Number(row.impressions),
      0,
    );
    return {
      spend,
      leads,
      impressions,
      cpl: leads ? spend / leads : 0,
      roas: spend ? revenue / spend : 0,
    };
  }, [campaigns]);

  const salesRecommendations = useMemo(() => {
    const priceCount = calls.filter((call) =>
      call.primary_objection.toLowerCase().includes("price"),
    ).length;
    const followUps = calls.filter(
      (call) => call.outcome === "follow_up",
    ).length;
    return [
      {
        title: `Coach the price objection before today’s calls`,
        meta: `${priceCount || 2} recent calls · High impact`,
        tone: "warn",
      },
      {
        title: `Follow up with open opportunities`,
        meta: `${followUps || 1} deals waiting · Revenue risk`,
        tone: "bad",
      },
      {
        title: `Share the winning discovery pattern`,
        meta: `${calls.filter((call) => call.score >= 85).length} high-scoring calls · Team playbook`,
        tone: "good",
      },
    ];
  }, [calls]);

  const metrics =
    workspace === "sales"
      ? [
          {
            label: "Booked calls",
            value: String(salesSummary.booked),
            detail: "this period",
            icon: Users,
          },
          {
            label: "Close rate",
            value: `${salesSummary.closeRate.toFixed(1)}%`,
            detail: "won / attended",
            icon: Target,
          },
          {
            label: "Revenue",
            value: compact.format(salesSummary.revenue),
            detail: "closed revenue",
            icon: CircleDollarSign,
          },
          {
            label: "Avg. call score",
            value: salesSummary.score.toFixed(0),
            detail: "out of 100",
            icon: UserRoundCheck,
          },
        ]
      : [
          {
            label: "Ad spend",
            value: compact.format(mediaSummary.spend),
            detail: "selected period",
            icon: CircleDollarSign,
          },
          {
            label: "Cost per lead",
            value: money.format(mediaSummary.cpl),
            detail: `${mediaSummary.leads} total leads`,
            icon: Target,
          },
          {
            label: "Impressions",
            value: compact.format(mediaSummary.impressions),
            detail: "Meta delivery",
            icon: Activity,
          },
          {
            label: "Blended ROAS",
            value: `${mediaSummary.roas.toFixed(1)}x`,
            detail: "tracked revenue",
            icon: TrendingUp,
          },
        ];

  async function connect(provider: "clickup" | "meta") {
    if (isDemo) {
      setNotice(
        `${provider === "meta" ? "Meta Ads" : "ClickUp"} connection is simulated in demo mode. Follow README.md for live setup.`,
      );
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke(
      "integration-oauth",
      {
        body: { action: "start", provider, returnUrl: window.location.origin },
      },
    );
    setBusy(false);
    if (error || !data?.url) {
      setNotice(error?.message ?? "Could not start connection.");
      return;
    }
    window.location.assign(data.url);
  }

  async function syncMeta(createClickUpTask = false) {
    if (isDemo) {
      setNotice(
        createClickUpTask
          ? "Demo Meta brief created as a ClickUp task."
          : "Demo Meta data refreshed.",
      );
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("sync-dashboard", {
      body: { createClickUpTask },
    });
    setBusy(false);
    if (error) setNotice(error.message);
    else {
      setNotice(
        createClickUpTask
          ? "Meta brief created in ClickUp."
          : "Meta campaigns refreshed.",
      );
      await loadLiveData();
    }
  }

  async function saveClickUpList() {
    if (!clickupListId.trim()) {
      setNotice("Enter a ClickUp List ID.");
      return;
    }
    if (isDemo) {
      setNotice("Demo ClickUp List saved.");
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("sync-dashboard", {
      body: { setClickUpListId: clickupListId.trim() },
    });
    setBusy(false);
    if (error) setNotice(error.message);
    else {
      setNotice(
        `ClickUp destination set to ${data?.listName ?? "the selected List"}.`,
      );
      await loadLiveData();
    }
  }

  async function testClickUp() {
    if (isDemo) {
      setNotice("Demo ClickUp task created.");
      return;
    }
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("sync-dashboard", {
      body: { testClickUp: true },
    });
    setBusy(false);
    setNotice(error ? error.message : "Test task created in ClickUp.");
  }

  async function runAssistant(tool?: ToolKey) {
    setBusy(true);
    setResult("");
    const chosen = tool ?? (workspace === "sales" ? "sales-coach" : "audit");
    if (isDemo) {
      const output =
        workspace === "sales"
          ? `The fastest lift is objection handling. Price appeared in ${calls.filter((c) => c.primary_objection === "Price").length} recent calls, while the best calls scored ${Math.max(...calls.map((c) => c.score))}. Coach reps to quantify the cost of waiting before presenting price. Next, contact every follow-up within 24 hours and use the winning discovery question from the highest-scoring call.`
          : chosen === "script"
            ? "ANGLE 1 — The hidden cost of slow follow-up\nHook: Your leads are not cold. Your response time is.\nHeadline: Turn More Ad Leads Into Booked Calls\nCTA: See the system\n\nANGLE 2 — Proof over promises\nHook: What changed when one team stopped guessing at follow-up?\nHeadline: The Follow-Up System Behind the Result\nCTA: Watch the breakdown"
            : chosen === "spy"
              ? "Research brief: compare direct-response ads that lead with operational pain, proof-led mini case studies, and founder-story creative. Save the opening three seconds, CTA, format, and proof mechanism from each. Do not copy claims or branding."
              : chosen === "draft"
                ? "PAUSED DRAFT BRIEF\nCampaign: Operator OS — Proof Stack\nObjective: Leads\nAudience: Broad, 28–55, English\nCreative: 30-second founder-led case study\nPrimary KPI: CPL ≤ $45\nGuardrail: Launch paused; review tracking and compliance before activation."
                : `Account audit: ${campaigns.filter((c) => recommendationFor(c).action === "Scale").length} campaigns can scale, ${campaigns.filter((c) => recommendationFor(c).action === "Kill").length} should be paused, and ${campaigns.filter((c) => recommendationFor(c).action === "Iterate").length} need a creative iteration. Protect the highest-ROAS campaign and move no more than 20% budget per day.`;
      setTimeout(() => {
        setResult(output);
        setBusy(false);
      }, 500);
      return;
    }
    if (!supabase) return;
    const { data, error } =
      workspace === "sales"
        ? await supabase.functions.invoke("charles-chat", {
            body: {
              message:
                prompt.trim() ||
                "Give me the highest-priority sales coaching and pipeline actions right now.",
            },
          })
        : await supabase.functions.invoke("assistant-run", {
            body: { workspace, tool: chosen, prompt },
          });
    setBusy(false);
    if (error) setResult(error.message);
    else setResult(data?.answer ?? data?.result ?? "No result returned.");
  }

  async function submitCall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const next: SalesCall = {
      id: crypto.randomUUID(),
      prospect_name: String(values.get("prospect")),
      rep_name: String(values.get("rep")),
      outcome: String(values.get("outcome")) as SalesCall["outcome"],
      score: Number(values.get("score")),
      revenue: Number(values.get("revenue")),
      primary_objection: String(values.get("objection")),
      happened_at: new Date().toISOString(),
    };
    if (isDemo) setCalls((current) => [next, ...current]);
    else if (supabase && session) {
      const { error } = await supabase
        .from("sales_calls")
        .insert({
          user_id: session.user.id,
          prospect_name: next.prospect_name,
          rep_name: next.rep_name,
          outcome: next.outcome,
          score: next.score,
          revenue: next.revenue,
          primary_objection: next.primary_objection,
          happened_at: next.happened_at,
        });
      if (error) {
        setNotice(error.message);
        return;
      }
      await loadLiveData();
    }
    setModal(null);
    setNotice("Sales call logged.");
  }

  async function submitEod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (!isDemo && supabase && session) {
      const { error } = await supabase
        .from("sales_eod_reports")
        .upsert(
          {
            user_id: session.user.id,
            report_date: new Date().toISOString().slice(0, 10),
            wins: values.wins,
            blockers: values.blockers,
            priorities: values.priorities,
            calls_taken: Number(values.calls_taken),
            closes: Number(values.closes),
            revenue: Number(values.revenue),
          },
          { onConflict: "user_id,report_date" },
        );
      if (error) {
        setNotice(error.message);
        return;
      }
    }
    setModal(null);
    setNotice("End-of-day report saved.");
  }

  if (!authReady)
    return (
      <div className="center-screen">
        <LoaderCircle className="spin" /> Preparing your workspace…
      </div>
    );
  if (!isDemo && !session)
    return <LoginPanel onDemo={() => setForceDemo(true)} />;

  const metaConnection = connections.find((c) => c.provider === "meta");
  const clickupConnection = connections.find((c) => c.provider === "clickup");

  return (
    <main className="app-frame">
      <aside className="sidebar">
        <div className="brand-mark">
          <Sparkles size={18} />
        </div>
        <div className="brand-copy">
          <strong>Operator AI</strong>
          <span>Command center</span>
        </div>
        <nav className="workspace-nav" aria-label="AI workspaces">
          <p>Workspaces</p>
          <button
            className={workspace === "sales" ? "active" : ""}
            onClick={() => {
              setWorkspace("sales");
              setView("overview");
            }}
          >
            <Bot size={18} />
            <span>
              <b>AI Sales Manager</b>
              <small>Coach & convert</small>
            </span>
            <ChevronRight size={16} />
          </button>
          <button
            className={workspace === "media" ? "active" : ""}
            onClick={() => {
              setWorkspace("media");
              setView("overview");
            }}
          >
            <Megaphone size={18} />
            <span>
              <b>AI Media Buyer</b>
              <small>Analyze & scale</small>
            </span>
            <ChevronRight size={16} />
          </button>
        </nav>
        <nav className="section-nav" aria-label="Workspace views">
          <button
            className={view === "overview" ? "active" : ""}
            onClick={() => setView("overview")}
          >
            <LayoutDashboard size={16} /> Overview
          </button>
          <button
            className={view === "records" ? "active" : ""}
            onClick={() => setView("records")}
          >
            <History size={16} />{" "}
            {workspace === "sales" ? "Call log" : "Campaigns"}
          </button>
          {workspace === "sales" && (
            <button
              className={view === "pipeline" ? "active" : ""}
              onClick={() => setView("pipeline")}
            >
              <TrendingUp size={16} /> GHL & grading
            </button>
          )}
          {workspace === "sales" && (
            <button
              className={view === "charles" ? "active" : ""}
              onClick={() => setView("charles")}
            >
              <Bot size={16} /> Charles
            </button>
          )}
          {workspace === "sales" && (
            <button
              className={view === "team" ? "active" : ""}
              onClick={() => setView("team")}
            >
              <Users size={16} /> Team
            </button>
          )}
          {workspace === "media" && (
            <button
              className={view === "media-tools" ? "active" : ""}
              onClick={() => setView("media-tools")}
            >
              <WandSparkles size={16} /> AI tools
            </button>
          )}
          {workspace === "media" && (
            <button
              className={view === "media-structure" ? "active" : ""}
              onClick={() => setView("media-structure")}
            >
              <BarChart3 size={16} /> Account structure
            </button>
          )}
          {workspace === "media" && (
            <button
              className={view === "media-history" ? "active" : ""}
              onClick={() => setView("media-history")}
            >
              <History size={16} /> Tool history
            </button>
          )}
          <button
            className={view === "integrations" ? "active" : ""}
            onClick={() => setView("integrations")}
          >
            <PlugZap size={16} /> Integrations
          </button>
        </nav>
        <div className="sidebar-foot">
          <button onClick={() => setView("integrations")}>
            <Settings size={17} /> Integration setup
          </button>
          <div>
            <span className="demo-dot" />{" "}
            {isDemo ? "Demo data active" : session?.user.email}
          </div>
          {session && (
            <button onClick={() => void supabase?.auth.signOut()}>
              <LogOut size={15} /> Sign out
            </button>
          )}
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              {workspace === "sales" ? "Sales operations" : "Paid acquisition"}
            </span>
            <h1>
              {workspace === "sales" ? "AI Sales Manager" : "AI Media Buyer"}
            </h1>
          </div>
          <div className="top-actions">
            {workspace === "sales" ? (
              <button
                className="quiet-btn action-secondary"
                onClick={() => setModal("call")}
              >
                <FileText size={17} /> Log call
              </button>
            ) : (
              <button
                className="quiet-btn action-secondary"
                disabled={busy}
                onClick={() => void syncMeta()}
              >
                <RefreshCw className={busy ? "spin" : ""} size={17} /> Sync Meta
              </button>
            )}
            <button
              className="quiet-btn integration-top"
              onClick={() => setView("integrations")}
            >
              <PlugZap size={17} />
              <span>Integrations</span>
            </button>
            <button
              className="primary-btn"
              onClick={() => {
                setResult("");
                setModal("ask");
              }}
            >
              <MessageSquareText size={17} /> Ask your AI
            </button>
          </div>
        </header>
      {notice && (
          <div className="notice" role="status">
            <Check size={16} />
            <span>{notice}</span>
            <button onClick={() => setNotice(null)}>
              <X size={15} />
            </button>
          </div>
      )}
      <div className="content-wrap">
        <nav className="mobile-view-nav" aria-label="Current workspace views">
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>Overview</button>
          <button className={view === "records" ? "active" : ""} onClick={() => setView("records")}>{workspace === "sales" ? "Calls" : "Campaigns"}</button>
          {workspace === "sales" && <button className={view === "pipeline" ? "active" : ""} onClick={() => setView("pipeline")}>GHL & grading</button>}
          {workspace === "sales" && <button className={view === "charles" ? "active" : ""} onClick={() => setView("charles")}>Charles</button>}
          {workspace === "sales" && <button className={view === "team" ? "active" : ""} onClick={() => setView("team")}>Team</button>}
          {workspace === "media" && <button className={view === "media-tools" ? "active" : ""} onClick={() => setView("media-tools")}>AI tools</button>}
          {workspace === "media" && <button className={view === "media-structure" ? "active" : ""} onClick={() => setView("media-structure")}>Structure</button>}
          {workspace === "media" && <button className={view === "media-history" ? "active" : ""} onClick={() => setView("media-history")}>History</button>}
          <button className={view === "integrations" ? "active" : ""} onClick={() => setView("integrations")}>Integrations</button>
        </nav>
        {view === "overview" && (
            <>
              <section className="hero-card">
                <div className="hero-copy">
                  <span className="status-pill">
                    <span /> {isDemo ? "SAMPLE BRIEF" : "LIVE BRIEF"}
                  </span>
                  <h2>
                    {workspace === "sales"
                      ? salesSummary.closeRate >= 25
                        ? "Your team is pacing ahead of target."
                        : "The close rate needs a focused coaching pass."
                      : mediaSummary.roas >= 2.5
                        ? "Efficiency is stable. Your winners are ready to scale."
                        : "Protect budget while the next creative test learns."}
                  </h2>
                  <p>
                    {workspace === "sales"
                      ? `Charles reviewed ${calls.length} recent calls and found the clearest opportunity in objection handling and follow-up.`
                      : `The AI Media Buyer reviewed ${campaigns.length} campaigns and classified each one as scale, iterate, or kill.`}
                  </p>
                  <button
                    onClick={() => {
                      setResult("");
                      setModal("ask");
                    }}
                  >
                    Open the full brief <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="hero-score">
                  <span>
                    {workspace === "sales"
                      ? salesSummary.score.toFixed(0)
                      : `${mediaSummary.roas.toFixed(1)}x`}
                  </span>
                  <small>
                    {workspace === "sales" ? "TEAM CALL SCORE" : "BLENDED ROAS"}
                  </small>
                  <div>
                    <Check size={14} />{" "}
                    {workspace === "sales" && salesSummary.score < 75
                      ? "Watch"
                      : "Healthy"}
                  </div>
                </div>
              </section>
              <section className="metrics-grid">
                {metrics.map((metric) => (
                  <article className="metric-card" key={metric.label}>
                    <div>
                      <span>{metric.label}</span>
                      <metric.icon size={17} />
                    </div>
                    <strong>{metric.value}</strong>
                    <small>{metric.detail}</small>
                  </article>
                ))}
              </section>
              {workspace === "sales" ? (
                <SalesOverview
                  calls={calls}
                  recommendations={salesRecommendations}
                  onEod={() => setModal("eod")}
                />
              ) : (
                <MediaOverview
                  campaigns={campaigns}
                  onTool={(tool) => {
                    setActiveTool(tool);
                    setView("media-tools");
                  }}
                />
              )}
            </>
          )}
          {view === "records" &&
            (workspace === "sales" ? (
              <CallLog calls={calls} onAdd={() => setModal("call")} />
            ) : (
              <CampaignTable
                campaigns={campaigns}
                onSync={() => void syncMeta()}
                busy={busy}
              />
            ))}
          {workspace === "sales" &&
            ["pipeline", "charles", "team"].includes(view) && (
              <SalesManagerModule
                module={view as SalesModule}
                isDemo={isDemo}
              />
            )}
          {workspace === "media" &&
            ["media-tools", "media-structure", "media-history"].includes(
              view,
            ) && (
              <MediaBuyerModule
                key={`${view}-${activeTool}`}
                module={view as MediaModule}
                isDemo={isDemo}
                initialTool={activeTool}
              />
            )}
          {view === "integrations" && (
            <>
              <Integrations
                isDemo={isDemo}
                meta={metaConnection}
                clickup={clickupConnection}
                clickupListId={clickupListId}
                busy={busy}
                onListIdChange={setClickupListId}
                onSaveList={saveClickUpList}
                onConnect={connect}
                onSync={syncMeta}
                onClickUpTest={testClickUp}
              />
              {workspace === "sales" && (
                <div className="sales-settings-wrap">
                  <SalesManagerModule module="sales-settings" isDemo={isDemo} />
                </div>
              )}
              {workspace === "media" && (
                <div className="sales-settings-wrap">
                  <MediaBuyerModule
                    module="media-settings"
                    isDemo={isDemo}
                    onConnectMeta={() => void connect("meta")}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </section>
      {modal && (
        <ModalFrame
          title={
            modal === "call"
              ? "Log a sales call"
              : modal === "eod"
                ? "Submit end-of-day report"
                : modal === "tool"
                  ? (mediaTools.find((item) => item.key === activeTool)
                      ?.title ?? "Media Buyer tool")
                  : `Ask ${workspace === "sales" ? "Charles" : "AI Media Buyer"}`
          }
          onClose={() => setModal(null)}
        >
          {modal === "call" && <CallForm onSubmit={submitCall} />}
          {modal === "eod" && <EodForm onSubmit={submitEod} />}
          {(modal === "ask" || modal === "tool") && (
            <AssistantForm
              workspace={workspace}
              tool={modal === "tool" ? activeTool : undefined}
              prompt={prompt}
              result={result}
              busy={busy}
              onPrompt={setPrompt}
              onRun={() =>
                void runAssistant(modal === "tool" ? activeTool : undefined)
              }
            />
          )}
        </ModalFrame>
      )}
    </main>
  );
}

function SalesOverview({
  calls,
  recommendations,
  onEod,
}: {
  calls: SalesCall[];
  recommendations: { title: string; meta: string; tone: string }[];
  onEod: () => void;
}) {
  return (
    <section className="lower-grid">
      <article className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">AI RECOMMENDATIONS</span>
            <h3>What needs attention</h3>
          </div>
          <button onClick={onEod}>Submit EOD</button>
        </div>
        {recommendations.map((item, index) => (
          <div className="signal-row" key={item.title}>
            <span className={`signal-number ${item.tone}`}>{index + 1}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.meta}</small>
            </div>
            <ChevronRight size={17} />
          </div>
        ))}
      </article>
      <article className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">RECENT CALLS</span>
            <h3>Coaching pulse</h3>
          </div>
          <Activity size={18} />
        </div>
        {calls.slice(0, 4).map((call) => (
          <div className="mini-record" key={call.id}>
            <div>
              <strong>{call.prospect_name}</strong>
              <small>
                {call.rep_name} · {outcomeLabel(call.outcome)}
              </small>
            </div>
            <span
              className={
                call.score >= 85 ? "good" : call.score >= 75 ? "warn" : "bad"
              }
            >
              {call.score}
            </span>
          </div>
        ))}
      </article>
    </section>
  );
}

function MediaOverview({
  campaigns,
  onTool,
}: {
  campaigns: Campaign[];
  onTool: (key: ToolKey) => void;
}) {
  return (
    <>
      <section className="tool-grid">
        {mediaTools.map((tool) => (
          <button key={tool.key} onClick={() => onTool(tool.key)}>
            <span>
              <tool.icon size={19} />
            </span>
            <div>
              <strong>{tool.title}</strong>
              <small>{tool.detail}</small>
            </div>
            <ChevronRight size={17} />
          </button>
        ))}
      </section>
      <section className="panel table-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">BUDGET MOVES</span>
            <h3>Campaign decisions</h3>
          </div>
          <span className="freshness">Updated just now</span>
        </div>
        <CampaignRows campaigns={campaigns.slice(0, 4)} />
      </section>
    </>
  );
}

function CampaignRows({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <div className="campaign-list">
      {campaigns.map((campaign) => {
        const metric = metricFor(campaign);
        const rec = recommendationFor(campaign);
        return (
          <div className="campaign-row" key={campaign.id}>
            <div className="campaign-name">
              <span
                className={
                  campaign.status === "ACTIVE" ? "live-dot" : "paused-dot"
                }
              />
              <div>
                <strong>{campaign.campaign_name}</strong>
                <small>
                  {campaign.status} · {compact.format(campaign.impressions)}{" "}
                  impressions
                </small>
              </div>
            </div>
            <div>
              <small>Spend</small>
              <strong>{money.format(campaign.spend)}</strong>
            </div>
            <div>
              <small>CPL</small>
              <strong>{money.format(metric.cpl)}</strong>
            </div>
            <div>
              <small>ROAS</small>
              <strong>{metric.roas.toFixed(1)}x</strong>
            </div>
            <div className={`decision ${rec.tone}`}>
              <b>{rec.action}</b>
              <small>{rec.detail}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CallLog({ calls, onAdd }: { calls: SalesCall[]; onAdd: () => void }) {
  return (
    <section className="panel records-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">SALES RECORDS</span>
          <h3>Call log</h3>
        </div>
        <button className="small-primary" onClick={onAdd}>
          + Log call
        </button>
      </div>
      <div className="data-table">
        <div className="data-row header">
          <span>Prospect</span>
          <span>Rep</span>
          <span>Outcome</span>
          <span>Objection</span>
          <span>Revenue</span>
          <span>Score</span>
        </div>
        {calls.map((call) => (
          <div className="data-row" key={call.id}>
            <span>
              <b>{call.prospect_name}</b>
              <small>{new Date(call.happened_at).toLocaleDateString()}</small>
            </span>
            <span>{call.rep_name}</span>
            <span>
              <i className={`outcome ${call.outcome}`}>
                {outcomeLabel(call.outcome)}
              </i>
            </span>
            <span>{call.primary_objection || "—"}</span>
            <span>{money.format(call.revenue)}</span>
            <span>
              <b
                className={
                  call.score >= 85
                    ? "text-good"
                    : call.score >= 75
                      ? "text-warn"
                      : "text-bad"
                }
              >
                {call.score}
              </b>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CampaignTable({
  campaigns,
  onSync,
  busy,
}: {
  campaigns: Campaign[];
  onSync: () => void;
  busy: boolean;
}) {
  return (
    <section className="panel records-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">META ADS MANAGER</span>
          <h3>Campaign performance</h3>
        </div>
        <button className="small-primary" onClick={onSync} disabled={busy}>
          <RefreshCw className={busy ? "spin" : ""} size={14} /> Refresh
        </button>
      </div>
      <CampaignRows campaigns={campaigns} />
    </section>
  );
}

function Integrations({
  isDemo,
  meta,
  clickup,
  clickupListId,
  busy,
  onListIdChange,
  onSaveList,
  onConnect,
  onSync,
  onClickUpTest,
}: {
  isDemo: boolean;
  meta?: Connection;
  clickup?: Connection;
  clickupListId: string;
  busy: boolean;
  onListIdChange: (value: string) => void;
  onSaveList: () => void;
  onConnect: (p: "clickup" | "meta") => void;
  onSync: (createTask?: boolean) => void;
  onClickUpTest: () => void;
}) {
  const listName =
    typeof clickup?.metadata?.list_name === "string"
      ? clickup.metadata.list_name
      : null;
  return (
    <section>
      <div className="section-heading">
        <span className="eyebrow">CONNECTIONS</span>
        <h2>Bring your operating data together.</h2>
        <p>
          Tokens stay on the server. The browser receives connection status,
          destination, and account names only.
        </p>
      </div>
      <div className="integration-grid">
        <IntegrationCard
          name="Meta Ads Manager"
          description="Read campaign structure and performance, then create scale, iterate, or kill recommendations."
          connected={meta?.status === "connected"}
          account={meta?.account_name}
          color="meta"
          onConnect={() => onConnect("meta")}
          actionLabel="Sync campaigns"
          onAction={() => onSync(false)}
          secondActionLabel="Sync + create ClickUp brief"
          onSecondAction={() => onSync(true)}
          busy={busy}
        />
        <IntegrationCard
          name="ClickUp"
          description="Create connection checks and paid-media briefs as tasks in the List you choose."
          connected={clickup?.status === "connected"}
          account={clickup?.account_name}
          color="clickup"
          onConnect={() => onConnect("clickup")}
          actionLabel="Create test task"
          onAction={onClickUpTest}
          busy={busy}
        >
          {clickup?.status === "connected" && (
            <div className="destination-setup">
              <label>
                Destination List ID
                <input
                  value={clickupListId}
                  onChange={(event) => onListIdChange(event.target.value)}
                  placeholder="e.g. 901234567890"
                />
              </label>
              <button
                className="quiet-btn"
                disabled={busy || !clickupListId.trim()}
                onClick={onSaveList}
              >
                Save List
              </button>
              {listName && <small>Selected: {listName}</small>}
            </div>
          )}
        </IntegrationCard>
      </div>
      {isDemo && (
        <div className="setup-note">
          <Zap size={18} />
          <div>
            <strong>You are viewing safe sample data.</strong>
            <p>
              Use the step-by-step README in this folder to create the Supabase
              project, then connect your own ClickUp and Meta apps.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function IntegrationCard({
  name,
  description,
  connected,
  account,
  color,
  onConnect,
  actionLabel,
  onAction,
  secondActionLabel,
  onSecondAction,
  busy,
  children,
}: {
  name: string;
  description: string;
  connected: boolean;
  account?: string | null;
  color: string;
  onConnect: () => void;
  actionLabel: string;
  onAction: () => void;
  secondActionLabel?: string;
  onSecondAction?: () => void;
  busy: boolean;
  children?: React.ReactNode;
}) {
  return (
    <article className="integration-card">
      <div className={`integration-logo ${color}`}>{name[0]}</div>
      <div className={`connection-pill ${connected ? "connected" : ""}`}>
        <span /> {connected ? "Connected" : "Not connected"}
      </div>
      <h3>{name}</h3>
      <p>{description}</p>
      <div className="account-name">
        {connected ? account || "Connected account" : "No account selected"}
      </div>
      {children}
      <div className="integration-actions">
        <button className="primary-btn" onClick={onConnect}>
          {connected ? "Reconnect" : `Connect ${name}`}
        </button>
        {connected && (
          <button className="quiet-btn" onClick={onAction} disabled={busy}>
            {actionLabel}
          </button>
        )}
        {connected && secondActionLabel && onSecondAction && (
          <button
            className="quiet-btn"
            onClick={onSecondAction}
            disabled={busy}
          >
            {secondActionLabel}
          </button>
        )}
      </div>
    </article>
  );
}

function LoginPanel({ onDemo }: { onDemo: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (authError) setError(authError.message);
    else setSent(true);
  }
  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="brand-mark">
          <Sparkles size={18} />
        </div>
        <span className="eyebrow">OPERATOR AI</span>
        <h1>
          Two operators.
          <br />
          One command center.
        </h1>
        <p>
          Sign in to connect your sales data, Meta Ads account, and ClickUp
          workspace.
        </p>
        {sent ? (
          <div className="email-sent">
            <Send size={20} />
            <strong>Check your inbox</strong>
            <span>We sent a secure sign-in link to {email}.</span>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              Email address
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </label>
            {error && <small className="form-error">{error}</small>}
            <button className="primary-btn" type="submit">
              Send sign-in link
            </button>
          </form>
        )}
        <button className="demo-link" onClick={onDemo}>
          Preview with sample data <ArrowUpRight size={14} />
        </button>
      </section>
    </main>
  );
}

function ModalFrame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <span className="eyebrow">OPERATOR WORKFLOW</span>
            <h2>{title}</h2>
          </div>
          <button aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function CallForm({
  onSubmit,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="form-stack" onSubmit={onSubmit}>
      <div className="form-grid">
        <label>
          Prospect
          <input required name="prospect" placeholder="Company or prospect" />
        </label>
        <label>
          Sales rep
          <input required name="rep" placeholder="Rep name" />
        </label>
        <label>
          Outcome
          <select name="outcome" defaultValue="follow_up">
            <option value="won">Won</option>
            <option value="follow_up">Follow-up</option>
            <option value="lost">Lost</option>
            <option value="no_show">No-show</option>
          </select>
        </label>
        <label>
          Call score
          <input
            required
            name="score"
            type="number"
            min="0"
            max="100"
            defaultValue="80"
          />
        </label>
        <label>
          Revenue
          <input
            name="revenue"
            type="number"
            min="0"
            step="0.01"
            defaultValue="0"
          />
        </label>
        <label>
          Primary objection
          <input name="objection" placeholder="Price, timing, trust…" />
        </label>
      </div>
      <button className="primary-btn wide" type="submit">
        Save call
      </button>
    </form>
  );
}

function EodForm({
  onSubmit,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="form-stack" onSubmit={onSubmit}>
      <div className="form-grid three">
        <label>
          Calls taken
          <input
            required
            name="calls_taken"
            type="number"
            min="0"
            defaultValue="0"
          />
        </label>
        <label>
          Closes
          <input
            required
            name="closes"
            type="number"
            min="0"
            defaultValue="0"
          />
        </label>
        <label>
          Revenue
          <input
            required
            name="revenue"
            type="number"
            min="0"
            defaultValue="0"
          />
        </label>
      </div>
      <label>
        Wins
        <textarea required name="wins" placeholder="What worked today?" />
      </label>
      <label>
        Blockers
        <textarea required name="blockers" placeholder="What got in the way?" />
      </label>
      <label>
        Tomorrow’s priorities
        <textarea
          required
          name="priorities"
          placeholder="Top follow-ups and coaching focus"
        />
      </label>
      <button className="primary-btn wide" type="submit">
        Save EOD report
      </button>
    </form>
  );
}

function AssistantForm({
  workspace,
  tool,
  prompt,
  result,
  busy,
  onPrompt,
  onRun,
}: {
  workspace: Workspace;
  tool?: ToolKey;
  prompt: string;
  result: string;
  busy: boolean;
  onPrompt: (value: string) => void;
  onRun: () => void;
}) {
  const toolItem = mediaTools.find((item) => item.key === tool);
  return (
    <div className="assistant-form">
      <div className="assistant-intro">
        <div>
          <Sparkles size={19} />
        </div>
        <p>
          {toolItem?.detail ??
            (workspace === "sales"
              ? "Ask Charles about your calls, objections, coaching priorities, or next revenue move."
              : "Ask for a decision-ready analysis of your campaign performance.")}
        </p>
      </div>
      {tool !== "audit" && (
        <label>
          {tool === "spy"
            ? "Competitor, brand, or keyword"
            : tool === "script"
              ? "Offer and audience"
              : tool === "draft"
                ? "Campaign brief"
                : "Your question"}
          <textarea
            value={prompt}
            onChange={(event) => onPrompt(event.target.value)}
            placeholder={
              tool === "spy"
                ? "e.g. appointment-setting software"
                : tool === "script"
                  ? "Describe the offer, audience, proof, and desired CTA"
                  : tool === "draft"
                    ? "Campaign name, offer, audience, budget, destination URL"
                    : "What should I focus on this week?"
            }
          />
        </label>
      )}
      <button className="primary-btn wide" disabled={busy} onClick={onRun}>
        {busy ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <Sparkles size={17} />
        )}{" "}
        {busy ? "Analyzing…" : "Run analysis"}
      </button>
      {result && <pre className="assistant-result">{result}</pre>}
    </div>
  );
}
