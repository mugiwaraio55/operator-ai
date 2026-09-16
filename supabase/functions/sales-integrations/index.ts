import {
  adminClient,
  authorizeUser,
  corsHeaders,
  json,
} from "../_shared/supabase.ts";
import { ensureSalesWorkspace, ghlFetch } from "../_shared/sales.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { user } = await authorizeUser(req);
  if (!user) return json({ error: "Sign in is required." }, 401);
  const admin = adminClient();
  const membership = await ensureSalesWorkspace(admin, user.id, user.email);
  const ownerId = membership.owner_user_id;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "state");

  if (action !== "state" && membership.role !== "owner") {
    return json(
      { error: "Only the account owner can change integrations." },
      403,
    );
  }

  if (action === "saveGhl") {
    const pit = String(body.pit ?? "").trim();
    const locationId = String(body.locationId ?? "").trim();
    if (pit.length < 20 || !/^[a-zA-Z0-9_-]{5,100}$/.test(locationId)) {
      return json(
        { error: "Enter a valid Private Integration Token and Location ID." },
        400,
      );
    }
    const location = await ghlFetch(
      pit,
      `/locations/${encodeURIComponent(locationId)}`,
    );
    const locationName = String(
      (location.location as Record<string, unknown> | undefined)?.name ??
        location.name ??
        locationId,
    );
    const { error: secretError } = await admin.rpc("set_integration_secret", {
      p_user: ownerId,
      p_provider: "ghl",
      p_secret: JSON.stringify({ pit, locationId }),
    });
    if (secretError) return json({ error: secretError.message }, 500);
    const { error } = await admin.from("integration_connections").upsert({
      user_id: ownerId,
      provider: "ghl",
      status: "connected",
      account_id: locationId,
      account_name: locationName,
      scopes: [
        "locations.readonly",
        "calendars/events.readonly",
        "opportunities.readonly",
      ],
      metadata: { last4: pit.slice(-4) },
      refreshed_at: new Date().toISOString(),
    });
    return error
      ? json({ error: error.message }, 500)
      : json({ ok: true, accountName: locationName });
  }

  if (
    action === "disconnectGhl" ||
    action === "removeAi" ||
    action === "removeFathom"
  ) {
    const provider = action === "disconnectGhl"
      ? "ghl"
      : action === "removeFathom"
      ? "fathom"
      : "ai";
    await admin.rpc("clear_integration_secret", {
      p_user: ownerId,
      p_provider: provider,
    });
    const { error } = await admin
      .from("integration_connections")
      .delete()
      .eq("user_id", ownerId)
      .eq("provider", provider);
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }

  if (action === "saveAi") {
    const provider = String(body.provider ?? "openai");
    const apiKey = String(body.apiKey ?? "").trim();
    const model = String(body.model ?? "").trim();
    if (
      !["openai", "glm"].includes(provider) ||
      apiKey.length < 12 ||
      model.length < 2
    ) {
      return json(
        { error: "Enter a supported provider, API key, and model." },
        400,
      );
    }
    const { error: secretError } = await admin.rpc("set_integration_secret", {
      p_user: ownerId,
      p_provider: "ai",
      p_secret: JSON.stringify({ provider, apiKey, model }),
    });
    if (secretError) return json({ error: secretError.message }, 500);
    const { error } = await admin.from("integration_connections").upsert({
      user_id: ownerId,
      provider: "ai",
      status: "connected",
      account_id: provider,
      account_name: provider === "glm" ? "GLM / Z.ai" : "OpenAI",
      scopes: [],
      metadata: { provider, model, last4: apiKey.slice(-4) },
      refreshed_at: new Date().toISOString(),
    });
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }

  if (action === "saveFathom") {
    const webhookSecret = String(body.webhookSecret ?? "").trim();
    if (!/^whsec_[A-Za-z0-9+/=_-]{16,}$/.test(webhookSecret)) {
      return json({ error: "Enter the whsec_ value issued by Fathom." }, 400);
    }
    const { error: secretError } = await admin.rpc("set_integration_secret", {
      p_user: ownerId,
      p_provider: "fathom",
      p_secret: webhookSecret,
    });
    if (secretError) return json({ error: secretError.message }, 500);
    const { error } = await admin.from("integration_connections").upsert({
      user_id: ownerId,
      provider: "fathom",
      status: "connected",
      account_id: "webhook",
      account_name: "Fathom webhook",
      scopes: ["meeting_content_ready"],
      metadata: { last4: webhookSecret.slice(-4) },
      refreshed_at: new Date().toISOString(),
    });
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }

  if (action === "saveSettings") {
    if ("timezone" in body) {
      try {
        new Intl.DateTimeFormat("en-US", {
          timeZone: String(body.timezone),
        }).format();
      } catch {
        return json({ error: "Enter a valid IANA timezone." }, 400);
      }
    }
    if ("eod_form_schema" in body) {
      const schema = body.eod_form_schema;
      if (
        !schema ||
        typeof schema !== "object" ||
        Array.isArray(schema) ||
        !Array.isArray((schema as Record<string, unknown>).sections) ||
        JSON.stringify(schema).length > 100000
      ) {
        return json({ error: "Enter a valid EOD form with at least one section." }, 400);
      }
    }
    const allowed = [
      "instructions",
      "soul",
      "timezone",
      "daily_appointment_target",
      "autopilot_enabled",
      "autopilot_functions",
      "crm_stuck_days",
      "crm_wait_minutes",
      "eod_link_enabled",
      "eod_link_send_time",
      "eod_link_template",
      "briefing_send_time",
      "leads_digest_send_time",
      "morale_send_time",
      "coaching_send_time",
      "eod_enforce_delay_minutes",
      "eod_form_schema",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) if (key in body) patch[key] = body[key];
    const { error } = await admin
      .from("sales_manager_settings")
      .upsert({ user_id: ownerId, ...patch }, { onConflict: "user_id" });
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }

  if (action === "rotateWebhookToken") {
    const token = `${crypto.randomUUID().replaceAll("-", "")}${
      crypto.randomUUID().replaceAll("-", "")
    }`;
    const { error } = await admin
      .from("sales_webhook_tokens")
      .upsert(
        { user_id: ownerId, token, rotated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    return error
      ? json({ error: error.message }, 500)
      : json({ ok: true, token });
  }

  const [{ data: settings }, { data: connections }, { data: webhook }] =
    await Promise.all([
      admin
        .from("sales_manager_settings")
        .select("*")
        .eq("user_id", ownerId)
        .maybeSingle(),
      admin
        .from("integration_connections")
        .select("provider,status,account_id,account_name,metadata,refreshed_at")
        .eq("user_id", ownerId)
        .in("provider", ["ghl", "ai", "fathom"]),
      admin
        .from("sales_webhook_tokens")
        .select("token,rotated_at")
        .eq("user_id", ownerId)
        .maybeSingle(),
    ]);
  return json({
    ok: true,
    membership,
    settings,
    connections: connections ?? [],
    webhook: membership.role === "owner" ? webhook : null,
  });
});
