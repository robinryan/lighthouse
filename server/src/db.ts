import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DATABASE_PATH ?? path.resolve('data', 'lighthouse.db');
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  units TEXT NOT NULL DEFAULT 'kg',
  experience TEXT NOT NULL DEFAULT 'beginner',
  goal TEXT NOT NULL DEFAULT 'strength',
  days_per_week INTEGER NOT NULL DEFAULT 4,
  session_minutes INTEGER NOT NULL DEFAULT 60,
  equipment TEXT NOT NULL DEFAULT '[]',
  limitations TEXT NOT NULL DEFAULT '[]',
  limitation_notes TEXT NOT NULL DEFAULT '',
  bodyweight REAL,
  onboarded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS programs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  next_day INTEGER NOT NULL DEFAULT 0,
  five_rms TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lift_states (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, exercise_id, tier)
);

CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  day_index INTEGER,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  summary TEXT
);
CREATE INDEX IF NOT EXISTS workouts_user_date ON workouts(user_id, date);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id INTEGER PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  tier TEXT NOT NULL,
  slot_id TEXT,
  scheme_label TEXT NOT NULL DEFAULT '',
  rest_seconds INTEGER NOT NULL DEFAULT 90,
  notes TEXT NOT NULL DEFAULT '',
  engine_note TEXT,
  substituted_from TEXT
);
CREATE INDEX IF NOT EXISTS wex_workout ON workout_exercises(workout_id);
CREATE INDEX IF NOT EXISTS wex_exercise ON workout_exercises(exercise_id);

CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY,
  workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'working',
  target_reps INTEGER,
  target_weight REAL,
  amrap INTEGER NOT NULL DEFAULT 0,
  actual_reps INTEGER,
  actual_weight REAL,
  rpe REAL,
  done INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS sets_wex ON sets(workout_exercise_id);

CREATE TABLE IF NOT EXISTS coach_messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id INTEGER REFERENCES workouts(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  actions TEXT NOT NULL DEFAULT '[]',
  sources TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS coach_user ON coach_messages(user_id, workout_id);

CREATE TABLE IF NOT EXISTS bodyweights (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (user_id, date)
);
`);

/** Run fn inside a transaction. */
export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}
