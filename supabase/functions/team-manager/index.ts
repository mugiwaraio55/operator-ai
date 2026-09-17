import {
  adminClient,
  authorizeUser,
  corsHeaders,
  json,
} from "../_shared/supabase.ts";
import { ensureSalesWorkspace } from "../_shared/sales.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const { user } = await authorizeUser(req);
  if (!user) return json({ error: "Sign in is required." }, 401);
  const admin = adminClient();
  const membership = await ensureSalesWorkspace(admin, user.id, user.email);
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    email?: string;
    name?: string;
    memberUserId?: string;
    role?: string;
    managerUserId?: string | null;
    slackUserId?: string | null;
  };
  const action = body.action ?? "list";
  if (membership.role !== "owner")
    return json({ error: "Only the account owner can manage the team." }, 403);

  if (action === "invite") {
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const name = String(body.name ?? "")
      .trim()
      .slice(0, 120);
    if (!/^\S+@\S+\.\S+$/.test(email))
      return json({ error: "Enter a valid email address." }, 400);
    let memberUserId = await findUserId(admin, email);
    if (!memberUserId) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: Deno.env.get("APP_ORIGIN") ?? undefined,
        data: name ? { full_name: name } : undefined,
      });
      if (error || !data.user)
        return json(
          { error: error?.message ?? "Invitation could not be sent." },
          400,
        );
      memberUserId = data.user.id;
    }
    const { data: existingMembership } = await admin
      .from("charles_account_members")
      .select("owner_user_id,role")
      .eq("member_user_id", memberUserId)
      .maybeSingle();
    if (
      existingMembership &&
      (existingMembership.owner_user_id !== user.id ||
        existingMembership.role === "owner")
    )
      return json(
        {
          error: "That user already belongs to another Sales Manager account.",
        },
        409,
      );
    const { error } = await admin.from("charles_account_members").upsert(
      {
        member_user_id: memberUserId,
        owner_user_id: user.id,
        role: ["sales_manager", "sales_rep", "support"].includes(String(body.role)) ? body.role : "sales_rep",
        is_active: true,
        invited_email: email,
        display_name: name || null,
        manager_user_id: body.managerUserId || null,
        slack_user_id: String(body.slackUserId ?? "").trim() || null,
      },
      { onConflict: "member_user_id" },
    );
    return error
      ? json({ error: error.message }, 400)
      : json({ ok: true, memberUserId });
  }

  if (action === "updateMember") {
    const memberUserId = String(body.memberUserId ?? "");
    const role = String(body.role ?? "sales_rep");
    if (!memberUserId || memberUserId === user.id || !["sales_manager", "sales_rep", "support"].includes(role)) {
      return json({ error: "Select a team member and valid role." }, 400);
    }
    const managerUserId = body.managerUserId ? String(body.managerUserId) : null;
    if (managerUserId === memberUserId) return json({ error: "A team member cannot manage themselves." }, 400);
    const { error } = await admin.from("charles_account_members").update({
      role,
      manager_user_id: managerUserId,
      slack_user_id: String(body.slackUserId ?? "").trim() || null,
      display_name: String(body.name ?? "").trim().slice(0, 120) || null,
    }).eq("owner_user_id", user.id).eq("member_user_id", memberUserId);
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }

  if (action === "deactivate" || action === "reactivate") {
    const memberUserId = String(body.memberUserId ?? "");
    if (!memberUserId || memberUserId === user.id)
      return json({ error: "Select a sales rep." }, 400);
    const { error } = await admin
      .from("charles_account_members")
      .update({ is_active: action === "reactivate" })
      .eq("owner_user_id", user.id)
      .eq("member_user_id", memberUserId);
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }

  const { data: rows, error } = await admin
    .from("charles_account_members")
    .select(
      "member_user_id,role,is_active,invited_email,display_name,eod_token,invited_at,manager_user_id,slack_user_id,permissions",
    )
    .eq("owner_user_id", membership.owner_user_id)
    .order("invited_at");
  if (error) return json({ error: error.message }, 500);
  const appOrigin = (Deno.env.get("APP_ORIGIN") ?? "").replace(/\/$/, "");
  const members = await Promise.all(
    (rows ?? []).map(async (row) => {
      const { data } = await admin.auth.admin.getUserById(row.member_user_id);
      return {
        ...row,
        email: data.user?.email ?? row.invited_email,
        display_name:
          row.display_name ?? data.user?.user_metadata?.full_name ?? null,
        eod_url: appOrigin ? `${appOrigin}/eod/${row.eod_token}` : null,
      };
    }),
  );
  return json({ ok: true, membership, members });
});

async function findUserId(
  admin: ReturnType<typeof adminClient>,
  email: string,
) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) return null;
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email,
    );
    if (match) return match.id;
    if (data.users.length < 100) break;
  }
  return null;
}
