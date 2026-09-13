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
    if (!existing.is_active)
      throw new Error("Your Sales Manager team access is inactive.");
    return existing as {
      owner_user_id: string;
      role: "owner" | "sales_rep";
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
  provider: "ghl" | "ai" | "clickup" | "fathom",
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
  for (const [key, value] of Object.entries(query ?? {}))
    if (value !== undefined) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${pit}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`GoHighLevel request failed (${response.status}).`);
  return payload as Record<string, unknown>;
}

export async function createClickUpTask(
  admin: AdminClient,
  userId: string,
  kind: "sales_brief" | "test",
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
  const listId =
    typeof connection?.metadata?.list_id === "string"
      ? connection.metadata.list_id
      : "";
  if (!token || !listId)
    return {
      ok: false,
      error: "Connect ClickUp and select a destination List first.",
    };
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

export async function webhookOwner(req: Request, admin: AdminClient) {
  const url = new URL(req.url);
  const token =
    url.searchParams.get("token") ?? req.headers.get("x-webhook-token");
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
  )
    return requestedUser;
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
  )
    return false;
  try {
    const rawKey = secret
      .replace(/^whsec_/, "")
      .replaceAll("-", "+")
      .replaceAll("_", "/");
    const encodedKey = rawKey.padEnd(
      rawKey.length + ((4 - (rawKey.length % 4)) % 4),
      "=",
    );
    const keyBytes = Uint8Array.from(atob(encodedKey), (character) =>
      character.charCodeAt(0),
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
  for (let index = 0; index < left.length; index++)
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function gradeTranscript(
  admin: AdminClient,
  userId: string,
  transcript: string,
) {
  const fallback = deterministicGrade(transcript);
  const { secret } = await integrationSecret(admin, userId, "ai");
  let config: { provider?: string; apiKey?: string; model?: string } = {};
  try {
    if (secret) config = JSON.parse(secret);
  } catch {
    /* use project fallback */
  }
  const provider = config.provider ?? "openai";
  const apiKey =
    config.apiKey ??
    (provider === "openai"
      ? Deno.env.get("OPENAI_API_KEY")
      : Deno.env.get("GLM_API_KEY"));
  if (!apiKey) return { ...fallback, model: null };
  try {
    const instruction =
      "Grade this sales call. Return only JSON with overall_score 0-100, script_adherence_pct 0-100, category_scores object, strengths string array, improvements string array, and coaching_notes string. Use only the transcript.";
    let text = "";
    const model =
      config.model ??
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
          max_output_tokens: 900,
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
      coaching_notes:
        typeof parsed.coaching_notes === "string"
          ? parsed.coaching_notes.slice(0, 5000)
          : fallback.coaching_notes,
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
    ? (value.filter((item) => typeof item === "string").slice(0, 8) as string[])
    : fallback;
}

function deterministicGrade(transcript: string) {
  const lower = transcript.toLowerCase();
  const signals = [
    "problem",
    "goal",
    "timeline",
    "decision",
    "budget",
    "next step",
  ].filter((word) => lower.includes(word));
  const score = Math.min(92, 55 + signals.length * 6);
  return {
    overall_score: score,
    script_adherence_pct: Math.min(95, score + 3),
    category_scores: {
      discovery: lower.includes("problem") ? 82 : 60,
      qualification:
        lower.includes("budget") || lower.includes("decision") ? 80 : 58,
      next_steps: lower.includes("next step") ? 86 : 55,
    },
    strengths: signals.length
      ? [`Covered ${signals.slice(0, 3).join(", ")}`]
      : ["Maintained a clear conversation"],
    improvements: [
      lower.includes("next step")
        ? "Confirm ownership and timing in writing"
        : "End with a specific next step",
    ],
    coaching_notes:
      "Use the strongest discovery answer to quantify the cost of waiting, then confirm a dated next action.",
  };
}
