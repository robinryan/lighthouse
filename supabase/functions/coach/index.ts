// Supabase Edge Function: the Lighthouse AI coach.
//
// POST { workoutId: number | null, text: string } with the user's Authorization header.
// Requires the ANTHROPIC_API_KEY secret (Supabase dashboard → Edge Functions → Secrets).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Optional secrets (0 = no limit):
//   COACH_MODEL                      overrides the model
//   COACH_MONTHLY_BUDGET_USD         per-user monthly spending cap (default 10)
//   COACH_TOTAL_MONTHLY_BUDGET_USD   monthly cap across all users (default 25)
//   COACH_HOURLY_LIMIT               messages per user per hour (default 20)
//   COACH_DAILY_LIMIT                messages per user per day (default 60)

import Anthropic from 'npm:@anthropic-ai/sdk@0.132.1';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { CoachLimitError, type CoachLimits, DEFAULT_LIMITS, MAX_MESSAGE_CHARS, runCoach } from '../_shared/coach.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** A numeric secret, or the default when unset or not a number. */
function numberEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  const n = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json({ error: 'The AI coach is not configured. Add an ANTHROPIC_API_KEY secret to your Supabase Edge Functions.', code: 'not_configured' }, 503);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey) return json({ error: 'The coach function is missing SUPABASE_SERVICE_ROLE_KEY.', code: 'not_configured' }, 503);

  const authorization = req.headers.get('Authorization');
  if (!authorization) return json({ error: 'Not signed in' }, 401);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
  if (userError || !userData.user) return json({ error: 'Not signed in' }, 401);

  let body: { workoutId?: unknown; text?: unknown; research?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const workoutId = typeof body.workoutId === 'number' && Number.isInteger(body.workoutId) && body.workoutId > 0 ? body.workoutId : null;
  if (!text || text.length > MAX_MESSAGE_CHARS) return json({ error: `Message must be 1–${MAX_MESSAGE_CHARS} characters` }, 400);

  try {
    const anthropic = new Anthropic({ apiKey });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
    const limits: CoachLimits = {
      budgetUsd: numberEnv('COACH_MONTHLY_BUDGET_USD', DEFAULT_LIMITS.budgetUsd),
      totalBudgetUsd: numberEnv('COACH_TOTAL_MONTHLY_BUDGET_USD', DEFAULT_LIMITS.totalBudgetUsd),
      hourly: numberEnv('COACH_HOURLY_LIMIT', DEFAULT_LIMITS.hourly),
      daily: numberEnv('COACH_DAILY_LIMIT', DEFAULT_LIMITS.daily),
    };
    const reply = await runCoach({
      db, admin, userId: userData.user.id, anthropic, workoutId, text, limits,
      model: Deno.env.get('COACH_MODEL') ?? undefined,
      research: body.research === true,
    });
    return json(reply);
  } catch (err) {
    if (err instanceof CoachLimitError) {
      return json({ error: err.message, code: err.code }, err.code === 'hourly' || err.code === 'daily' ? 429 : 402);
    }
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'The coach is busy right now — try again in a minute.' }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'The AI coach API key is invalid.' }, 503);
    if (err instanceof Anthropic.APIError) return json({ error: `Coach error: ${err.message}` }, 502);
    console.error(err);
    return json({ error: (err as Error).message || 'Something went wrong' }, 500);
  }
});
