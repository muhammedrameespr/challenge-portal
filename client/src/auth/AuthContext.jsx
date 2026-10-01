import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onSessionExpired, readableError, refreshCsrfToken, request, setCsrfToken } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const initialize = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await refreshCsrfToken();
      try { setUser((await request('/auth/me', { auth: false })).user); }
      catch (e) { if (e.status !== 401) throw e; setUser(null); }
    } catch (e) { setError(readableError(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    onSessionExpired(() => {
      setUser(null);
      setNotice('Please sign in again.');
      refreshCsrfToken().catch(() => {});
    });
    initialize();
    return () => onSessionExpired(null);
  }, [initialize]);

  const login = useCallback(async (username, password) => {
    const data = await request('/auth/login', { method: 'POST', body: { username, password }, auth: false });
    setCsrfToken(data.csrfToken);
    setNotice('');
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await request('/auth/logout', { method: 'POST' });
    setUser(null);
    setNotice('');
    setCsrfToken(null);
    try { await refreshCsrfToken(); } catch { setNotice('Signed out. Reconnect to sign in again.'); }
  }, []);

  const value = useMemo(() => ({ user, loading, error, notice, initialize, login, logout }), [user, loading, error, notice, initialize, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
