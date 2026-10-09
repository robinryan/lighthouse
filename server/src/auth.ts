import crypto from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { db } from './db.js';

const SESSION_COOKIE = 'lh_session';
const SESSION_DAYS = 60;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { userId?: number }
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(res: Response, userId: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, expires.toISOString());
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
    path: '/',
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token) {
    const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as
      | { user_id: number; expires_at: string } | undefined;
    if (row && Date.parse(row.expires_at) > Date.now()) {
      req.userId = row.user_id;
      return next();
    }
  }
  res.status(401).json({ error: 'Not signed in' });
}

// Naive in-memory throttle for login attempts (per email+ip).
const attempts = new Map<string, { count: number; until: number }>();
function throttled(key: string): boolean {
  const a = attempts.get(key);
  return !!a && a.count >= 8 && a.until > Date.now();
}
function noteFailure(key: string) {
  const a = attempts.get(key);
  const fresh = !a || a.until < Date.now();
  attempts.set(key, { count: fresh ? 1 : a!.count + 1, until: Date.now() + 15 * 60_000 });
}

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});
const Register = Credentials.extend({
  name: z.string().trim().min(1).max(80),
  inviteCode: z.string().optional(),
});

export const authRouter = Router();

authRouter.get('/config', (_req, res) => {
  res.json({ signupOpen: signupOpen(), inviteRequired: !!process.env.SIGNUP_INVITE_CODE });
});

function signupOpen(): boolean {
  if (process.env.ALLOW_SIGNUP === 'false') {
    // Always allow the very first account so the owner can get in.
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return n === 0;
  }
  return true;
}

authRouter.post('/register', (req, res) => {
  const parsed = Register.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const { email, password, name, inviteCode } = parsed.data;
  if (!signupOpen()) return res.status(403).json({ error: 'Sign-ups are closed' });
  const invite = process.env.SIGNUP_INVITE_CODE;
  if (invite && inviteCode !== invite) return res.status(403).json({ error: 'Invalid invite code' });
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'An account with that email already exists' });
  const info = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
    .run(email, name, hashPassword(password));
  const userId = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO profiles (user_id) VALUES (?)').run(userId);
  createSession(res, userId);
  res.status(201).json({ id: userId, email, name });
});

authRouter.post('/login', (req, res) => {
  const parsed = Credentials.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter your email and password' });
  const { email, password } = parsed.data;
  const key = `${email}|${req.ip}`;
  if (throttled(key)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const user = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(email) as
    | { id: number; name: string; email: string; password_hash: string } | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    noteFailure(key);
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  attempts.delete(key);
  createSession(res, user.id);
  res.json({ id: user.id, email: user.email, name: user.name });
});

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string') db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.userId);
  res.json(user);
});

authRouter.post('/password', requireAuth, (req, res) => {
  const body = z.object({ current: z.string(), next: z.string().min(8).max(200) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.userId) as { password_hash: string };
  if (!verifyPassword(body.data.current, row.password_hash)) return res.status(401).json({ error: 'Current password is wrong' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.data.next), req.userId);
  res.json({ ok: true });
});
