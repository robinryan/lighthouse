// Exercises the coach's tool loop against a fake Messages API that streams scripted responses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';

process.env.DATABASE_PATH = ':memory:';
process.env.ANTHROPIC_API_KEY = 'test-key';

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };
const requests: any[] = [];
let script: Array<{ blocks: Block[]; stop: string }> = [];

function sse(res: http.ServerResponse, blocks: Block[], stop: string) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
    } else {
      send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    send('content_block_stop', { type: 'content_block_stop', index });
  });
  send('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

let fake: Server;
let app: Server;
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
  return { status: res.status, data: await res.json() as any };
}

before(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw) });
      const next = script.shift();
      if (!next) { res.writeHead(500); res.end('{}'); return; }
      sse(res, next.blocks, next.stop);
    });
  });
  await new Promise<void>((r) => fake.listen(0, () => r()));
  const fa = fake.address();
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof fa === 'object' && fa ? fa.port : 0}`;

  const { createApp } = await import('../src/app.js');
  await new Promise<void>((r) => { app = createApp().listen(0, () => r()); });
  const aa = app.address();
  base = `http://127.0.0.1:${typeof aa === 'object' && aa ? aa.port : 0}`;
});
after(() => { app.close(); fake.close(); });

test('coach proposes changes via tools and the user applies them', async () => {
  await call('POST', '/api/auth/register', { email: 'c@example.com', password: 'password123', name: 'C' });
  await call('POST', '/api/onboarding', {
    profile: { units: 'kg', experience: 'beginner', goal: 'strength', daysPerWeek: 4, sessionMinutes: 60,
      equipment: ['barbell', 'dumbbell', 'cable', 'machine'], limitations: [], limitationNotes: '', bodyweight: 80 },
    fiveRMs: { squat: 100, bench: 70, deadlift: 120, ohp: 45 },
  });
  const w = (await call('POST', '/api/workouts', { date: '2026-10-09' })).data;
  const bench = w.exercises.find((e: any) => e.exerciseId === 'bench');

  script = [
    {
      stop: 'tool_use',
      blocks: [
        { type: 'text', text: 'Let\'s keep pressing but take the strain off your elbow.' },
        { type: 'tool_use', id: 'tu_1', name: 'propose_swap', input: { workout_exercise_id: bench.id, new_exercise_id: 'neutral_db_press', scope: 'today', reason: 'Neutral grip is easier on elbows.' } },
        { type: 'tool_use', id: 'tu_2', name: 'propose_add_exercise', input: { exercise_id: 'wrist_extensor_stretch', sets: 2, reps: 30, rest_seconds: 15, note: 'Gentle, no pain.' } },
        { type: 'tool_use', id: 'tu_3', name: 'propose_swap', input: { workout_exercise_id: 999999, new_exercise_id: 'floor_press', scope: 'today', reason: 'x' } },
        { type: 'tool_use', id: 'tu_4', name: 'propose_limitations', input: { add: ['elbow'], remove: [], note: 'Outer elbow pain on bench' } },
      ],
    },
    { stop: 'end_turn', blocks: [{ type: 'text', text: '- Swap bench for neutral-grip DB press\n- Stretch wrist extensors' }] },
  ];

  const r = await call('POST', '/api/coach/messages', { workoutId: w.id, text: 'My elbow hurts on bench today' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.role, 'assistant');
  assert.match(r.data.content, /neutral-grip/);
  assert.equal(r.data.actions.length, 3, 'invalid workout_exercise_id is rejected');
  assert.deepEqual(r.data.actions.map((a: any) => a.type), ['swap', 'add', 'limitations']);

  // Request shape: system catalog cached, web search tool, fallbacks beta, context included.
  const first = requests[0];
  assert.equal(first.body.model, 'claude-opus-5-5');
  assert.equal(first.body.fallbacks, 'default');
  assert.match(String(first.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.ok(first.body.tools.some((t: any) => t.type === 'web_search_20260209'));
  assert.equal(first.body.system[0].cache_control.type, 'ephemeral');
  assert.match(first.body.messages.at(-1).content[0].text, new RegExp(`workout_exercise_id=${bench.id}`));
  // Second request carries tool results, with the bad id flagged as an error.
  const results = requests[1].body.messages.at(-1).content;
  assert.equal(results.length, 4);
  assert.equal(results.find((x: any) => x.tool_use_id === 'tu_3').is_error, true);

  // Apply the swap and the stretch; dismiss the profile change.
  assert.equal((await call('POST', `/api/coach/messages/${r.data.id}/actions/0`, {})).status, 200);
  assert.equal((await call('POST', `/api/coach/messages/${r.data.id}/actions/1`, {})).status, 200);
  assert.equal((await call('POST', `/api/coach/messages/${r.data.id}/actions/2`, { dismiss: true })).status, 200);
  assert.equal((await call('POST', `/api/coach/messages/${r.data.id}/actions/0`, {})).status, 409);

  const after = (await call('GET', `/api/workouts/${w.id}`)).data;
  assert.ok(after.exercises.some((e: any) => e.exerciseId === 'neutral_db_press'));
  assert.ok(!after.exercises.some((e: any) => e.exerciseId === 'bench'));
  const stretch = after.exercises.find((e: any) => e.exerciseId === 'wrist_extensor_stretch');
  assert.equal(stretch.sets.length, 2);
  assert.equal(stretch.sets[0].targetReps, 30);
  assert.deepEqual((await call('GET', '/api/profile')).data.limitations, []);

  const msgs = (await call('GET', `/api/coach/messages?workoutId=${w.id}`)).data.messages;
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[1].actions.map((a: any) => a.status), ['applied', 'applied', 'dismissed']);
});
