import {
  adminClient,
  authorizeUser,
  corsHeaders,
  json,
} from "../_shared/supabase.ts";

type Admin = ReturnType<typeof adminClient>;
type Row = Record<string, unknown>;

const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v24.0";
const toolActions = new Set([
  "audit-ad-account",
  "spy-ads",
  "script-ads",
  "launch-meta-ads",
  "list-meta-structure",
  "preview-meta-ad",
]);
const countries = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "GB",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { user } = await authorizeUser(req);
  if (!user) return json({ error: "Sign in is required." }, 401);
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    input?: Row;
  };
  const action = String(body.action ?? "state");
  const input = body.input ?? {};
  const admin = adminClient();
  await admin
    .from("media_buyer_settings")
    .upsert(
      { user_id: user.id },
      { onConflict: "user_id", ignoreDuplicates: true },
    );

  try {
    if (action === "state") return json(await state(admin, user.id));
    if (action === "select-account") {
      return json(await selectAccount(admin, user.id, input));
    }
    if (action === "disconnect-meta") {
      return json(await disconnectMeta(admin, user.id));
    }
    if (action === "set-enabled") {
      return json(await setEnabled(admin, user.id, input));
    }
    if (action === "save-ai") {
      return json(await saveAi(admin, user.id, input));
    }
    if (action === "remove-ai") {
      return json(await removeAi(admin, user.id));
    }
    if (action === "history") return json(await history(admin, user.id));
    if (action === "drafts") return json(await drafts(admin, user.id));
    if (action === "send-clickup") {
      return json(await sendClickUp(admin, user.id, input));
    }
    if (!toolActions.has(action)) {
      return json({ error: "Unsupported Media Buyer action." }, 400);
    }

    const credentials = await metaCredentials(admin, user.id);
    if (!credentials.token || !credentials.accountId) {
      return json(
        { error: "Connect and select a Meta ad account first." },
        409,
      );
    }
    const { data: settings } = await admin
      .from("media_buyer_settings")
      .select("tools_enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    if (settings?.tools_enabled === false) {
      return json({ error: "Media Buyer tools are disabled." }, 403);
    }

    let result: Row;
    if (action === "audit-ad-account") {
      result = await auditAccount(admin, user.id, credentials);
    } else if (action === "spy-ads") {
      result = await spyAds(credentials.token, input);
    } else if (action === "script-ads") {
      result = await scriptAds(admin, user.id, input);
    } else if (action === "launch-meta-ads") {
      const draft = await createMetaDraft(
        admin,
        user.id,
        credentials.token,
        credentials.accountId,
        input,
      );
      if (!draft.ok) return json(draft, 502);
      result = draft;
    } else if (action === "list-meta-structure") {
      result = await listStructure(credentials.token, credentials.accountId);
    } else result = await previewAd(credentials.token, input);

    const saved = await saveRun(
      admin,
      user.id,
      credentials.accountId,
      action,
      input,
      result,
    );
    return json({ ...result, historySaved: saved.ok, historyId: saved.id });
  } catch (error) {
    console.error("media-buyer-tools", action, error);
    return json(
      {
        error: error instanceof Error
          ? error.message
          : "The Media Buyer action could not be completed.",
      },
      502,
    );
  }
});

async function state(admin: Admin, userId: string) {
  const [{ data: meta }, { data: ai }, { data: settings }] = await Promise.all([
    admin
      .from("integration_connections")
      .select("status,account_id,account_name,metadata,refreshed_at")
      .eq("user_id", userId)
      .eq("provider", "meta")
      .maybeSingle(),
    admin
      .from("integration_connections")
      .select("status,account_name,metadata")
      .eq("user_id", userId)
      .eq("provider", "ai")
      .maybeSingle(),
    admin
      .from("media_buyer_settings")
      .select("tools_enabled,review_policy")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const accounts = Array.isArray(meta?.metadata?.accounts)
    ? meta.metadata.accounts
      .filter((value: unknown) => value && typeof value === "object")
      .map((value: unknown) => {
        const account = value as Row;
        return {
          id: cleanAccountId(account.id),
          name: shortText(account.name, 200),
          currency: shortText(account.currency, 3),
          timezone: shortText(account.timezone_name, 100),
        };
      })
      .filter((account: { id: string }) => account.id)
    : [];
  return { ok: true, meta: meta ? { ...meta, accounts } : null, ai, settings };
}

async function selectAccount(admin: Admin, userId: string, input: Row) {
  const accountId = cleanAccountId(input.accountId);
  const { data: connection } = await admin
    .from("integration_connections")
    .select("metadata")
    .eq("user_id", userId)
    .eq("provider", "meta")
    .maybeSingle();
  const accounts = Array.isArray(connection?.metadata?.accounts)
    ? (connection.metadata.accounts as Row[])
    : [];
  const selected = accounts.find(
    (account) => cleanAccountId(account.id) === accountId,
  );
  if (!accountId || !selected) {
    throw new Error("Choose an ad account returned by Meta.");
  }
  const metadata = {
    ...(connection?.metadata ?? {}),
    currency: shortText(selected.currency, 3) ?? "USD",
    timezone: shortText(selected.timezone_name, 100),
  };
  const { error } = await admin
    .from("integration_connections")
    .update({
      account_id: accountId,
      account_name: shortText(selected.name, 200) ?? `Ad account ${accountId}`,
      metadata,
      refreshed_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "meta");
  if (error) throw error;
  return { ok: true, accountId, accountName: selected.name ?? accountId };
}

async function disconnectMeta(admin: Admin, userId: string) {
  await admin.rpc("clear_integration_secret", {
    p_user: userId,
    p_provider: "meta",
  });
  const { error } = await admin
    .from("integration_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", "meta");
  if (error) throw error;
  return { ok: true };
}

async function setEnabled(admin: Admin, userId: string, input: Row) {
  if (typeof input.enabled !== "boolean") {
    throw new Error("Enabled must be true or false.");
  }
  const { error } = await admin
    .from("media_buyer_settings")
    .upsert(
      { user_id: userId, tools_enabled: input.enabled },
      { onConflict: "user_id" },
    );
  if (error) throw error;
  return { ok: true, enabled: input.enabled };
}

async function saveAi(admin: Admin, userId: string, input: Row) {
  const provider = String(input.provider ?? "openai");
  const apiKey = String(input.apiKey ?? "").trim();
  const model = String(input.model ?? "").trim();
  if (
    !new Set(["openai", "glm"]).has(provider) || apiKey.length < 12 || !model
  ) {
    throw new Error("Enter a supported AI provider, model, and API key.");
  }
  const { error } = await admin.rpc("set_integration_secret", {
    p_user: userId,
    p_provider: "ai",
    p_secret: JSON.stringify({ provider, apiKey, model }),
  });
  if (error) throw error;
  const { error: connectionError } = await admin
    .from("integration_connections")
    .upsert({
      user_id: userId,
      provider: "ai",
      status: "connected",
      account_id: provider,
      account_name: provider === "glm" ? "GLM / Z.ai" : "OpenAI",
      metadata: { provider, model, last4: apiKey.slice(-4) },
      refreshed_at: new Date().toISOString(),
    });
  if (connectionError) throw connectionError;
  return { ok: true };
}

async function removeAi(admin: Admin, userId: string) {
  await admin.rpc("clear_integration_secret", {
    p_user: userId,
    p_provider: "ai",
  });
  await admin
    .from("integration_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", "ai");
  return { ok: true };
}

async function history(admin: Admin, userId: string) {
  const { data, error } = await admin
    .from("media_buyer_tool_runs")
    .select("id,ad_account_id,action,input,result,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return { ok: true, runs: data ?? [] };
}

async function drafts(admin: Admin, userId: string) {
  const { data, error } = await admin
    .from("meta_draft_records")
    .select(
      "id,ad_account_id,campaign_id,adset_id,creative_id,ad_id,status,brief,error_message,created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return { ok: true, drafts: data ?? [] };
}

async function metaCredentials(admin: Admin, userId: string) {
  const [{ data: connection }, { data: token }] = await Promise.all([
    admin
      .from("integration_connections")
      .select("account_id,account_name,metadata")
      .eq("user_id", userId)
      .eq("provider", "meta")
      .maybeSingle(),
    admin.rpc("get_integration_secret", {
      p_user: userId,
      p_provider: "meta",
    }),
  ]);
  return {
    token: typeof token === "string" ? token : "",
    accountId: cleanAccountId(connection?.account_id),
    accountName: connection?.account_name ?? "Meta Ads",
    currency: typeof connection?.metadata?.currency === "string"
      ? connection.metadata.currency
      : "USD",
  };
}

async function graph(
  token: string,
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "GET",
) {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path}`);
  const options: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(25000),
  };
  if (method === "GET") url.search = new URLSearchParams(params).toString();
  else {
    options.headers = {
      ...options.headers,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    options.body = new URLSearchParams(params);
  }
  const response = await fetch(url, options);
  const payload = (await response.json().catch(() => ({}))) as Row;
  if (!response.ok) {
    throw new Error(
      shortText((payload.error as Row | undefined)?.message, 500) ??
        `Meta request failed (${response.status}).`,
    );
  }
  return payload;
}

async function listStructure(token: string, accountId: string) {
  const account = `act_${accountId}`;
  const metricFields =
    "campaign_id,adset_id,ad_id,spend,impressions,clicks,ctr,cpc,actions,action_values";
  const [campaigns, adSets, ads, campaignMetrics, adSetMetrics, adMetrics] =
    await Promise.all([
      graph(token, `${account}/campaigns`, {
        fields: "id,name,status,effective_status,objective,daily_budget",
        limit: "100",
      }),
      graph(token, `${account}/adsets`, {
        fields:
          "id,name,status,effective_status,daily_budget,campaign_id,optimization_goal,billing_event",
        limit: "100",
      }),
      graph(token, `${account}/ads`, {
        fields: "id,name,status,effective_status,adset_id,creative{id,name}",
        limit: "100",
      }),
      graph(token, `${account}/insights`, {
        level: "campaign",
        fields: metricFields,
        date_preset: "last_7d",
        limit: "100",
      }),
      graph(token, `${account}/insights`, {
        level: "adset",
        fields: metricFields,
        date_preset: "last_7d",
        limit: "100",
      }),
      graph(token, `${account}/insights`, {
        level: "ad",
        fields: metricFields,
        date_preset: "last_7d",
        limit: "100",
      }),
    ]);
  return {
    period: "last_7d",
    campaigns: arrayData(campaigns),
    adSets: arrayData(adSets),
    ads: arrayData(ads),
    campaignMetrics: arrayData(campaignMetrics),
    adSetMetrics: arrayData(adSetMetrics),
    adMetrics: arrayData(adMetrics),
  };
}

async function auditAccount(
  admin: Admin,
  userId: string,
  credentials: Awaited<ReturnType<typeof metaCredentials>>,
) {
  const payload = await graph(
    credentials.token,
    `act_${credentials.accountId}/insights`,
    {
      fields:
        "account_currency,campaign_id,campaign_name,ad_id,ad_name,spend,impressions,clicks,actions,action_values",
      date_preset: "last_7d",
      level: "ad",
      limit: "100",
    },
  );
  const ads = arrayData(payload);
  const totals = ads.reduce<{
    spend: number;
    impressions: number;
    clicks: number;
    leads: number;
    purchases: number;
    revenue: number;
  }>(
    (sum, value) => {
      sum.spend += number(value.spend);
      sum.impressions += number(value.impressions);
      sum.clicks += number(value.clicks);
      sum.leads += actionValue(value.actions, [
        "lead",
        "onsite_conversion.lead_grouped",
        "offsite_conversion.fb_pixel_lead",
      ]);
      sum.purchases += actionValue(value.actions, [
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
      ]);
      sum.revenue += actionValue(value.action_values, [
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
      ]);
      return sum;
    },
    { spend: 0, impressions: 0, clicks: 0, leads: 0, purchases: 0, revenue: 0 },
  );
  const metrics = {
    ...totals,
    currency: credentials.currency,
    ctr: totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0,
    cpc: totals.clicks ? totals.spend / totals.clicks : 0,
    cpl: totals.leads ? totals.spend / totals.leads : null,
    cpa: totals.purchases ? totals.spend / totals.purchases : null,
    roas: totals.spend ? totals.revenue / totals.spend : 0,
  };
  const strongest = [...ads]
    .sort((left, right) =>
      actionValue(right.actions, ["purchase", "lead"]) -
      actionValue(left.actions, ["purchase", "lead"])
    )
    .slice(0, 3);
  const fallback = auditFallback(metrics, strongest);
  const generated = await aiJson(
    admin,
    userId,
    "Analyze only the supplied Meta data. Return JSON with status (green/yellow/red), report, highlights array, alerts array, next_actions array, feedback array of {status,label,detail,recommendation}, and winning_angles array of {name,source_ad,evidence,variations:[{hook,primary_text,headline,cta}]}. Never invent results.",
    JSON.stringify({ metrics, ads: ads.slice(0, 30) }),
  );
  return {
    metrics,
    adsAnalyzed: ads.length,
    analysis: validAudit(generated) ? generated : fallback,
  };
}

function auditFallback(metrics: Row, strongest: Row[]) {
  const roas = number(metrics.roas);
  const cpl = metrics.cpl === null ? null : number(metrics.cpl);
  const status = roas >= 2.5 ? "green" : roas >= 1.25 ? "yellow" : "red";
  const feedback = [
    {
      status,
      label: "Revenue efficiency",
      detail: `${roas.toFixed(2)}x tracked ROAS across the last seven days.`,
      recommendation: status === "green"
        ? "Protect the strongest ads and scale in controlled increments."
        : "Hold scaling until tracking and creative efficiency improve.",
    },
    {
      status: metrics.leads ? "green" : "yellow",
      label: "Lead signal",
      detail: metrics.leads
        ? `${metrics.leads} attributed leads at ${
          cpl === null ? "an unavailable CPL" : `${cpl.toFixed(2)} CPL`
        }.`
        : "No attributed lead events were returned.",
      recommendation:
        "Verify the event mapping and compare lead quality with CRM outcomes.",
    },
    {
      status: number(metrics.clicks) > 0 ? "green" : "red",
      label: "Traffic delivery",
      detail:
        `${metrics.clicks} clicks from ${metrics.impressions} impressions.`,
      recommendation: "Test one hook or creative variable at a time.",
    },
  ];
  return {
    status,
    report: `The account produced ${roas.toFixed(2)}x tracked ROAS from ${
      Number(metrics.spend).toFixed(2)
    } in spend. Decisions should be validated against lead quality and tracking completeness.`,
    highlights: strongest.length
      ? strongest.map((row) =>
        String(row.ad_name ?? row.campaign_name ?? "Delivered ad")
      )
      : [],
    alerts: metrics.leads
      ? []
      : ["No attributed lead signal was returned by Meta."],
    next_actions: [
      "Validate pixel/CAPI events and CRM attribution.",
      "Protect proven creative before changing budgets.",
      "Pause clear waste and test one new angle at a time.",
    ],
    feedback,
    winning_angles: [],
  };
}

async function scriptAds(admin: Admin, userId: string, input: Row) {
  const offer = requiredText(input.offer, "Offer", 4000);
  const audience = requiredText(input.audience, "Audience", 2000);
  const fallback = scriptFallback(offer, audience);
  const generated = await aiJson(
    admin,
    userId,
    "You are a Meta direct-response strategist. Return JSON with analysis, positioning, exactly three angles containing name, rationale, hook, primaryText, headline, cta, plus testingPlan and compliance string arrays. Make no unverifiable or personal-attribute claims.",
    `Offer: ${offer}\nAudience: ${audience}`,
  );
  return {
    analysis: validScript(generated) ? generated : fallback,
    generationFallback: !validScript(generated),
  };
}

function scriptFallback(offer: string, audience: string) {
  const label = offer.replace(/\s+/g, " ").slice(0, 220);
  return {
    analysis:
      "Use original, specific, educational copy. Verify every price, proof point, eligibility condition, and disclosure before publishing.",
    positioning: `Help ${
      audience.slice(0, 180)
    } understand the decision and take a low-pressure next step.`,
    angles: [
      {
        name: "Problem clarity",
        rationale:
          "Lead with the operational problem without making personal-attribute assumptions.",
        hook: "There may be a simpler way to handle this.",
        primaryText:
          `Explore a practical approach to ${label}. Review the details and decide whether the next step fits.`,
        headline: "See the practical approach",
        cta: "Learn More",
      },
      {
        name: "Proof process",
        rationale: "Explain the mechanism before asking for action.",
        hook: "A better result starts with a clearer process.",
        primaryText:
          `See how ${label} works, what to expect, and which questions to ask before moving forward.`,
        headline: "Understand the process",
        cta: "Learn More",
      },
      {
        name: "Guided next step",
        rationale: "Offer a conversation without promising an outcome.",
        hook: "Ready to review your options?",
        primaryText:
          `Get clear information about ${label} and choose the next step at your own pace.`,
        headline: "Review your options",
        cta: "Contact Us",
      },
    ],
    testingPlan: [
      "Keep audience and budget constant while testing one angle.",
      "Review qualified outcomes, not clicks alone, before scaling.",
    ],
    compliance: [
      "Verify all claims, prices, proof, and required disclosures.",
      "Avoid implying knowledge of personal attributes or guaranteed outcomes.",
    ],
  };
}

async function spyAds(token: string, input: Row) {
  const searchTerms = requiredText(input.searchTerms, "Search terms", 500);
  const country = String(input.country ?? "").toUpperCase();
  if (!countries.has(country)) {
    throw new Error(
      "Commercial Meta Ad Library API searches are limited to the EU and United Kingdom.",
    );
  }
  const libraryUrl = new URL("https://www.facebook.com/ads/library/");
  libraryUrl.search = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country,
    q: searchTerms,
    search_type: "keyword_unordered",
    media_type: "all",
  }).toString();
  try {
    const payload = await graph(
      Deno.env.get("META_AD_LIBRARY_ACCESS_TOKEN")?.trim() || token,
      "ads_archive",
      {
        search_terms: searchTerms,
        ad_reached_countries: JSON.stringify([country]),
        ad_active_status: "ACTIVE",
        ad_type: "ALL",
        fields:
          "id,page_id,page_name,ad_delivery_start_time,ad_creative_bodies,publisher_platforms",
        limit: "25",
      },
    );
    return {
      query: searchTerms,
      country,
      ads: arrayData(payload).map((row) => ({
        id: shortText(row.id, 100),
        page_id: shortText(row.page_id, 100),
        page_name: shortText(row.page_name, 300),
        ad_delivery_start_time: shortText(row.ad_delivery_start_time, 100),
        ad_creative_bodies: Array.isArray(row.ad_creative_bodies)
          ? row.ad_creative_bodies.slice(0, 10)
          : [],
        publisher_platforms: Array.isArray(row.publisher_platforms)
          ? row.publisher_platforms.slice(0, 10)
          : [],
        ad_snapshot_url: row.id
          ? `https://www.facebook.com/ads/library/?id=${
            encodeURIComponent(String(row.id))
          }`
          : null,
      })),
      libraryUrl: libraryUrl.toString(),
      apiAvailable: true,
    };
  } catch (error) {
    console.error("Meta Ad Library fallback", error);
    return {
      query: searchTerms,
      country,
      ads: [],
      libraryUrl: libraryUrl.toString(),
      apiAvailable: false,
      notice: "Open the prepared search in the public Meta Ad Library.",
    };
  }
}

async function previewAd(token: string, input: Row) {
  const adId = requiredText(input.adId, "Ad ID", 100);
  const payload = await graph(token, `${encodeURIComponent(adId)}/previews`, {
    ad_format: "MOBILE_FEED_STANDARD",
  });
  const rawBody = (arrayData(payload)[0] ?? {}).body;
  if (typeof rawBody !== "string" || !rawBody.trim()) {
    throw new Error("Meta did not return a preview for this ad.");
  }
  const body = rawBody.trim().slice(0, 500000);
  const decoded = body
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll(token, "[redacted]")
    .replaceAll(encodeURIComponent(token), "[redacted]")
    .replace(/access_token=[^&"']+/gi, "access_token=[redacted]");
  return {
    adId,
    previewHtml:
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#fff}iframe,body>div{width:100%!important;height:100%!important;border:0!important}</style></head><body>${decoded}</body></html>`,
  };
}

async function createMetaDraft(
  admin: Admin,
  userId: string,
  token: string,
  accountId: string,
  input: Row,
) {
  const campaignName = requiredText(input.campaignName, "Campaign name", 200);
  const pageId = requiredText(input.pageId, "Facebook Page ID", 100);
  if (!/^\d+$/.test(pageId)) {
    throw new Error("Enter a numeric Facebook Page ID.");
  }
  const destinationUrl = httpsUrl(input.destinationUrl, "Destination URL");
  const imageUrl = httpsUrl(input.imageUrl, "Creative image URL");
  const primaryText = requiredText(input.primaryText, "Primary text", 4000);
  const headline = requiredText(input.headline, "Headline", 255);
  const description = shortText(input.description, 500) ?? "";
  const country = String(input.country ?? "US").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new Error("Enter a two-letter country code.");
  }
  const dailyBudget = number(input.dailyBudget);
  if (dailyBudget < 1 || dailyBudget > 1000000) {
    throw new Error("Daily budget must be between 1 and 1,000,000.");
  }
  const brief = {
    campaignName,
    pageId,
    destinationUrl,
    imageUrl,
    primaryText,
    headline,
    description,
    country,
    dailyBudget,
    safety: "All entities requested with PAUSED status.",
  };
  const { data: record, error: insertError } = await admin
    .from("meta_draft_records")
    .insert({ user_id: userId, ad_account_id: accountId, brief })
    .select("id")
    .single();
  if (insertError) throw insertError;
  const ids: Row = {};
  try {
    const account = `act_${accountId}`;
    const campaign = await graph(
      token,
      `${account}/campaigns`,
      {
        name: campaignName,
        objective: "OUTCOME_TRAFFIC",
        status: "PAUSED",
        special_ad_categories: "[]",
      },
      "POST",
    );
    ids.campaignId = String(campaign.id);
    const adset = await graph(
      token,
      `${account}/adsets`,
      {
        name: `${campaignName} - Ad set`,
        campaign_id: String(campaign.id),
        daily_budget: String(Math.round(dailyBudget * 100)),
        billing_event: "IMPRESSIONS",
        optimization_goal: "LINK_CLICKS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        targeting: JSON.stringify({ geo_locations: { countries: [country] } }),
        status: "PAUSED",
      },
      "POST",
    );
    ids.adsetId = String(adset.id);
    const creative = await graph(
      token,
      `${account}/adcreatives`,
      {
        name: `${campaignName} - Creative`,
        object_story_spec: JSON.stringify({
          page_id: pageId,
          link_data: {
            link: destinationUrl,
            picture: imageUrl,
            message: primaryText,
            name: headline,
            description,
            call_to_action: {
              type: "LEARN_MORE",
              value: { link: destinationUrl },
            },
          },
        }),
      },
      "POST",
    );
    ids.creativeId = String(creative.id);
    const ad = await graph(
      token,
      `${account}/ads`,
      {
        name: `${campaignName} - Ad`,
        adset_id: String(adset.id),
        creative: JSON.stringify({ creative_id: String(creative.id) }),
        status: "PAUSED",
      },
      "POST",
    );
    ids.adId = String(ad.id);
    await admin
      .from("meta_draft_records")
      .update({
        campaign_id: ids.campaignId,
        adset_id: ids.adsetId,
        creative_id: ids.creativeId,
        ad_id: ids.adId,
        status: "created",
        error_message: null,
      })
      .eq("id", record.id);
    return {
      ok: true,
      status: "PAUSED",
      draftId: record.id,
      ...ids,
      safety:
        "Campaign, ad set, and ad were created paused. Review them in Meta before activation.",
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Meta draft creation failed.";
    await admin
      .from("meta_draft_records")
      .update({
        campaign_id: ids.campaignId ?? null,
        adset_id: ids.adsetId ?? null,
        creative_id: ids.creativeId ?? null,
        ad_id: ids.adId ?? null,
        status: Object.keys(ids).length ? "partial" : "failed",
        error_message: message.slice(0, 2000),
      })
      .eq("id", record.id);
    return {
      ok: false,
      draftId: record.id,
      ...ids,
      error:
        `${message} Any created entities remain paused; review the draft record in Meta.`,
    };
  }
}

async function saveRun(
  admin: Admin,
  userId: string,
  accountId: string,
  action: string,
  input: Row,
  result: Row,
) {
  const { data, error } = await admin
    .from("media_buyer_tool_runs")
    .insert({
      user_id: userId,
      ad_account_id: accountId,
      action,
      input,
      result,
    })
    .select("id")
    .single();
  return { ok: !error, id: data?.id ?? null };
}

async function sendClickUp(admin: Admin, userId: string, input: Row) {
  const runId = requiredText(input.runId, "Tool run", 100);
  const [{ data: run }, { data: connection }, { data: token }] = await Promise
    .all([
      admin
        .from("media_buyer_tool_runs")
        .select("action,result,created_at")
        .eq("id", runId)
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("integration_connections")
        .select("metadata")
        .eq("user_id", userId)
        .eq("provider", "clickup")
        .maybeSingle(),
      admin.rpc("get_integration_secret", {
        p_user: userId,
        p_provider: "clickup",
      }),
    ]);
  if (!run) throw new Error("Saved Media Buyer result was not found.");
  const listId = typeof connection?.metadata?.list_id === "string"
    ? connection.metadata.list_id
    : "";
  if (!token || !listId) {
    throw new Error("Connect ClickUp and select a destination List first.");
  }
  const title = `Operator AI - ${String(run.action).replaceAll("-", " ")} - ${
    new Date(run.created_at).toISOString().slice(0, 10)
  }`;
  const markdown = `## AI Media Buyer result\n\n**Tool:** ${
    String(run.action)
  }\n\n\`\`\`json\n${
    JSON.stringify(run.result, null, 2).slice(0, 20000)
  }\n\`\`\``;
  const response = await fetch(
    `https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}/task`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: title, markdown_content: markdown }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Row;
  await admin.from("clickup_task_deliveries").insert({
    user_id: userId,
    list_id: listId,
    task_kind: "media_brief",
    clickup_task_id: shortText(payload.id, 100),
    clickup_task_url: shortText(payload.url, 1000),
    status: response.ok ? "sent" : "failed",
    error_message: response.ok
      ? null
      : (shortText(payload.err, 500) ?? "ClickUp rejected the task."),
  });
  if (!response.ok) throw new Error("ClickUp rejected the task.");
  return { ok: true, taskId: payload.id, taskUrl: payload.url };
}

async function aiJson(
  admin: Admin,
  userId: string,
  instructions: string,
  input: string,
) {
  const { data: secret } = await admin.rpc("get_integration_secret", {
    p_user: userId,
    p_provider: "ai",
  });
  let config: { provider?: string; apiKey?: string; model?: string } = {};
  try {
    if (secret) config = JSON.parse(secret);
  } catch {
    // Use a project-level fallback when the account has no valid AI config.
  }
  const provider = config.provider ?? "openai";
  const apiKey = config.apiKey ??
    (provider === "glm"
      ? Deno.env.get("GLM_API_KEY")
      : Deno.env.get("OPENAI_API_KEY"));
  if (!apiKey) return null;
  const model = config.model ??
    (provider === "glm"
      ? "glm-4.5-flash"
      : (Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini"));
  try {
    let output = "";
    if (provider === "glm") {
      const response = await fetch(
        "https://api.z.ai/api/paas/v4/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: instructions },
              { role: "user", content: input.slice(0, 50000) },
            ],
            response_format: { type: "json_object" },
          }),
        },
      );
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      if (!response.ok) return null;
      output = payload.choices?.[0]?.message?.content ?? "";
    } else {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          instructions,
          input: input.slice(0, 50000),
          max_output_tokens: 1800,
        }),
      });
      const payload = (await response.json()) as { output_text?: string };
      if (!response.ok) return null;
      output = payload.output_text ?? "";
    }
    return JSON.parse(output.replace(/^```json\s*|\s*```$/g, "")) as Row;
  } catch {
    return null;
  }
}

function validAudit(value: unknown): value is Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Row;
  return (
    new Set(["green", "yellow", "red"]).has(String(row.status)) &&
    typeof row.report === "string" &&
    Array.isArray(row.highlights) &&
    Array.isArray(row.alerts) &&
    Array.isArray(row.next_actions) &&
    Array.isArray(row.feedback) &&
    Array.isArray(row.winning_angles)
  );
}

function validScript(value: unknown): value is Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Row;
  return (
    typeof row.analysis === "string" &&
    typeof row.positioning === "string" &&
    Array.isArray(row.angles) &&
    row.angles.length === 3 &&
    row.angles.every(
      (angle) =>
        angle &&
        typeof angle === "object" &&
        ["name", "rationale", "hook", "primaryText", "headline", "cta"].every(
          (key) => typeof (angle as Row)[key] === "string",
        ),
    ) &&
    Array.isArray(row.testingPlan) &&
    Array.isArray(row.compliance)
  );
}

function arrayData(payload: Row) {
  return Array.isArray(payload.data)
    ? (payload.data as Row[]).slice(0, 100)
    : [];
}

function actionValue(value: unknown, names: string[]) {
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => {
    if (!item || typeof item !== "object") return sum;
    const row = item as Row;
    return names.includes(String(row.action_type))
      ? sum + number(row.value)
      : sum;
  }, 0);
}

function shortText(value: unknown, maximum = 500) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maximum ? cleaned : null;
}

function requiredText(value: unknown, label: string, maximum = 500) {
  const cleaned = shortText(value, maximum);
  if (!cleaned) {
    throw new Error(
      `${label} is required and must be under ${maximum} characters.`,
    );
  }
  return cleaned;
}

function cleanAccountId(value: unknown) {
  const id = String(value ?? "").replace(/^act_/i, "");
  return /^\d{1,40}$/.test(id) ? id : "";
}

function httpsUrl(value: unknown, label: string) {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new Error(`${label} must be a public HTTPS URL.`);
  }
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
