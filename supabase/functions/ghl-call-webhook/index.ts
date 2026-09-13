import { adminClient, corsHeaders, json } from "../_shared/supabase.ts";
import { webhookOwner } from "../_shared/sales.ts";
import { ingestCall } from "../_shared/ingest.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const admin = adminClient();
  const userId = await webhookOwner(req, admin);
  if (!userId) return json({ error: "Invalid webhook token." }, 401);
  const payload = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!payload) return json({ error: "Invalid JSON payload." }, 400);
  try {
    return json(await ingestCall(admin, userId, "ghl", payload));
  } catch (error) {
    console.error("ghl-call-webhook", error);
    return json({ error: "Could not save or grade the call." }, 500);
  }
});
