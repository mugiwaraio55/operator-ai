import { adminClient, corsHeaders, json } from "../_shared/supabase.ts";
import { webhookOwner } from "../_shared/sales.ts";
import { ingestCall, parseWebhookPayload } from "../_shared/ingest.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  const admin = adminClient();
  const userId = await webhookOwner(req, admin);
  if (!userId) return json({ error: "Invalid webhook token." }, 401);
  if (req.method === "GET") return json({ ok: true, provider: "ghl", status: "ready" });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { payload } = await parseWebhookPayload(req);
  if (!payload) return json({ error: "Send JSON, form-urlencoded, or multipart form data." }, 400);
  if (!Object.keys(payload).length) return json({ ok: true, test: true, message: "GHL call webhook is ready." });
  try {
    return json(await ingestCall(admin, userId, "ghl", payload));
  } catch (error) {
    console.error("ghl-call-webhook", error);
    return json({ error: "Could not save or grade the call." }, 500);
  }
});
