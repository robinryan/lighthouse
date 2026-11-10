// A local stand-in for a Supabase project, for browser tests: just enough of the auth, REST
// and edge-function APIs for the app to run against a real Postgres with the real migrations
// (so row level security is exercised). The coach runs the real server code with a scripted
// model in place of Claude, so no API key is needed and nothing is billed.

import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { fakeSupabase } from '../fakeSupabase.ts';
import { TIER_LIMITS, runCoach } from '../../supabase/functions/_shared/coach.ts';
import { runIntakeExplain, runIntakeExtract } from '../../supabase/functions/_shared/intake.ts';
import { adminEmails, adminReport, myPlan, resolveTier, setTier } from '../../supabase/functions/_shared/tiers.ts';

type User = { id: string; email: string };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** An unsigned token in JWT shape; the stand-in trusts its `sub`. */
function session(u: User, name?: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp })}.x`;
  const now = new Date().toISOString();
  return {
    access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `r.${u.id}`,
    user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: now, user_metadata: name ? { name } : {}, app_metadata: {}, created_at: now },
  };
}

// The scripted model. Topic check: everything is on topic; "rest" / "RPE" questions are simple.
let n = 0;
const fakeAnthropic = {
  messages: { create: async (req: any) => ({ stop_reason: 'end_turn', usage: { input_tokens: 300, output_tokens: 20 },
    content: [{ type: 'text', text: JSON.stringify({ on_topic: true, kind: /rest|rpe/i.test(JSON.stringify(req.messages)) ? 'simple' : 'personal' }) }] }) },
  beta: { messages: {
    create: async (req: any) => {
      const usage = { input_tokens: 2500, output_tokens: 300 };
      if (req.output_config?.format) {
        return { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: JSON.stringify({
          goal: 'strength', experience: 'beginner', days_per_week: 3, session_minutes: 45, equipment: [],
          joints: [{ joint: 'knee', severity: 3, note: 'knee surgery last year' }], avoid_exercises: [], other_notes: ['desk job'],
          summary: 'You want to get stronger, three days a week, and protect your knee.',
        }) }] };
      }
      return { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: '**What I heard**\nYou want to get stronger.\n\n**Your plan**\nFour workouts in rotation.\n\n**Why it fits you**\n- Short sessions fit your week.\n\n**First few weeks**\nStart light.' }] };
    },
    stream: (req: any) => ({ finalMessage: async () => {
      const last = req.messages.at(-1);
      const usage = { input_tokens: 1800, output_tokens: 600, cache_creation_input_tokens: 0, cache_read_input_tokens: 3600 };
      if (Array.isArray(last.content) && last.content[0]?.type === 'tool_result') return { stop_reason: 'end_turn', content: [], usage };
      n++;
      // "…to my program": a slow answer that saves a program change.
      if (/to my program/.test(JSON.stringify(last))) {
        await new Promise((r) => setTimeout(r, 2000));
        return { usage, stop_reason: 'tool_use', content: [
          { type: 'text', text: 'Done. I\'ve added calf raises to A1 and B1 for good.' },
          { type: 'tool_use', id: `pa${n}`, name: 'propose_program_add', input: { day_keys: ['A1', 'B1'], exercise_id: 'calf_raise', reason: 'You asked for it.', apply_now: true } },
        ] };
      }
      // In a workout with Bench Press: swap it and add a stretch.
      const bench = (last.content[0].text as string).match(/workout_exercise_id=(\d+) Bench Press/);
      return { usage, stop_reason: bench ? 'tool_use' : 'end_turn', content: [
        { type: 'text', text: 'Keep training, but remove the grip that hurts:\n\n- **Swap** to a machine press today\n- Keep pain **≤3/10**' },
        ...(bench ? [
          { type: 'tool_use', id: `tu${n}`, name: 'propose_swap', input: { workout_exercise_id: Number(bench[1]), new_exercise_id: 'machine_chest_press', scope: 'today', reason: 'Neutral handles, fixed path.', apply_now: false } },
          { type: 'tool_use', id: `tv${n}`, name: 'propose_add_exercise', input: { exercise_id: 'wrist_extensor_stretch', sets: 2, reps: 30, rest_seconds: 15, note: 'Gentle stretch, never into pain.' } },
        ] : []),
      ] };
    } }),
  } },
};

/** Start the stand-in on `port`, using a fresh database created from `adminUrl`. Returns a stop function. */
export async function startStandIn(adminUrl: string, port: number): Promise<() => Promise<void>> {
  const dbName = `lh_e2e_${process.pid}`;
  const admin = new pg.Pool({ connectionString: adminUrl });
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const pool = new pg.Pool({ connectionString: url.toString() });
  await pool.query(fs.readFileSync(new URL('../supabase-stub.sql', import.meta.url), 'utf8'));
  for (const f of fs.readdirSync(new URL('../../supabase/migrations/', import.meta.url)).sort()) {
    await pool.query(fs.readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8'));
  }
  const accounts = new Map<string, { id: string; password: string }>();

  const read = async (req: http.IncomingMessage) => { let s = ''; for await (const c of req) s += c; return s ? JSON.parse(s) : null; };
  const send = (res: http.ServerResponse, status: number, data?: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' });
    res.end(data === undefined ? '' : JSON.stringify(data));
  };
  const userFrom = (req: http.IncomingMessage): User | null => {
    try {
      const p = JSON.parse(Buffer.from(String(req.headers.authorization).split('.')[1], 'base64url').toString());
      return p.sub ? { id: p.sub, email: p.email } : null;
    } catch { return null; }
  };

  /** One PostgREST request, translated onto the test query builder. */
  async function rest(req: http.IncomingMessage, res: http.ServerResponse, u: URL, user: User | null) {
    const db = fakeSupabase(pool, user ?? { id: '00000000-0000-0000-0000-000000000000', email: '' });
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) {
      const r = await db.rpc(rpc[1], (await read(req)) ?? {});
      return r.error ? send(res, 400, { message: r.error.message }) : send(res, 200, r.data);
    }
    const table = u.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1];
    if (!table) return send(res, 404, { message: 'not found' });
    const prefer = String(req.headers.prefer ?? '');
    const select = u.searchParams.get('select') ?? '*';
    let q: any = db.from(table);
    if (req.method === 'GET' || req.method === 'HEAD') q = q.select(select);
    else if (req.method === 'POST') {
      const body = await read(req);
      const conflict = u.searchParams.get('on_conflict');
      q = prefer.includes('resolution=merge-duplicates') && conflict ? q.upsert(body, { onConflict: conflict }) : q.insert(body);
    } else if (req.method === 'PATCH') q = q.update(await read(req));
    else if (req.method === 'DELETE') q = q.delete();
    else return send(res, 405, { message: 'method' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && prefer.includes('return=representation')) q = q.select(select);

    for (const [col, raw] of u.searchParams) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(col)) continue;
      const [op, ...rest] = raw.split('.');
      const v = rest.join('.');
      if (op === 'in') q = q.in(col, v.slice(1, -1).split(',').filter(Boolean).map((x) => x.replace(/^"|"$/g, '')));
      else if (op === 'is' && v === 'null') q = q.is(col, null);
      else if (op === 'not' && v === 'is.null') q = q.not(col, 'is', null);
      else if (['eq', 'neq', 'gte', 'gt', 'lte', 'lt'].includes(op)) q = q[op](col, v);
      else return send(res, 400, { message: `unsupported filter ${col}=${raw}` });
    }
    for (const o of (u.searchParams.get('order') ?? '').split(',').filter(Boolean)) {
      const [c, dir] = o.split('.');
      q = q.order(c, { ascending: dir !== 'desc' });
    }
    const limit = u.searchParams.get('limit');
    const offset = u.searchParams.get('offset');
    if (offset) q = q.range(Number(offset), Number(offset) + Number(limit ?? 1000) - 1);
    else if (limit) q = q.limit(Number(limit));

    const r = await q;
    if (r.error) return send(res, 400, { message: r.error.message, code: 'P0001' });
    const rows = (r.data ?? []) as unknown[];
    if (String(req.headers.accept ?? '').includes('vnd.pgrst.object')) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` });
      return send(res, 200, rows[0]);
    }
    return send(res, r.data === null ? 201 : 200, r.data === null ? undefined : rows);
  }

  async function coach(req: http.IncomingMessage, res: http.ServerResponse, user: User | null) {
    if (!user) return send(res, 401, { error: 'Not signed in' });
    const b = await read(req);
    const adm = fakeSupabase(pool, null);
    const db = fakeSupabase(pool, user);
    const admins = adminEmails(undefined);
    const tier = await resolveTier(adm as any, { ...user, email_confirmed_at: 'yes' }, admins);
    const limits = TIER_LIMITS[tier];
    const base = { db: db as any, admin: adm as any, userId: user.id, anthropic: fakeAnthropic, tier, limits };
    try {
      if (b.mode === 'me') return send(res, 200, await myPlan(adm as any, user.id, tier, limits));
      if (b.mode === 'admin_report' || b.mode === 'admin_set_tier') {
        if (tier !== 'admin') return send(res, 403, { error: 'Admins only' });
        if (b.mode === 'admin_report') return send(res, 200, await adminReport(adm as any, admins));
        await setTier(adm as any, user.id, b.userId, b.tier, admins);
        return send(res, 200, { ok: true });
      }
      if (b.mode === 'intake_extract') return send(res, 200, await runIntakeExtract({ ...base, text: b.text }));
      if (b.mode === 'intake_explain') return send(res, 200, await runIntakeExplain({ ...base, text: b.text ?? '' }));
      return send(res, 200, await runCoach({ ...base, workoutId: b.workoutId ?? null, text: b.text, research: b.research === true }));
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204);
      const u = new URL(req.url!, 'http://x');
      const user = userFrom(req);
      if (u.pathname === '/auth/v1/signup') {
        const b = await read(req);
        if (accounts.has(b.email)) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
        const id = crypto.randomUUID();
        await pool.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [id, b.email, JSON.stringify(b.data ?? {})]);
        accounts.set(b.email, { id, password: b.password });
        return send(res, 200, session({ id, email: b.email }, b.data?.name));
      }
      if (u.pathname === '/auth/v1/token') {
        const b = await read(req);
        if (b.refresh_token) {
          const acct = [...accounts].find(([, a]) => `r.${a.id}` === b.refresh_token);
          return acct ? send(res, 200, session({ id: acct[1].id, email: acct[0] })) : send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        }
        const a = accounts.get(b.email);
        if (!a || a.password !== b.password) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return send(res, 200, session({ id: a.id, email: b.email }));
      }
      if (u.pathname === '/auth/v1/user') return user ? send(res, 200, session(user).user) : send(res, 401, { msg: 'no' });
      if (u.pathname === '/auth/v1/logout') return send(res, 204);
      if (u.pathname === '/functions/v1/coach') return await coach(req, res, user);
      if (u.pathname.startsWith('/rest/v1/')) return await rest(req, res, u, user);
      return send(res, 404, { message: 'not found' });
    } catch (e) {
      send(res, 500, { message: (e as Error).message });
    }
  });
  await new Promise<void>((r) => server.listen(port, r));
  return async () => {
    await new Promise((r) => server.close(r));
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  };
}
