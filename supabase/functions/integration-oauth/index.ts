import {
  adminClient,
  authorizeUser,
  corsHeaders,
  json,
  sha256,
} from "../_shared/supabase.ts";

const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") || "v24.0";

function callbackUrl(provider: "clickup" | "meta") {
  const base = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "") ?? "";
  return `${base}/functions/v1/integration-oauth?provider=${provider}`;
}

function safeReturnUrl(requested: unknown) {
  const configured = Deno.env.get("APP_ORIGIN")?.replace(/\/$/, "");
  if (!configured) throw new Error("APP_ORIGIN is not configured.");
  const candidate =
    typeof requested === "string" ? requested.replace(/\/$/, "") : configured;
  return candidate === configured ? configured : configured;
}

async function start(req: Request) {
  const { user } = await authorizeUser(req);
  if (!user) return json({ error: "Sign in is required." }, 401);
  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    returnUrl?: string;
  };
  if (body.provider !== "clickup" && body.provider !== "meta")
    return json({ error: "Provider must be clickup or meta." }, 400);
  const provider = body.provider;
  const returnUrl = safeReturnUrl(body.returnUrl);
  const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll(
    "-",
    "",
  );
  const admin = adminClient();
  const { error } = await admin.rpc("put_oauth_state", {
    p_hash: await sha256(state),
    p_user: user.id,
    p_provider: provider,
    p_return_url: returnUrl,
  });
  if (error) return json({ error: "Could not prepare the connection." }, 500);

  if (provider === "clickup") {
    const clientId = Deno.env.get("CLICKUP_CLIENT_ID");
    if (!clientId)
      return json({ error: "ClickUp OAuth is not configured." }, 503);
    const url = new URL("https://app.clickup.com/api");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callbackUrl("clickup"));
    url.searchParams.set("state", state);
    return json({ url: url.toString() });
  }

  const appId = Deno.env.get("META_APP_ID");
  if (!appId) return json({ error: "Meta OAuth is not configured." }, 503);
  const url = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", callbackUrl("meta"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "ads_read,ads_management,business_management");
  url.searchParams.set("state", state);
  return json({ url: url.toString() });
}

async function callback(req: Request, provider: "clickup" | "meta") {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code)
    return new Response("The connection was cancelled or is incomplete.", {
      status: 400,
    });
  const admin = adminClient();
  const { data: states, error: stateError } = await admin.rpc(
    "consume_oauth_state",
    { p_hash: await sha256(state), p_provider: provider },
  );
  const saved = Array.isArray(states) ? states[0] : null;
  if (stateError || !saved?.user_id || !saved?.return_url)
    return new Response("This connection link is invalid or expired.", {
      status: 400,
    });

  try {
    if (provider === "clickup") await finishClickUp(admin, saved.user_id, code);
    else await finishMeta(admin, saved.user_id, code);
  } catch (error) {
    console.error(error);
    return Response.redirect(
      `${saved.return_url}?connection_error=${provider}`,
      302,
    );
  }
  return Response.redirect(`${saved.return_url}?connected=${provider}`, 302);
}

async function finishClickUp(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  code: string,
) {
  const clientId = Deno.env.get("CLICKUP_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("CLICKUP_CLIENT_SECRET") ?? "";
  const response = await fetch("https://api.clickup.com/api/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });
  const payload = (await response.json()) as { access_token?: string };
  if (!response.ok || !payload.access_token)
    throw new Error("ClickUp token exchange failed.");
  const teamsResponse = await fetch("https://api.clickup.com/api/v2/team", {
    headers: { Authorization: `Bearer ${payload.access_token}` },
  });
  const teamsPayload = (await teamsResponse.json()) as {
    teams?: { id: string; name: string }[];
  };
  const teams = teamsPayload.teams ?? [];
  if (!teamsResponse.ok || !teams.length)
    throw new Error("No authorized ClickUp Workspace is available.");
  const { error: secretError } = await admin.rpc("set_integration_secret", {
    p_user: userId,
    p_provider: "clickup",
    p_secret: payload.access_token,
  });
  if (secretError) throw secretError;
  const { error } = await admin
    .from("integration_connections")
    .upsert({
      user_id: userId,
      provider: "clickup",
      status: "connected",
      account_id: teams[0].id,
      account_name: teams[0].name,
      scopes: [],
      metadata: { workspaces: teams },
      refreshed_at: new Date().toISOString(),
    });
  if (error) throw error;
}

async function finishMeta(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  code: string,
) {
  const appId = Deno.env.get("META_APP_ID") ?? "";
  const appSecret = Deno.env.get("META_APP_SECRET") ?? "";
  const shortUrl = new URL(
    `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
  );
  shortUrl.search = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: callbackUrl("meta"),
    code,
  }).toString();
  const shortResponse = await fetch(shortUrl);
  const shortPayload = (await shortResponse.json()) as {
    access_token?: string;
  };
  if (!shortResponse.ok || !shortPayload.access_token)
    throw new Error("Meta token exchange failed.");
  const longUrl = new URL(
    `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
  );
  longUrl.search = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortPayload.access_token,
  }).toString();
  const longResponse = await fetch(longUrl);
  const longPayload = (await longResponse.json()) as { access_token?: string };
  if (!longResponse.ok || !longPayload.access_token)
    throw new Error("Meta long-lived token exchange failed.");
  const accountsUrl = new URL(
    `https://graph.facebook.com/${graphVersion}/me/adaccounts`,
  );
  accountsUrl.search = new URLSearchParams({
    access_token: longPayload.access_token,
    fields: "id,name,currency,timezone_name",
    limit: "100",
  }).toString();
  const accountsResponse = await fetch(accountsUrl);
  const accountsPayload = (await accountsResponse.json()) as {
    data?: {
      id: string;
      name?: string;
      currency?: string;
      timezone_name?: string;
    }[];
  };
  const accounts = accountsPayload.data ?? [];
  const account = accounts[0];
  if (!account)
    throw new Error("No Meta ad account is available to this user.");
  const { error: secretError } = await admin.rpc("set_integration_secret", {
    p_user: userId,
    p_provider: "meta",
    p_secret: longPayload.access_token,
  });
  if (secretError) throw secretError;
  const { error } = await admin
    .from("integration_connections")
    .upsert({
      user_id: userId,
      provider: "meta",
      status: "connected",
      account_id: account.id.replace(/^act_/, ""),
      account_name: account.name ?? account.id,
      scopes: ["ads_read", "ads_management", "business_management"],
      metadata: {
        accounts,
        currency: account.currency ?? "USD",
        timezone: account.timezone_name ?? null,
      },
      refreshed_at: new Date().toISOString(),
    });
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  if (req.method === "GET" && (provider === "clickup" || provider === "meta"))
    return callback(req, provider);
  if (req.method === "POST") return start(req);
  return json({ error: "Not found." }, 404);
});
