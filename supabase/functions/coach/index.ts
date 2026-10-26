// Supabase Edge Function: the Gym Bestie AI coach.
//
// POST { workoutId: number | null, text: string, research?: boolean } with the user's Authorization header.
// Other modes (POST { mode, ... }):
//   intake_extract { text }   read a new user's description of themselves
//   intake_explain { text }   explain the program built for them
//   me                        the caller's plan (class, allowance used)
//   admin_report              all users, usage and spending (admins only)
//   admin_set_tier { userId, tier }   move a user between free and paid (admins only; admins are set by email)
// Requires the ANTHROPIC_API_KEY secret. SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
// are provided by Supabase. Optional secrets (limits: 0 = no limit):
//   COACH_ADMIN_EMAILS               comma-separated admin emails (default robin.ryan@gmail.com)
//   COACH_FREE_MONTHLY_BUDGET_USD    per free user per month (default 0.5)
//   COACH_FREE_HOURLY_LIMIT / COACH_FREE_DAILY_LIMIT    messages (default 10 / 20)
//   COACH_PAID_MONTHLY_BUDGET_USD    per paid user per month (default 10; COACH_MONTHLY_BUDGET_USD also works)
//   COACH_PAID_HOURLY_LIMIT / COACH_PAID_DAILY_LIMIT    messages (default 20 / 60; COACH_HOURLY_LIMIT / COACH_DAILY_LIMIT also work)
//   COACH_TOTAL_MONTHLY_BUDGET_USD   cap across all free and paid users (default 25; admins are exempt)
//   COACH_FORCE_MODEL                testing only: send every question to one model instead of routing
//                                    (the old COACH_MODEL secret is ignored so it can't switch routing off)

import Anthropic from 'npm:@anthropic-ai/sdk@0.132.1';
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { CoachLimitError, type CoachLimits, MAX_MESSAGE_CHARS, TIER_LIMITS, type Tier, runCoach } from '../_shared/coach.ts';
import { MAX_INTAKE_CHARS, runIntakeExplain, runIntakeExtract } from '../_shared/intake.ts';
import { adminEmails, adminReport, myPlan, resolveTier, setTier } from '../_shared/tiers.ts';

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

/** The first secret that's set, else the default. */
function firstEnv(names: string[], fallback: number): number {
  for (const n of names) {
    const v = numberEnv(n, NaN);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

function limitsFor(tier: Tier): CoachLimits {
  if (tier === 'admin') return TIER_LIMITS.admin;
  const total = firstEnv(['COACH_TOTAL_MONTHLY_BUDGET_USD'], TIER_LIMITS.paid.totalBudgetUsd);
  if (tier === 'free') {
    return {
      budgetUsd: firstEnv(['COACH_FREE_MONTHLY_BUDGET_USD'], TIER_LIMITS.free.budgetUsd), totalBudgetUsd: total,
      hourly: firstEnv(['COACH_FREE_HOURLY_LIMIT'], TIER_LIMITS.free.hourly), daily: firstEnv(['COACH_FREE_DAILY_LIMIT'], TIER_LIMITS.free.daily),
    };
  }
  return {
    budgetUsd: firstEnv(['COACH_PAID_MONTHLY_BUDGET_USD', 'COACH_MONTHLY_BUDGET_USD'], TIER_LIMITS.paid.budgetUsd), totalBudgetUsd: total,
    hourly: firstEnv(['COACH_PAID_HOURLY_LIMIT', 'COACH_HOURLY_LIMIT'], TIER_LIMITS.paid.hourly),
    daily: firstEnv(['COACH_PAID_DAILY_LIMIT', 'COACH_DAILY_LIMIT'], TIER_LIMITS.paid.daily),
  };
}

/**
 * Keep AI work running if the phone disconnects (e.g. the user switches apps mid-question): the
 * answer is still saved, and the app picks it up when it comes back. Supabase's edge runtime
 * provides EdgeRuntime.waitUntil; elsewhere this is a no-op.
 */
function keepAlive<T>(work: Promise<T>): Promise<T> {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(work.catch(() => undefined));
  return work;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

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

  let body: { workoutId?: unknown; text?: unknown; research?: unknown; mode?: unknown; userId?: unknown; tier?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const workoutId = typeof body.workoutId === 'number' && Number.isInteger(body.workoutId) && body.workoutId > 0 ? body.workoutId : null;
  const MODES = ['intake_extract', 'intake_explain', 'me', 'admin_report', 'admin_set_tier'];
  const mode = typeof body.mode === 'string' && MODES.includes(body.mode) ? body.mode : 'chat';
  if (mode === 'chat' && (!text || text.length > MAX_MESSAGE_CHARS)) return json({ error: `Message must be 1–${MAX_MESSAGE_CHARS} characters` }, 400);
  if (mode.startsWith('intake') && text.length > MAX_INTAKE_CHARS) return json({ error: `Please keep it under ${MAX_INTAKE_CHARS} characters` }, 400);
  if (mode === 'intake_extract' && !text) return json({ error: 'Tell me a little about yourself first' }, 400);

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
    const admins = adminEmails(Deno.env.get('COACH_ADMIN_EMAILS'));
    const userId = userData.user.id;
    const tier = await resolveTier(admin, { id: userId, email: userData.user.email }, admins);
    const limits = limitsFor(tier);

    if (mode === 'me') return json(await myPlan(admin, userId, tier, limits));
    if (mode === 'admin_report' || mode === 'admin_set_tier') {
      if (tier !== 'admin') return json({ error: 'Admins only' }, 403);
      if (mode === 'admin_report') return json(await adminReport(admin, admins));
      if (typeof body.userId !== 'string' || (body.tier !== 'free' && body.tier !== 'paid')) {
        return json({ error: 'userId and tier (free or paid) are required' }, 400);
      }
      await setTier(admin, userId, body.userId, body.tier, admins);
      return json({ ok: true });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return json({ error: 'The AI coach is not configured. Add an ANTHROPIC_API_KEY secret to your Supabase Edge Functions.', code: 'not_configured' }, 503);
    }
    const anthropic = new Anthropic({ apiKey });
    const model = Deno.env.get('COACH_FORCE_MODEL') || undefined;
    if (mode === 'intake_extract') return json(await keepAlive(runIntakeExtract({ db, admin, userId, anthropic, model, text, limits, tier })));
    if (mode === 'intake_explain') return json(await keepAlive(runIntakeExplain({ db, admin, userId, anthropic, model, text, limits, tier })));
    const reply = await keepAlive(runCoach({ db, admin, userId, anthropic, workoutId, text, limits, model, tier, research: body.research === true }));
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
