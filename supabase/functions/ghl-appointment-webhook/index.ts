import { adminClient, corsHeaders, json } from "../_shared/supabase.ts";
import { webhookOwner } from "../_shared/sales.ts";
import { ingestAppointment, parseWebhookPayload } from "../_shared/ingest.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  const admin = adminClient();
  const userId = await webhookOwner(req, admin);
  if (!userId) return json({ error: "Invalid webhook token." }, 401);
  if (req.method === "GET") return json({ ok: true, provider: "ghl-appointment", status: "ready" });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { payload } = await parseWebhookPayload(req);
  if (!payload) return json({ error: "Send JSON, form-urlencoded, or multipart form data." }, 400);
  if (!Object.keys(payload).length) return json({ ok: true, test: true, message: "GHL appointment webhook is ready." });
  try {
    return json(await ingestAppointment(admin, userId, payload));
  } catch (error) {
    console.error("ghl-appointment-webhook", error);
    return json({ error: "Could not save appointment." }, 500);
  }
});
