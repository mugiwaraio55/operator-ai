import type { SupabaseClient } from "npm:@supabase/supabase-js@2.101.1";

export type AdminClient = SupabaseClient;

export async function ensureSalesWorkspace(
  admin: AdminClient,
  userId: string,
  email?: string | null,
) {
  const { data: existing } = await admin
    .from("charles_account_members")
    .select("owner_user_id,role,is_active")
    .eq("member_user_id", userId)
    .maybeSingle();
  if (existing) {
    if (!existing.is_active) {
      throw new Error("Your Sales Manager team access is inactive.");
    }
    return existing as {
      owner_user_id: string;
      role: "owner" | "sales_manager" | "sales_rep" | "support";
      is_active: boolean;
    };
  }
  const { error } = await admin.from("charles_account_members").insert({
    member_user_id: userId,
    owner_user_id: userId,
    role: "owner",
    invited_email: email ?? null,
  });
  if (error) throw error;
  await Promise.all([
    admin
      .from("sales_manager_settings")
      .upsert(
        { user_id: userId },
        { onConflict: "user_id", ignoreDuplicates: true },
      ),
    admin
      .from("sales_webhook_tokens")
      .upsert(
        { user_id: userId },
        { onConflict: "user_id", ignoreDuplicates: true },
      ),
  ]);
  return { owner_user_id: userId, role: "owner" as const, is_active: true };
}

export async function credentialOwner(admin: AdminClient, userId: string) {
  const member = await ensureSalesWorkspace(admin, userId);
  return member.owner_user_id;
}

export async function integrationSecret(
  admin: AdminClient,
  userId: string,
  provider: "ghl" | "ai" | "clickup" | "fathom" | "slack",
) {
  const ownerId = await credentialOwner(admin, userId);
  const { data, error } = await admin.rpc("get_integration_secret", {
    p_user: ownerId,
    p_provider: provider,
  });
  if (error) throw error;
  return { ownerId, secret: data as string | null };
}

export async function ghlCredentials(admin: AdminClient, userId: string) {
  const { ownerId, secret } = await integrationSecret(admin, userId, "ghl");
  if (!secret) return { ownerId, pit: "", locationId: "" };
  try {
    const parsed = JSON.parse(secret) as { pit?: string; locationId?: string };
    return {
      ownerId,
      pit: parsed.pit ?? "",
      locationId: parsed.locationId ?? "",
    };
  } catch {
    return { ownerId, pit: "", locationId: "" };
  }
}

export async function ghlFetch(
  pit: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
) {
  const url = new URL(`https://services.leadconnectorhq.com${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${pit}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GoHighLevel request failed (${response.status}).`);
  }
  return payload as Record<string, unknown>;
}

export async function createClickUpTask(
  admin: AdminClient,
  userId: string,
  kind: "sales_brief" | "media_brief" | "test" | "accountability" | "eod" | "command_report" | "coaching" | "transition",
  name: string,
  markdown: string,
) {
  const { ownerId, secret: token } = await integrationSecret(
    admin,
    userId,
    "clickup",
  );
  const { data: connection } = await admin
    .from("integration_connections")
    .select("metadata")
    .eq("user_id", ownerId)
    .eq("provider", "clickup")
    .maybeSingle();
  const listId = typeof connection?.metadata?.list_id === "string"
    ? connection.metadata.list_id
    : "";
  if (!token || !listId) {
    return {
      ok: false,
      error: "Connect ClickUp and select a destination List first.",
    };
  }
  const response = await fetch(
    `https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}/task`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, markdown_content: markdown }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    err?: string;
  };
  await admin.from("clickup_task_deliveries").insert({
    user_id: ownerId,
    list_id: listId,
    task_kind: kind,
    clickup_task_id: payload.id ?? null,
    clickup_task_url: payload.url ?? null,
    status: response.ok ? "sent" : "failed",
    error_message: response.ok
      ? null
      : (payload.err ?? "ClickUp rejected the task."),
  });
  return response.ok
    ? { ok: true, taskId: payload.id, taskUrl: payload.url }
    : { ok: false, error: payload.err ?? "ClickUp rejected the task." };
}

export async function postSlackMessage(
  admin: AdminClient,
  userId: string,
  channel: string,
  text: string,
) {
  const { ownerId, secret: token } = await integrationSecret(admin, userId, "slack");
  if (!token || !channel) return { ok: false, error: "Connect Slack and choose a channel first." };
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text: text.slice(0, 38000), unfurl_links: false }),
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; ts?: string };
  if (!response.ok || !payload.ok) return { ok: false, error: payload.error ?? "Slack rejected the message." };
  await admin.from("integration_connections").update({ refreshed_at: new Date().toISOString() })
    .eq("user_id", ownerId).eq("provider", "slack");
  return { ok: true, messageId: payload.ts };
}

export async function deliverSalesMessage(
  admin: AdminClient,
  ownerId: string,
  kind: "sales_brief" | "accountability" | "eod" | "command_report" | "coaching" | "transition",
  title: string,
  markdown: string,
  slackRecipient?: string | null,
) {
  const { data: settings } = await admin.from("sales_manager_settings")
    .select("delivery_channel,slack_default_channel").eq("user_id", ownerId).maybeSingle();
  const channel = String(settings?.delivery_channel ?? "clickup");
  const results: unknown[] = [];
  if (channel === "slack" || channel === "both") {
    results.push(await postSlackMessage(
      admin,
      ownerId,
      slackRecipient || String(settings?.slack_default_channel ?? ""),
      `*${title}*\n${markdown.replaceAll("## ", "*").replaceAll("**", "*")}`,
    ));
  }
  if (channel === "clickup" || channel === "both" || results.every((item) => !(item as { ok?: boolean }).ok)) {
    results.push(await createClickUpTask(admin, ownerId, kind, title, markdown));
  }
  return { ok: results.some((item) => (item as { ok?: boolean }).ok), deliveries: results };
}

export async function webhookOwner(req: Request, admin: AdminClient) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ??
    req.headers.get("x-webhook-token");
  if (token && token.length >= 32) {
    const { data } = await admin
      .from("sales_webhook_tokens")
      .select("user_id")
      .eq("token", token)
      .maybeSingle();
    if (data?.user_id) return data.user_id as string;
  }
  const shared = Deno.env.get("WEBHOOK_SECRET");
  const requestedUser = req.headers.get("x-webhook-user-id");
  if (
    shared &&
    requestedUser &&
    req.headers.get("x-webhook-secret") === shared &&
    /^[0-9a-f-]{36}$/i.test(requestedUser)
  ) {
    return requestedUser;
  }
  return null;
}

export async function verifyFathomSignature(
  admin: AdminClient,
  ownerId: string,
  req: Request,
  rawBody: string,
) {
  const { secret } = await integrationSecret(admin, ownerId, "fathom");
  if (!secret) return true;
  const messageId = req.headers.get("webhook-id") ?? "";
  const timestamp = req.headers.get("webhook-timestamp") ?? "";
  const signatureHeader = req.headers.get("webhook-signature") ?? "";
  const seconds = Number(timestamp);
  if (
    !messageId ||
    !Number.isFinite(seconds) ||
    Math.abs(Date.now() / 1000 - seconds) > 300
  ) {
    return false;
  }
  try {
    const rawKey = secret
      .replace(/^whsec_/, "")
      .replaceAll("-", "+")
      .replaceAll("_", "/");
    const encodedKey = rawKey.padEnd(
      rawKey.length + ((4 - (rawKey.length % 4)) % 4),
      "=",
    );
    const keyBytes = Uint8Array.from(
      atob(encodedKey),
      (character) => character.charCodeAt(0),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${messageId}.${timestamp}.${rawBody}`),
      ),
    );
    const expected = btoa(String.fromCharCode(...digest));
    return signatureHeader
      .split(/\s+/)
      .map((value) => value.replace(/^v1,/, ""))
      .some((value) => constantTimeEqual(value, expected));
  } catch {
    return false;
  }
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function gradeTranscript(
  admin: AdminClient,
  userId: string,
  transcript: string,
) {
  const fallback = deterministicGrade(transcript);
  const { ownerId, secret } = await integrationSecret(admin, userId, "ai");
  const [{ data: settings }, { data: documents }] = await Promise.all([
    admin
      .from("sales_manager_settings")
      .select("instructions,soul")
      .eq("user_id", ownerId)
      .maybeSingle(),
    admin
      .from("sales_os_documents")
      .select("slug,title,body_md")
      .eq("user_id", ownerId)
      .in("slug", ["sales-process", "offer", "industry-knowledge"]),
  ]);
  let config: { provider?: string; apiKey?: string; model?: string } = {};
  try {
    if (secret) config = JSON.parse(secret);
  } catch {
    /* use project fallback */
  }
  const provider = config.provider ?? "openai";
  const apiKey = config.apiKey ??
    (provider === "openai"
      ? Deno.env.get("OPENAI_API_KEY")
      : Deno.env.get("GLM_API_KEY"));
  if (!apiKey) return { ...fallback, model: null };
  try {
    const operatingContext = [
      settings?.instructions
        ? `Manager instructions:\n${settings.instructions}`
        : "",
      settings?.soul
        ? `Charles personality and standards:\n${settings.soul}`
        : "",
      ...(documents ?? []).map(
        (document) =>
          `${document.title ?? document.slug}:\n${document.body_md ?? ""}`,
      ),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 18000);
    const rubric = Object.entries(CALL_GRADING_RUBRIC)
      .map(([key, description]) => `- ${key}: ${description}`)
      .join("\n");
    const instruction = [
      "You are an elite IUL/life-insurance sales coach grading a recorded IUL Demand Capture sales call.",
      "Use only the transcript for claims about what happened on the call. Use the manager's sales process as the expected script and the rubric below as the scorecard.",
      `Rubric (score every category 0-100):\n${rubric}`,
      operatingContext ? `Sales operating context:\n${operatingContext}` : "",
      'Return only valid JSON matching this schema: {"overall_score":0,"script_adherence_pct":0,"category_scores":{},"strengths":["up to 5 short bullets"],"improvements":["up to 5 short bullets"],"coaching_notes":"2-4 specific paragraphs addressed to the rep","rep_feedback":"A short, casual manager note: what went well, 1-3 next-call actions, and encouragement."}',
      "Flag missed $45 verified-lead pricing, the $1,500 setup fee, an inaccurate Lead Integrity Guarantee, or any results guarantee. Do not invent quotes or facts.",
    ]
      .filter(Boolean)
      .join("\n\n");
    let text = "";
    const model = config.model ??
      (provider === "glm"
        ? "glm-4.5-flash"
        : (Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini"));
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
              { role: "system", content: instruction },
              { role: "user", content: transcript.slice(0, 40000) },
            ],
            response_format: { type: "json_object" },
          }),
        },
      );
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      text = payload.choices?.[0]?.message?.content ?? "";
    } else {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          instructions: instruction,
          input: transcript.slice(0, 40000),
          max_output_tokens: 1500,
        }),
      });
      const payload = (await response.json()) as { output_text?: string };
      text = payload.output_text ?? "";
    }
    const parsed = JSON.parse(
      text.replace(/^```json\s*|\s*```$/g, ""),
    ) as Record<string, unknown>;
    return {
      overall_score: bounded(parsed.overall_score, fallback.overall_score),
      script_adherence_pct: bounded(
        parsed.script_adherence_pct,
        fallback.script_adherence_pct,
      ),
      category_scores:
        typeof parsed.category_scores === "object" && parsed.category_scores
          ? parsed.category_scores
          : fallback.category_scores,
      strengths: stringArray(parsed.strengths, fallback.strengths),
      improvements: stringArray(parsed.improvements, fallback.improvements),
      coaching_notes: typeof parsed.coaching_notes === "string"
        ? parsed.coaching_notes.slice(0, 5000)
        : fallback.coaching_notes,
      rep_feedback: typeof parsed.rep_feedback === "string"
        ? parsed.rep_feedback.slice(0, 2000)
        : fallback.rep_feedback,
      model,
    };
  } catch {
    return { ...fallback, model: null };
  }
}

function bounded(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(100, number))
    : fallback;
}

function stringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value)
    ? (value.filter((item) => typeof item === "string").slice(0, 5) as string[])
    : fallback;
}

const CALL_GRADING_RUBRIC = {
  opening: "Pattern interrupt, name, purpose, and permission to continue",
  discovery:
    "State, IUL focus, current lead source, follow-up process, budget, and capacity",
  demand_capture_explanation:
    "Explains the four-step IUL Demand Capture system simply, not as a list",
  state_availability_handling:
    "Confirms or sets expectations on state capacity before promising delivery",
  pricing_disclosure:
    "Discloses $45 per verified lead and the $1,500 one-time setup fee before signup",
  setup_fee_explanation:
    "Frames the setup fee as system build, routing, campaign launch, and state controls",
  proof_usage:
    "Uses the four-step overview, verification, an ROI scenario, and approved proof assets",
  guarantee_accuracy:
    "States the Lead Integrity Guarantee accurately: credit only for failed-verification leads",
  no_results_guarantee_compliance:
    "Never guarantees appointments, applications, policies, or close rates",
  objection_handling:
    "Acknowledge, isolate, reframe, and confirm; addresses setup fee and pricing cleanly",
  close_next_step:
    "Makes a clear ask, books a demo or sends the signup link, and calendars the next step",
  crm_eod_readiness:
    "Captures enough detail for CRM and EOD reporting, including state, volume, and objections",
} as const;

function deterministicGrade(transcript: string) {
  const lower = transcript.toLowerCase();
  const has = (...terms: string[]) => terms.some((term) => lower.includes(term));
  const categories = {
    opening: has("is now a bad time", "permission", "quick question") ? 82 : 58,
    discovery: has("state", "lead source") && has("budget", "capacity") ? 84 : 60,
    demand_capture_explanation: has("four-step", "four step", "demand capture") ? 85 : 55,
    state_availability_handling: has("state availability", "state capacity", "available in your state") ? 86 : 56,
    pricing_disclosure: has("$45", "45 per", "forty-five") && has("$1,500", "1500", "one-time setup") ? 90 : 45,
    setup_fee_explanation: has("system build", "routing", "campaign launch", "state controls") ? 84 : 54,
    proof_usage: has("verification", "roi", "return on investment") ? 82 : 58,
    guarantee_accuracy: has("lead integrity guarantee", "failed verification", "lead credit") ? 88 : 56,
    no_results_guarantee_compliance: has("guaranteed appointments", "guaranteed policies", "guaranteed close") ? 20 : 90,
    objection_handling: has("understand", "is that the main", "if we solved") ? 80 : 58,
    close_next_step: has("next step", "calendar", "signup link", "book a demo") ? 86 : 52,
    crm_eod_readiness: has("state") && has("volume", "objection", "follow up") ? 82 : 58,
  };
  const values = Object.values(categories);
  const score = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    overall_score: score,
    script_adherence_pct: score,
    category_scores: categories,
    strengths: [
      categories.no_results_guarantee_compliance >= 80
        ? "Avoided making an unsupported results guarantee"
        : "Maintained a clear conversation",
    ],
    improvements: [
      categories.pricing_disclosure < 80
        ? "Disclose both the $45 verified-lead price and $1,500 setup fee before signup"
        : "Tie the pricing recap directly to the prospect's volume and capacity",
      categories.close_next_step < 80
        ? "End with one dated, owned next step"
        : "Send the agreed next step in writing immediately after the call",
    ],
    coaching_notes:
      "Use the discovery answers to connect the prospect's state, volume, follow-up capacity, and budget to the four-step system. State both pricing components before asking for commitment, explain what the setup fee builds, and close with one dated next action.",
    rep_feedback:
      "Good work keeping the conversation moving.\n• Confirm state, volume, budget, and capacity.\n• Disclose both pricing components before the close.\n• Calendar one clear next step.\nApply those on the next call.",
  };
}
