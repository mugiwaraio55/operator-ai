import { adminClient, corsHeaders, json } from "../_shared/supabase.ts";
import { verifyFathomSignature, webhookOwner } from "../_shared/sales.ts";
import { ingestCall, parseWebhookPayload } from "../_shared/ingest.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  const admin = adminClient();
  const userId = await webhookOwner(req, admin);
  if (!userId) return json({ error: "Invalid webhook token." }, 401);
  if (req.method === "GET") return json({ ok: true, provider: "fathom", status: "ready" });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { rawBody, payload } = await parseWebhookPayload(req);
  if (!(await verifyFathomSignature(admin, userId, req, rawBody)))
    return json({ error: "Invalid Fathom webhook signature." }, 401);
  if (!payload) return json({ error: "Send JSON, form-urlencoded, or multipart form data." }, 400);
  if (!Object.keys(payload).length) return json({ ok: true, test: true, message: "Fathom webhook is ready." });
  try {
    return json(await ingestCall(admin, userId, "fathom", payload));
  } catch (error) {
    console.error("fathom-webhook", error);
    return json({ error: "Could not save or grade the Fathom call." }, 500);
  }
});
