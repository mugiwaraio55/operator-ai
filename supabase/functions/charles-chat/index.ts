import {
  adminClient,
  authorizeUser,
  corsHeaders,
  json,
} from "../_shared/supabase.ts";
import { ensureSalesWorkspace, integrationSecret } from "../_shared/sales.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { user } = await authorizeUser(req);
  if (!user) return json({ error: "Sign in is required." }, 401);
  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    clear?: boolean;
  };
  const admin = adminClient();
  const membership = await ensureSalesWorkspace(admin, user.id, user.email);
  if (body.clear) {
    await admin.from("charles_messages").delete().eq("user_id", user.id);
    return json({ ok: true });
  }
  const message = String(body.message ?? "")
    .trim()
    .slice(0, 10000);
  if (!message) return json({ error: "Write a message for Charles." }, 400);
  const { data: userMessage, error: messageError } = await admin
    .from("charles_messages")
    .insert({ user_id: user.id, role: "user", content: message })
    .select("id")
    .single();
  if (messageError) return json({ error: messageError.message }, 500);

  const ownerId = membership.owner_user_id;
  const reminder = parseReminder(message);
  if (reminder)
    await admin.from("charles_reminders").insert({
      user_id: ownerId,
      reminder_kind: "manual",
      dedupe_key: crypto.randomUUID(),
      subject: reminder.subject,
      detail: `Requested by ${user.email ?? "a team member"} in Charles chat.`,
      due_at: reminder.dueAt,
    });
  const [
    settingsResult,
    historyResult,
    memoriesResult,
    callsResult,
    appointmentsResult,
    opportunitiesResult,
    docsResult,
    eodResult,
  ] = await Promise.all([
    admin
      .from("sales_manager_settings")
      .select("instructions,soul,daily_appointment_target")
      .eq("user_id", ownerId)
      .maybeSingle(),
    admin
      .from("charles_messages")
      .select("role,content")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(16),
    admin
      .from("charles_memories")
      .select("content,kind")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("sales_calls")
      .select(
        "prospect_name,rep_name,outcome,score,revenue,primary_objection,happened_at",
      )
      .eq("user_id", user.id)
      .order("happened_at", { ascending: false })
      .limit(30),
    admin
      .from("sales_appointments")
      .select("prospect_name,scheduled_at,status,outcome,assigned_user_name")
      .eq("user_id", ownerId)
      .order("scheduled_at", { ascending: false })
      .limit(30),
    admin
      .from("sales_opportunities")
      .select("name,status,monetary_value,last_activity_at")
      .eq("user_id", ownerId)
      .order("last_activity_at", { ascending: false })
      .limit(30),
    admin
      .from("sales_os_documents")
      .select("title,body_md")
      .eq("user_id", ownerId)
      .limit(10),
    admin
      .from("sales_eod_reports")
      .select(
        "report_date,calls_taken,closes,revenue,wins,blockers,priorities,mood",
      )
      .eq("user_id", user.id)
      .order("report_date", { ascending: false })
      .limit(7),
  ]);

  const fallback = deterministicAnswer(
    message,
    callsResult.data ?? [],
    appointmentsResult.data ?? [],
    opportunitiesResult.data ?? [],
  );
  const { secret } = await integrationSecret(admin, user.id, "ai");
  let config: { provider?: string; apiKey?: string; model?: string } = {};
  try {
    if (secret) config = JSON.parse(secret);
  } catch {
    /* project fallback */
  }
  const provider = config.provider ?? "openai";
  const apiKey =
    config.apiKey ??
    (provider === "glm"
      ? Deno.env.get("GLM_API_KEY")
      : Deno.env.get("OPENAI_API_KEY"));
  let answer = fallback;
  let model: string | null = null;
  if (apiKey) {
    model =
      config.model ??
      (provider === "glm"
        ? "glm-4.5-flash"
        : (Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini"));
    const instructions = [
      "You are Charles, the user's embedded AI Sales Manager. Be direct, calm, practical, and evidence-led. Never invent metrics.",
      settingsResult.data?.soul ?? "",
      settingsResult.data?.instructions ?? "",
      "Use the supplied calls, appointments, CRM opportunities, EOD reports, memories, and playbooks. Give the answer first, then prioritized next actions.",
    ]
      .filter(Boolean)
      .join("\n");
    const context = JSON.stringify({
      memories: memoriesResult.data,
      calls: callsResult.data,
      appointments: appointmentsResult.data,
      opportunities: opportunitiesResult.data,
      eod: eodResult.data,
      playbooks: docsResult.data,
    });
    try {
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
                {
                  role: "system",
                  content: `${instructions}\nContext: ${context}`,
                },
                ...(historyResult.data ?? []).reverse().map((row) => ({
                  role: row.role === "assistant" ? "assistant" : "user",
                  content: row.content,
                })),
              ],
            }),
          },
        );
        const payload = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        answer = payload.choices?.[0]?.message?.content?.trim() || fallback;
      } else {
        const conversation = (historyResult.data ?? [])
          .reverse()
          .map(
            (row) =>
              `${row.role === "assistant" ? "Charles" : "User"}: ${row.content}`,
          )
          .join("\n\n");
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            instructions,
            input: `${context}\n\nRecent conversation:\n${conversation}`,
            max_output_tokens: 1200,
          }),
        });
        const payload = (await response.json()) as { output_text?: string };
        answer = payload.output_text?.trim() || fallback;
      }
    } catch (error) {
      console.error("charles-chat provider fallback", error);
    }
  }
  const { data: assistantMessage } = await admin
    .from("charles_messages")
    .insert({
      user_id: user.id,
      role: "assistant",
      content: answer,
      metadata: { model, provider: model ? provider : "rules" },
    })
    .select("id")
    .single();
  if (
    /\b(remember|always|my target|my goal|our offer|our process)\b/i.test(
      message,
    )
  )
    await admin.from("charles_memories").insert({
      user_id: user.id,
      kind: "context",
      content: message.slice(0, 2000),
      source_message_id: userMessage.id,
    });
  return json({ ok: true, answer, messageId: assistantMessage?.id, model });
});

function deterministicAnswer(
  message: string,
  calls: Array<Record<string, unknown>>,
  appointments: Array<Record<string, unknown>>,
  opportunities: Array<Record<string, unknown>>,
) {
  const won = calls.filter((row) => row.outcome === "won").length;
  const revenue = calls.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0);
  const open = opportunities.filter((row) => row.status === "open").length;
  const upcoming = appointments.filter(
    (row) => Date.parse(String(row.scheduled_at)) > Date.now(),
  ).length;
  const objections = calls
    .map((row) => String(row.primary_objection ?? ""))
    .filter(Boolean);
  const common =
    objections.sort(
      (a, b) =>
        objections.filter((x) => x === b).length -
        objections.filter((x) => x === a).length,
    )[0] ?? "not enough recorded data";
  return `Here is the operating picture: ${calls.length} recent calls, ${won} wins, $${revenue.toFixed(0)} closed revenue, ${open} open CRM opportunities, and ${upcoming} upcoming appointments.\n\nPriority actions:\n1. Coach the ${common} objection using the strongest won call.\n2. Assign a dated next step to every open opportunity.\n3. Confirm every upcoming appointment and close the CRM loop after the call.\n\nYour question: ${message}`;
}

function parseReminder(message: string) {
  if (!/^remind\s+(me|us)\b/i.test(message)) return null;
  const iso = message.match(/\b(20\d{2}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/);
  const due = iso
    ? new Date(`${iso[1]}T${iso[2] ?? "09:00"}:00`)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(due.getTime())) return null;
  return {
    subject: `Charles reminder: ${message.replace(/^remind\s+(me|us)\s*/i, "").slice(0, 160) || "Follow up"}`,
    dueAt: due.toISOString(),
  };
}
