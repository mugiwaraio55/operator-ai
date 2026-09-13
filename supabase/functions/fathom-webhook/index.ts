import { adminClient, corsHeaders, json } from "../_shared/supabase.ts";
import { verifyFathomSignature, webhookOwner } from "../_shared/sales.ts";
import { ingestCall } from "../_shared/ingest.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const admin = adminClient();
  const userId = await webhookOwner(req, admin);
  if (!userId) return json({ error: "Invalid webhook token." }, 401);
  const rawBody = await req.text();
  if (!(await verifyFathomSignature(admin, userId, req, rawBody)))
    return json({ error: "Invalid Fathom webhook signature." }, 401);
  const payload = (() => {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (!payload) return json({ error: "Invalid JSON payload." }, 400);
  try {
    return json(await ingestCall(admin, userId, "fathom", payload));
  } catch (error) {
    console.error("fathom-webhook", error);
    return json({ error: "Could not save or grade the Fathom call." }, 500);
  }
});
