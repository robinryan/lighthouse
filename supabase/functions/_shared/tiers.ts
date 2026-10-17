// User classes: free, paid and admin. Admins are listed by email (so the owner is always an admin,
// even before the user_tiers row exists); everyone else's class is in user_tiers, default free.
// Everything here runs with the service-role client inside the coach edge function.

import { type CoachLimits, type Tier, limitStats } from './coach.ts';
import { type Db, must } from './queries.ts';

export const DEFAULT_ADMIN_EMAILS = ['robin.ryan@gmail.com'];

/** Parse a comma-separated list of admin emails (the COACH_ADMIN_EMAILS secret), falling back to the default. */
export function adminEmails(raw?: string | null): string[] {
  const list = (raw ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : DEFAULT_ADMIN_EMAILS;
}

export async function resolveTier(admin: Db, user: { id: string; email?: string | null }, admins: string[]): Promise<Tier> {
  if (user.email && admins.includes(user.email.toLowerCase())) return 'admin';
  const row = must(await admin.from('user_tiers').select('tier').eq('user_id', user.id).maybeSingle()) as { tier: Tier } | null;
  return row?.tier ?? 'free';
}

/** What a user sees about their own plan. Dollar amounts only for admins. */
export interface MyPlan {
  tier: Tier;
  research: boolean;
  /** Share of this month's coach allowance used, 0–100 (null when unlimited). */
  usedPct: number | null;
  messagesToday: number;
  dailyLimit: number;
  spentUsd?: number;
  allowanceUsd?: number;
}

export async function myPlan(admin: Db, userId: string, tier: Tier, limits: CoachLimits): Promise<MyPlan> {
  const s = await limitStats(admin, userId);
  const plan: MyPlan = {
    tier, research: tier !== 'free',
    usedPct: limits.budgetUsd > 0 ? Math.min(100, Math.round((s.user_month / limits.budgetUsd) * 100)) : null,
    messagesToday: s.last_day, dailyLimit: limits.daily,
  };
  if (tier === 'admin') { plan.spentUsd = s.user_month; plan.allowanceUsd = limits.budgetUsd; }
  return plan;
}

export interface AdminUserRow {
  id: string; email: string; name: string; tier: Tier; joined: string; workouts: number; last_workout: string | null;
  month_usd: number; total_usd: number; month_messages: number; total_messages: number; last_coach: string | null;
  /** Admin because of the email list (can't be changed from the app). */
  fixedAdmin: boolean;
}
export interface AdminReport {
  users: AdminUserRow[];
  byModel: Array<{ model: string; replies: number; usd: number }>;
  byDay: Array<{ day: string; replies: number; usd: number }>;
  totals: { users: number; free: number; paid: number; admin: number; monthUsd: number; monthMessages: number; avgUsdPerActiveUser: number };
}

export async function adminReport(admin: Db, admins: string[]): Promise<AdminReport> {
  const raw = must(await admin.rpc('coach_admin_report', {})) as { users: AdminUserRow[]; byModel: AdminReport['byModel']; byDay: AdminReport['byDay'] };
  const users = (raw.users ?? []).map((u) => {
    const fixedAdmin = admins.includes((u.email ?? '').toLowerCase());
    return { ...u, tier: fixedAdmin ? 'admin' as Tier : u.tier, fixedAdmin, month_usd: Number(u.month_usd), total_usd: Number(u.total_usd),
      month_messages: Number(u.month_messages), total_messages: Number(u.total_messages), workouts: Number(u.workouts) };
  });
  const active = users.filter((u) => u.month_messages > 0);
  const monthUsd = users.reduce((a, u) => a + u.month_usd, 0);
  return {
    users,
    byModel: (raw.byModel ?? []).map((m) => ({ ...m, replies: Number(m.replies), usd: Number(m.usd) })),
    byDay: (raw.byDay ?? []).map((d) => ({ ...d, replies: Number(d.replies), usd: Number(d.usd) })),
    totals: {
      users: users.length,
      free: users.filter((u) => u.tier === 'free').length,
      paid: users.filter((u) => u.tier === 'paid').length,
      admin: users.filter((u) => u.tier === 'admin').length,
      monthUsd, monthMessages: users.reduce((a, u) => a + u.month_messages, 0),
      avgUsdPerActiveUser: active.length ? monthUsd / active.length : 0,
    },
  };
}

/** Move a user between free and paid. Admins come from the email list, not from here. */
export async function setTier(admin: Db, actorId: string, userId: string, tier: Tier, admins: string[]) {
  if (tier !== 'free' && tier !== 'paid') throw new Error('Users can be moved between free and paid only');
  const target = must(await admin.from('profiles').select('user_id').eq('user_id', userId).maybeSingle());
  if (!target) throw new Error('User not found');
  const report = await adminReport(admin, admins);
  if (report.users.find((u) => u.id === userId)?.fixedAdmin) throw new Error('This account is always an admin (set by email).');
  must(await admin.from('user_tiers').upsert({ user_id: userId, tier, updated_at: new Date().toISOString(), updated_by: actorId }, { onConflict: 'user_id' }));
}
