import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Db } from '../../supabase/functions/_shared/queries.ts';

let instance: SupabaseClient | null = null;

export function isConfigured(): boolean {
  return !!(import.meta.env?.VITE_SUPABASE_URL && import.meta.env?.VITE_SUPABASE_ANON_KEY);
}

/** The Supabase client. Tests can swap in another implementation with setDb(). */
export function db(): SupabaseClient {
  if (!instance) {
    const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !key) throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
    instance = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return instance;
}

export function setDb(client: Db) { instance = client as SupabaseClient; }

export async function currentUserId(): Promise<string> {
  const { data } = await db().auth.getSession();
  const id = data.session?.user?.id as string | undefined;
  if (!id) throw new Error('Not signed in');
  return id;
}
