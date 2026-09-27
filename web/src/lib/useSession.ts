import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Session } from './types';

type Status = 'loading' | 'authenticated' | 'anonymous' | 'forbidden';

/**
 * Holds the signed-in person, the space, and the partner. This is the only
 * source of identity in the client — nothing trusts a user id from storage.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  const refresh = useCallback(async () => {
    try {
      const next = await api.get<Session>('/auth/me');
      setSession(next);
      setStatus('authenticated');
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) setStatus('forbidden');
      else if (error instanceof ApiError && error.status === 401) setStatus('anonymous');
      else setStatus('anonymous');
      setSession(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');
    setSession(null);
    setStatus('anonymous');
  }, []);

  const patch = useCallback((partial: Partial<Session>) => {
    setSession((current) => (current ? { ...current, ...partial } : current));
  }, []);

  return { session, status, refresh, signOut, patch, setSession };
}
