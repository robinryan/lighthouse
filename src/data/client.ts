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

/**
 * Where auth emails (confirmation, password reset, magic link) send people back to.
 * Set VITE_SITE_URL to the published address so links requested from a preview
 * still open the live app; otherwise it's the current address.
 */
export function siteUrl(): string {
  const configured = (import.meta.env?.VITE_SITE_URL as string | undefined)?.trim();
  return (configured || window.location.origin).replace(/\/+$/, '');
}

/** An error Supabase put in the URL after a failed email link (e.g. expired), then removed from the address bar. */
export function takeAuthLinkError(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, '') || window.location.search);
  const description = params.get('error_description');
  if (!description) return null;
  window.history.replaceState(null, '', window.location.pathname);
  return params.get('error_code') === 'otp_expired'
    ? 'That email link has expired or was already used. Request a new one below.'
    : description.replace(/\+/g, ' ');
}
