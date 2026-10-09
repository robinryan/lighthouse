import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, type Exercise, type Profile, type User } from './api';

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loaderRef.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, deps);
  return { data, error, loading, reload, setData };
}

let exercisesPromise: Promise<Exercise[]> | null = null;
export function useExercises(): Exercise[] {
  const [list, setList] = useState<Exercise[]>([]);
  useEffect(() => {
    exercisesPromise ??= api.get<Exercise[]>('/exercises').catch((e) => { exercisesPromise = null; throw e; });
    exercisesPromise.then(setList).catch(() => {});
  }, []);
  return list;
}

export interface Session {
  user: User;
  profile: Profile;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
}
export const SessionContext = createContext<Session | null>(null);
export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside provider');
  return s;
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
