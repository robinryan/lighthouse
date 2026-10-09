import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { authRouter, requireAuth } from './auth.js';
import { EQUIPMENT, EXERCISES, JOINTS } from './exercises.js';
import {
  HttpError, activeWorkoutId, addExerciseToWorkout, addSet, completeOnboarding, deleteSet, discardWorkout,
  finishWorkout, getProfile, getProgram, getWorkout, listWorkouts, ownedWex, ownedWorkout, previewDay,
  regenerateProgram, saveProfile, saveProgram, setSlotExercise, startEmptyWorkout, startWorkout, swapExercise,
  updateSet,
} from './training.js';
import { exerciseHistory, exportCsv, summary, trainedExercises } from './stats.js';
import { applyAction, ask, coachEnabled, listMessages } from './coach.js';
import { db } from './db.js';

const today = () => new Date().toISOString().slice(0, 10);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Id = z.coerce.number().int().positive();

const ProfileBody = z.object({
  units: z.enum(['kg', 'lb']),
  experience: z.enum(['beginner', 'intermediate', 'advanced']),
  goal: z.enum(['strength', 'hypertrophy', 'general']),
  daysPerWeek: z.number().int().min(2).max(6),
  sessionMinutes: z.number().int().min(30).max(180),
  equipment: z.array(z.enum(EQUIPMENT as [string, ...string[]])),
  limitations: z.array(z.enum(JOINTS as [string, ...string[]])),
  limitationNotes: z.string().max(2000).default(''),
  bodyweight: z.number().positive().max(1000).nullable(),
});
const FiveRMsBody = z.object({
  squat: z.number().positive().nullable().optional(),
  bench: z.number().positive().nullable().optional(),
  deadlift: z.number().positive().nullable().optional(),
  ohp: z.number().positive().nullable().optional(),
});

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  // Basic hardening headers.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/api/auth', authRouter);

  const api = express.Router();
  api.use(requireAuth);

  // State-changing requests must be JSON, which browsers can't send cross-site without CORS.
  api.use((req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) {
      return next(new HttpError(415, 'Expected application/json'));
    }
    next();
  });

  const uid = (req: Request) => req.userId!;

  // --- Catalog & profile ---
  api.get('/exercises', (_req, res) => { res.json(EXERCISES); });

  api.get('/profile', (req, res) => { res.json(getProfile(uid(req))); });
  api.put('/profile', (req, res) => {
    const body = parse(ProfileBody, req.body);
    const prev = getProfile(uid(req));
    saveProfile(uid(req), { ...prev, ...body } as never);
    res.json(getProfile(uid(req)));
  });

  api.post('/onboarding', (req, res) => {
    const body = parse(z.object({ profile: ProfileBody, fiveRMs: FiveRMsBody }), req.body);
    completeOnboarding(uid(req), { ...body.profile, onboarded: true } as never, body.fiveRMs);
    res.json({ ok: true });
  });

  // --- Program ---
  api.get('/program', (req, res) => {
    const sp = getProgram(uid(req));
    if (!sp) return res.json(null);
    const date = DateStr.safeParse(req.query.date).data ?? today();
    res.json({
      nextDay: sp.nextDay, fiveRMs: sp.fiveRMs,
      days: sp.program.days.map((_, i) => previewDay(uid(req), i, date)),
    });
  });
  api.post('/program/regenerate', (req, res) => {
    regenerateProgram(uid(req));
    res.json({ ok: true });
  });
  api.put('/program/slot', (req, res) => {
    const body = parse(z.object({ slotId: z.string(), exerciseId: z.string() }), req.body);
    setSlotExercise(uid(req), body.slotId, body.exerciseId);
    res.json({ ok: true });
  });
  api.put('/program/next-day', (req, res) => {
    const body = parse(z.object({ dayIndex: z.number().int().min(0) }), req.body);
    const sp = getProgram(uid(req));
    if (!sp) throw new HttpError(404, 'No program');
    saveProgram(uid(req), { ...sp, nextDay: body.dayIndex });
    res.json({ ok: true });
  });

  // --- Workouts ---
  api.get('/today', (req, res) => {
    const date = DateStr.safeParse(req.query.date).data ?? today();
    const active = activeWorkoutId(uid(req));
    const sp = getProgram(uid(req));
    const last = db.prepare(`SELECT date FROM workouts WHERE user_id = ? AND status = 'completed' ORDER BY date DESC LIMIT 1`)
      .get(uid(req)) as { date: string } | undefined;
    res.json({
      activeWorkoutId: active,
      next: sp ? previewDay(uid(req), sp.nextDay, date) : null,
      lastWorkoutDate: last?.date ?? null,
      coachEnabled: coachEnabled(),
    });
  });

  api.post('/workouts', (req, res) => {
    const body = parse(z.object({
      date: DateStr.optional(), dayIndex: z.number().int().min(0).optional(), empty: z.boolean().optional(), title: z.string().max(80).optional(),
    }), req.body);
    const date = body.date ?? today();
    const id = body.empty ? startEmptyWorkout(uid(req), date, body.title ?? '') : startWorkout(uid(req), date, body.dayIndex);
    res.status(201).json(getWorkout(uid(req), id));
  });
  api.get('/workouts', (req, res) => {
    const before = DateStr.safeParse(req.query.before).data;
    res.json(listWorkouts(uid(req), 30, before));
  });
  api.get('/workouts/:id', (req, res) => { res.json(getWorkout(uid(req), parse(Id, req.params.id))); });
  api.patch('/workouts/:id', (req, res) => {
    const id = parse(Id, req.params.id);
    ownedWorkout(uid(req), id);
    const body = parse(z.object({ notes: z.string().max(5000).optional(), title: z.string().max(80).optional(), date: DateStr.optional() }), req.body);
    if (body.notes !== undefined) db.prepare('UPDATE workouts SET notes = ? WHERE id = ?').run(body.notes, id);
    if (body.title !== undefined) db.prepare('UPDATE workouts SET title = ? WHERE id = ?').run(body.title, id);
    if (body.date !== undefined) db.prepare('UPDATE workouts SET date = ? WHERE id = ?').run(body.date, id);
    res.json(getWorkout(uid(req), id));
  });
  api.delete('/workouts/:id', (req, res) => {
    discardWorkout(uid(req), parse(Id, req.params.id));
    res.json({ ok: true });
  });
  api.post('/workouts/:id/finish', (req, res) => {
    const id = parse(Id, req.params.id);
    const s = finishWorkout(uid(req), id);
    res.json({ summary: s, workout: getWorkout(uid(req), id) });
  });
  api.post('/workouts/:id/exercises', (req, res) => {
    const id = parse(Id, req.params.id);
    const body = parse(z.object({ exerciseId: z.string() }), req.body);
    addExerciseToWorkout(uid(req), id, body.exerciseId);
    res.json(getWorkout(uid(req), id));
  });

  // --- Exercises within a workout ---
  api.patch('/workout-exercises/:id', (req, res) => {
    const id = parse(Id, req.params.id);
    const we = ownedWex(uid(req), id);
    const body = parse(z.object({ notes: z.string().max(2000).optional(), restSeconds: z.number().int().min(0).max(900).optional() }), req.body);
    if (body.notes !== undefined) db.prepare('UPDATE workout_exercises SET notes = ? WHERE id = ?').run(body.notes, id);
    if (body.restSeconds !== undefined) db.prepare('UPDATE workout_exercises SET rest_seconds = ? WHERE id = ?').run(body.restSeconds, id);
    res.json(getWorkout(uid(req), we.workout_id));
  });
  api.delete('/workout-exercises/:id', (req, res) => {
    const id = parse(Id, req.params.id);
    const we = ownedWex(uid(req), id);
    db.prepare('DELETE FROM workout_exercises WHERE id = ?').run(id);
    res.json(getWorkout(uid(req), we.workout_id));
  });
  api.post('/workout-exercises/:id/swap', (req, res) => {
    const id = parse(Id, req.params.id);
    const we = ownedWex(uid(req), id);
    const body = parse(z.object({ exerciseId: z.string(), scope: z.enum(['today', 'program']) }), req.body);
    swapExercise(uid(req), id, body.exerciseId, body.scope);
    res.json(getWorkout(uid(req), we.workout_id));
  });
  api.post('/workout-exercises/:id/sets', (req, res) => {
    const id = parse(Id, req.params.id);
    const we = ownedWex(uid(req), id);
    const body = parse(z.object({ kind: z.enum(['warmup', 'working']).optional() }), req.body ?? {});
    addSet(uid(req), id, body.kind);
    res.json(getWorkout(uid(req), we.workout_id));
  });

  // --- Sets ---
  api.patch('/sets/:id', (req, res) => {
    const body = parse(z.object({
      actualReps: z.number().int().min(0).max(1000).nullable().optional(),
      actualWeight: z.number().min(0).max(5000).nullable().optional(),
      targetWeight: z.number().min(0).max(5000).nullable().optional(),
      rpe: z.number().min(1).max(10).nullable().optional(),
      done: z.boolean().optional(),
      kind: z.enum(['warmup', 'working']).optional(),
    }), req.body);
    const s = updateSet(uid(req), parse(Id, req.params.id), body);
    res.json({ id: s.id, actualReps: s.actual_reps, actualWeight: s.actual_weight, rpe: s.rpe, done: !!s.done, targetWeight: s.target_weight, kind: s.kind });
  });
  api.delete('/sets/:id', (req, res) => {
    deleteSet(uid(req), parse(Id, req.params.id));
    res.json({ ok: true });
  });

  // --- Stats ---
  api.get('/stats/summary', (req, res) => {
    const date = DateStr.safeParse(req.query.date).data ?? today();
    res.json(summary(uid(req), date));
  });
  api.get('/stats/exercises', (req, res) => { res.json(trainedExercises(uid(req))); });
  api.get('/stats/exercises/:exerciseId', (req, res) => { res.json(exerciseHistory(uid(req), String(req.params.exerciseId))); });
  api.get('/export.csv', (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lighthouse-${today()}.csv"`);
    res.send(exportCsv(uid(req)));
  });

  // --- Bodyweight ---
  api.get('/bodyweight', (req, res) => {
    res.json(db.prepare('SELECT date, weight FROM bodyweights WHERE user_id = ? ORDER BY date').all(uid(req)));
  });
  api.post('/bodyweight', (req, res) => {
    const body = parse(z.object({ date: DateStr, weight: z.number().positive().max(1000) }), req.body);
    db.prepare(`INSERT INTO bodyweights (user_id, date, weight) VALUES (?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET weight = excluded.weight`).run(uid(req), body.date, body.weight);
    db.prepare('UPDATE profiles SET bodyweight = ? WHERE user_id = ?').run(body.weight, uid(req));
    res.json({ ok: true });
  });

  // --- Coach ---
  api.get('/coach/messages', (req, res) => {
    const workoutId = req.query.workoutId ? parse(Id, req.query.workoutId) : null;
    res.json({ enabled: coachEnabled(), messages: listMessages(uid(req), workoutId) });
  });
  api.post('/coach/messages', async (req, res) => {
    const body = parse(z.object({ workoutId: z.number().int().positive().nullable().optional(), text: z.string().trim().min(1).max(4000) }), req.body);
    const msg = await ask(uid(req), body.workoutId ?? null, body.text);
    res.json(msg);
  });
  api.post('/coach/messages/:id/actions/:index', (req, res) => {
    const body = parse(z.object({ dismiss: z.boolean().optional() }), req.body ?? {});
    const a = applyAction(uid(req), parse(Id, req.params.id), parse(z.coerce.number().int().min(0), req.params.index), !!body.dismiss);
    res.json(a);
  });

  app.use('/api', api);
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Not found' }); });

  // Serve the built PWA in production.
  const clientDir = process.env.CLIENT_DIR ?? path.resolve(import.meta.dirname, '../../client/dist');
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, {
      index: false,
      setHeaders: (res, file) => {
        if (file.endsWith('sw.js') || file.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
        else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
    app.get(/^(?!\/api).*/, (_req, res) => { res.sendFile(path.join(clientDir, 'index.html')); });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
