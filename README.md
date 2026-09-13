# Operator AI

Operator AI is a standalone application containing only the two requested products:

- **AI Sales Manager / Charles** — persistent AI sales chat and memory, GoHighLevel appointment and opportunity sync, GHL and Fathom call ingestion, automatic transcript grading, team invitations, owner reporting, magic-link EOD reports, and nine scheduled management workflows.
- **AI Media Buyer** — Meta Ads syncing, campaign metrics, scale/iterate/kill recommendations, account audits, angle research, ad scripts, paused-draft briefs, and ClickUp delivery.

Slack is not used. Every automated notification and brief is delivered as a ClickUp task. The app opens with safe sample data until Supabase is configured.

## Run locally

Requires Node.js 22.13 or newer.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Leave the placeholder Supabase values in place to use demo mode.

## Create the Supabase database

1. Create a Supabase project.
2. In **SQL Editor**, run the files in this exact order:

   1. `supabase/schema.sql`
   2. `supabase/ai_sales_manager.sql`

3. In **Authentication > URL Configuration**, add `http://localhost:3000` and the eventual production URL as redirect URLs.
4. Put the browser-safe values in `.env.local`:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

5. Link and deploy all Edge Functions:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy
   ```

6. Set `APP_ORIGIN` in **Supabase > Edge Functions > Secrets** to the exact public app URL, without a trailing slash. Team invitations and EOD links use this value.

The SQL enables Row Level Security on every browser-visible table. Owner-only aggregation runs server-side. Provider tokens and signing secrets are written to Supabase Vault and are never returned to the browser. Never put a service-role key, provider secret, or AI key in a `NEXT_PUBLIC_` variable.

## Connect ClickUp

ClickUp replaces the original Slack workflow. Charles creates tasks for reminders, CRM exceptions, dropped balls, lead digests, morning briefings, EOD links and chasers, morale reports, weekly coaching, and media-buyer briefs. It does not modify or delete existing tasks.

1. In ClickUp, open **Settings > Apps > Create new app**.
2. Use this exact OAuth redirect URL:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/integration-oauth?provider=clickup
   ```

3. Add the generated credentials to **Supabase > Edge Functions > Secrets**:

   ```text
   CLICKUP_CLIENT_ID=...
   CLICKUP_CLIENT_SECRET=...
   APP_ORIGIN=https://YOUR_APP_DOMAIN
   ```

4. In Operator AI, open **Integrations**, connect ClickUp, and authorize the target Workspace.
5. Copy the destination List URL in ClickUp. Paste the value after `/li/` into **Destination List ID**, then save it.
6. Use **Create test task**. The test task must appear before enabling Charles Autopilot.

References: [ClickUp authentication](https://developer.clickup.com/docs/authentication), [Get List](https://developer.clickup.com/reference/getlist), and [Create Task](https://developer.clickup.com/reference/createtask).

## Connect GoHighLevel

This app uses a location-level Private Integration Token (PIT), which is the simplest secure connection for a standalone/private installation.

1. In the intended HighLevel sub-account, open **Settings > Private Integrations** and create an integration named `Operator AI`.
2. Give it only these read scopes:

   - `locations.readonly`
   - `calendars/events.readonly`
   - `opportunities.readonly`

3. Copy the token when HighLevel shows it. HighLevel treats a PIT as a static secret, so store it immediately and rotate it if exposed.
4. Copy the sub-account **Location ID**.
5. In Operator AI, open **AI Sales Manager > Integrations**, enter the Location ID and PIT, and connect.
6. Open **GHL & grading** and run **Sync GoHighLevel**. This imports the surrounding 30 days of appointments and current opportunities.

The scheduled CRM, dropped-ball, lead-digest, and briefing modes refresh HighLevel automatically. References: [HighLevel private integrations](https://marketplace.gohighlevel.com/docs/2021-07-28/Authorization/PrivateIntegrationsToken/index.html), [current scopes](https://marketplace.gohighlevel.com/docs/Authorization/Scopes/index.html), and [API documentation](https://marketplace.gohighlevel.com/docs/).

### GoHighLevel real-time webhooks

The Sales Manager Integrations page displays private tokenized URLs for appointments and calls. In a HighLevel workflow, add a webhook action for the relevant appointment or call event and paste the corresponding URL exactly.

- Appointment payloads are upserted into `sales_appointments`.
- Call payloads are upserted into `sales_calls` and `sales_call_gradings`.
- If the call payload contains a transcript, Charles grades it immediately. Otherwise it remains available for a later transcript or manual grading.

Treat each URL like a password because it contains the account webhook token. Rotating the token immediately invalidates all previous URLs. HighLevel’s marketplace webhook system also supports signed webhooks; see its [webhook integration guide](https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/).

## Connect Fathom for automatic call grading

Fathom is the recommended transcript source when calls happen in Zoom, Google Meet, or Microsoft Teams.

1. In Operator AI, open **AI Sales Manager > Integrations** and copy the **Fathom calls** webhook URL.
2. In Fathom, open **User Settings > API Access > Manage > Add Webhook**.
3. Paste the copied destination URL, select the recordings to include, and enable **Transcript**. Summary and action items are optional.
4. Save the webhook and copy the generated `whsec_...` signing secret.
5. Back in Operator AI, paste that value into **Fathom webhook signing secret** and save it.
6. Record a short test meeting. Once Fathom sends the transcript, the call and its grading should appear under **GHL & grading**.

The endpoint checks the account token, the official Fathom HMAC signature, and a five-minute timestamp window. If the recorded-by email matches an invited sales rep, the grading is assigned to that rep automatically. References: [Fathom webhooks](https://developers.fathom.ai/webhooks) and [create webhook](https://developers.fathom.ai/api-reference/webhooks/create-a-webhook).

## Configure Charles AI

Charles always works: without a model key he uses deterministic, data-based coaching and grading. To use a hosted model, an owner can connect either OpenAI or GLM/Z.ai from **AI Sales Manager > Integrations**. The key is stored per account in Vault, and reps inherit access without seeing it.

You can alternatively set project-wide fallbacks in Supabase Edge Function Secrets:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
GLM_API_KEY=...
```

The Charles workspace keeps each user’s chat history and durable memories. Messages containing phrases such as “remember,” “my goal,” or “our process” become memory. Owners can set the account operating instructions, Charles personality, targets, timezone, CRM thresholds, and EOD timing.

## Team, owner dashboard, and EOD links

1. Sign in as the account owner and open **Team**.
2. Invite each sales rep by email. Supabase sends the sign-in invitation.
3. Copy each rep’s private EOD URL and distribute it securely, or let the scheduled `eodLink` mode deliver the links to ClickUp.
4. Reps can submit daily calls, connects, appointments, closes, revenue, mood, blockers, help requests, priorities, and CRM compliance without signing in.
5. The owner dashboard aggregates seven-day calls, wins, revenue, grading scores, appointments, EOD completion, and CRM compliance by rep.

Deactivating a rep immediately disables that rep’s magic link and app access to the Sales Manager account.

## Enable the nine Charles schedules

After ClickUp and Charles settings are tested:

1. In **Supabase > SQL Editor**, create the two Vault secrets used by the scheduler:

   ```sql
   select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
   select vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
   ```

2. Run `supabase/cron.sql` once.
3. In Operator AI, open **AI Sales Manager > Integrations**, enable Autopilot, and enable the desired modes.

The nine modes are `scan`, `dropball`, `crm`, `morale`, `leadsdigest`, `briefing`, `eodEnforce`, `eodLink`, and `coaching`. The scheduler calls a service-role-only endpoint; ordinary signed-in users cannot run account-wide jobs. Cron expressions in `supabase/cron.sql` use UTC, while EOD date/time decisions use each owner’s configured IANA timezone.

## Connect Facebook / Meta Ads Manager

1. Create a Meta developer app associated with the Business Portfolio that owns the ad account.
2. Add Facebook Login for Business and the Marketing API products/capabilities available to the app.
3. Add this exact **Valid OAuth Redirect URI**:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/integration-oauth?provider=meta
   ```

4. The app requests `ads_read`, `ads_management`, and `business_management`. The included workflow reads performance and produces a paused-draft brief; it never activates ads or spends automatically.
5. Add the app values to Supabase Edge Function Secrets:

   ```text
   META_APP_ID=...
   META_APP_SECRET=...
   META_GRAPH_API_VERSION=v24.0
   ```

6. In Operator AI, connect Meta, approve access, and run **Sync campaigns**.

Development access is usually limited to app admins, developers, and testers. Before outside clients connect, put the app in Live mode and complete any Meta review requirements for the requested permissions. Confirm current requirements in the [Meta Marketing API documentation](https://developers.facebook.com/docs/marketing-apis/).

## Production checklist

- Set the exact HTTPS `APP_ORIGIN` and Supabase Auth redirects.
- Keep all secrets in Edge Function Secrets or Vault.
- Test GHL sync, one GHL appointment webhook, one signed Fathom meeting, call grading, a team invite, an EOD submission, and a ClickUp task before enabling schedules.
- Run `npm run lint`, `npm run build`, and `npm audit` before deployment.
- Rotate any webhook token, PIT, OAuth credential, AI key, or service-role key that is exposed.

Supabase references: [deploy Edge Functions](https://supabase.com/docs/guides/functions/deploy), [manage function secrets](https://supabase.com/docs/guides/functions/secrets), and [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
