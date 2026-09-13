import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.101.1';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function namedKey(variable: 'SUPABASE_PUBLISHABLE_KEYS' | 'SUPABASE_SECRET_KEYS') {
  const raw = Deno.env.get(variable);
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.default ?? Object.values(parsed)[0] ?? '';
  } catch {
    return '';
  }
}

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = namedKey('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !key) throw new Error('Supabase server credentials are unavailable.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function authorizeUser(req: Request) {
  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { user: null, error: 'Sign in is required.' };
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = namedKey('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!url || !key) return { user: null, error: 'Supabase user authentication is unavailable.' };
  const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  return { user: error ? null : data.user, error: error?.message ?? null };
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
