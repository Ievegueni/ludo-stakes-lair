import { useState, useEffect, useCallback } from 'react';
import { api, type AuthUser } from '@/lib/api';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.auth.me().then((u) => {
      if (cancelled) return;
      setUser(u);
      setLoading(false);
    });
    const off = api.auth.onChange((u) => setUser(u));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const signOut = useCallback(async () => {
    api.auth.signOut();
  }, []);

  return { user, loading, signOut };
}
