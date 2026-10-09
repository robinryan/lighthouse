import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

process.env.DATABASE_PATH = ':memory:';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

let server: Server;
let base = '';
let cookie = '';

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, data };
}

before(async () => {
  const { createApp } = await import('../src/app.js');
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
after(() => server.close());

test('full flow: register, onboard, train, progress', async () => {
  assert.equal((await call('GET', '/api/profile')).status, 401);

  let r = await call('POST', '/api/auth/register', { email: 'me@example.com', password: 'hunter22!', name: 'Me' });
  assert.equal(r.status, 201);
  assert.equal((await call('POST', '/api/auth/register', { email: 'me@example.com', password: 'hunter22!', name: 'Me' })).status, 409);

  r = await call('POST', '/api/onboarding', {
    profile: {
      units: 'kg', experience: 'beginner', goal: 'strength', daysPerWeek: 4, sessionMinutes: 60,
      equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'pullup_bar'], limitations: [], limitationNotes: '', bodyweight: 80,
    },
    fiveRMs: { squat: 100, bench: 70, deadlift: 120, ohp: 45 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  r = await call('GET', '/api/today?date=2026-10-09');
  assert.equal(r.data.next.name, 'Squat & Bench');
  assert.equal(r.data.next.exercises[0].weight, 85);
  assert.equal(r.data.coachEnabled, false);

  r = await call('POST', '/api/workouts', { date: '2026-10-09' });
  assert.equal(r.status, 201);
  const w = r.data;
  assert.equal(w.exercises[0].exerciseId, 'squat');

  // Complete every set as prescribed.
  for (const ex of w.exercises) {
    for (const s of ex.sets) {
      const patch: Record<string, unknown> = { done: true };
      if (s.targetWeight == null && ex.loadType === 'weight') patch.actualWeight = 10;
      if (ex.tier === 'T3') patch.actualReps = 15;
      const u = await call('PATCH', `/api/sets/${s.id}`, patch);
      assert.equal(u.status, 200);
    }
  }
  r = await call('POST', `/api/workouts/${w.id}/finish`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const squat = r.data.summary.results.find((x: any) => x.exerciseId === 'squat');
  assert.equal(squat.outcome, 'progress');

  // Next day rotates and the squat state progressed.
  r = await call('GET', '/api/today?date=2026-10-11');
  assert.equal(r.data.next.name, 'Overhead Press & Deadlift');
  r = await call('GET', '/api/program?date=2026-10-11');
  assert.equal(r.data.days[0].exercises[0].weight, 90);

  // History, stats, export.
  r = await call('GET', '/api/workouts');
  assert.equal(r.data.length, 1);
  r = await call('GET', '/api/stats/exercises/squat');
  assert.equal(r.data.sessions.length, 1);
  r = await call('GET', '/api/export.csv');
  assert.match(r.data, /Back Squat/);

  // Swap in a new workout and check the previous-performance column.
  r = await call('POST', '/api/workouts', { date: '2026-10-11', dayIndex: 0 });
  const w2 = r.data;
  assert.equal(w2.exercises[0].previous.length, 5);
  const benchRow = w2.exercises.find((e: any) => e.exerciseId === 'bench');
  r = await call('POST', `/api/workout-exercises/${benchRow.id}/swap`, { exerciseId: 'neutral_db_press', scope: 'today' });
  assert.equal(r.status, 200);
  assert.ok(r.data.exercises.some((e: any) => e.exerciseId === 'neutral_db_press' && e.substitutedFrom === 'bench'));

  // Coach is disabled without an API key.
  r = await call('POST', '/api/coach/messages', { text: 'my elbow hurts', workoutId: w2.id });
  assert.equal(r.status, 503);

  // Another user can't see this workout.
  cookie = '';
  await call('POST', '/api/auth/register', { email: 'other@example.com', password: 'password123', name: 'Other' });
  assert.equal((await call('GET', `/api/workouts/${w2.id}`)).status, 404);

  // Unit switch converts stored weights.
  cookie = '';
  r = await call('POST', '/api/auth/login', { email: 'me@example.com', password: 'hunter22!' });
  assert.equal(r.status, 200);
  const prof = (await call('GET', '/api/profile')).data;
  r = await call('PUT', '/api/profile', { ...prof, units: 'lb' });
  assert.equal(r.data.units, 'lb');
  r = await call('GET', '/api/program?date=2026-10-11');
  assert.equal(r.data.days[0].exercises[0].weight, 200); // 90 kg ≈ 198 lb → 200
});
