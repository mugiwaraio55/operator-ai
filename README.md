# Operator AI

A standalone app containing only two workspaces from the original Skool project:

- **AI Sales Manager** - call logging, close-rate and revenue tracking, coaching recommendations, EOD reports, and AI sales briefs.
- **AI Media Buyer** - Meta Ads syncing, campaign metrics, scale/iterate/kill recommendations, account audits, angle research, ad scripts, paused draft briefs, and ClickUp task delivery.

The app opens in demo mode when Supabase is not configured, so it is safe to run immediately. Demo mode uses sample data and never contacts ClickUp or Meta.

## Run the app locally

Requirements: Node.js 22.13 or newer.

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

## Connect Supabase

1. Create a Supabase project.
2. Open **SQL Editor**, paste the complete contents of `supabase/schema.sql`, and run it. This fresh database definition already uses ClickUp.
3. In **Authentication > URL Configuration**, add your local and production app URLs as redirect URLs. For local development use `http://localhost:3000`.
4. Copy `.env.example` to `.env.local` and fill in:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

5. Link and deploy the server functions:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy
   ```

The schema enables Row Level Security on every browser-visible table. Each signed-in user can only read their own data. ClickUp and Meta tokens are written to Supabase Vault by server-side functions and are never returned to the browser. Never place a secret key, service-role key, ClickUp secret, Meta secret, or OpenAI key in a `NEXT_PUBLIC_` variable.

## Connect ClickUp

Operator AI creates a ClickUp task for a connection check or a Meta media-buyer brief. It does not read, update, or delete existing ClickUp tasks.

1. Sign in to ClickUp as a Workspace owner or admin.
2. Open your avatar menu, choose **Settings**, then **Apps**.
3. Choose **Create new app**, name it `Operator AI`, and add this exact redirect URL:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/integration-oauth?provider=clickup
   ```

4. Copy the ClickUp app's Client ID and Client Secret.
5. In Supabase **Edge Functions > Secrets**, add:

   ```text
   APP_ORIGIN=https://YOUR_APP_DOMAIN
   CLICKUP_CLIENT_ID=...
   CLICKUP_CLIENT_SECRET=...
   ```

   For local Edge Function testing, use `APP_ORIGIN=http://localhost:3000` in `supabase/.env.local` and run `npm run supabase:functions:serve`.

6. In Operator AI, open **Integrations**, choose **Connect ClickUp**, and authorize the Workspace that contains the destination List.
7. In ClickUp, right-click the destination List and choose **Copy link**. The List ID is the final value in that URL (the value after `/li/`).
8. Paste the ID into **Destination List ID** in Operator AI and choose **Save List**. Operator AI validates access before saving it.
9. Choose **Create test task**. A task named `Operator AI - ClickUp connection test` should appear in the selected List.
10. On the Meta card, choose **Sync + create ClickUp brief** to refresh the last seven days of campaign data and create a media brief task.

ClickUp uses OAuth 2.0 authorization code flow. OAuth tokens currently do not expire, though ClickUp notes that this may change. Reconnect ClickUp if the user revokes access or changes the authorized Workspaces. See the official [ClickUp authentication guide](https://developer.clickup.com/docs/authentication), [Get List endpoint](https://developer.clickup.com/reference/getlist), and [Create Task endpoint](https://developer.clickup.com/reference/createtask).

## Connect Facebook / Meta Ads Manager

1. Go to [Meta for Developers](https://developers.facebook.com/apps/) and create an app associated with the Business Portfolio that owns the ad account.
2. Add the Facebook Login for Business and Marketing API products/capabilities available to your app.
3. In the Facebook Login OAuth settings, add this **Valid OAuth Redirect URI** exactly:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/functions/v1/integration-oauth?provider=meta
   ```

4. Make sure the Facebook user testing the connection has access to the intended Business Portfolio and ad account.
5. The app requests these permissions:

   - `ads_read` - read campaigns and performance.
   - `ads_management` - reserved for future paused-draft creation. The included workflow only produces a paused draft brief; it never activates or spends automatically.
   - `business_management` - list the ad accounts the user can access.

6. Copy the Meta **App ID** and **App Secret**. Add them in Supabase **Edge Functions > Secrets**:

   ```text
   APP_ORIGIN=https://YOUR_APP_DOMAIN
   META_APP_ID=...
   META_APP_SECRET=...
   META_GRAPH_API_VERSION=v24.0
   ```

7. In Operator AI, open **Integrations**, choose **Connect Meta Ads Manager**, approve access, then choose **Sync campaigns**.

During development, Meta access normally works only for app admins, developers, and testers. Before clients outside those roles connect, put the Meta app into Live mode and complete any Business Verification or App Review Meta requires for the requested permissions. Meta changes product screens and review requirements over time, so confirm the current steps in the [Meta Marketing API documentation](https://developers.facebook.com/docs/marketing-apis/).

### Multiple Meta ad accounts

The OAuth callback stores the full list of accessible ad accounts in connection metadata and selects the first account for syncing. If your Facebook user can access several accounts, limit that user's access to the intended account before connecting. A future account picker can update `integration_connections.account_id` without changing the schema.

## Optional OpenAI-powered briefs

Without an OpenAI key, both assistants return deterministic, data-based briefs. To enable generated analysis, add `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in Supabase **Edge Functions > Secrets**. Then redeploy `assistant-run` if you changed its code; changing secrets alone does not require a redeploy.

## Production checklist

- Set `APP_ORIGIN` to the exact HTTPS production origin, with no trailing slash.
- Add the production origin to Supabase Auth redirect URLs.
- Keep all server secrets in Supabase Edge Function Secrets.
- Complete ClickUp installation and Meta review using non-owner test accounts before inviting clients.
- Run `npm run build` before deployment.
- Use **Create test task**, **Sync campaigns**, and **Sync + create ClickUp brief** after every credential rotation.

Useful official references: [Supabase Edge Function deployment](https://supabase.com/docs/guides/functions/deploy), [Supabase secrets](https://supabase.com/docs/guides/functions/secrets), and [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
