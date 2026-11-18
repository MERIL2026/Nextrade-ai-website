import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface PublicAuthUser {
  id: string;
  fullName: string;
  email: string;
  emailVerified: boolean;
  accountStatus: string;
  role: string;
  permissions?: string[];
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PublicSessionInfo {
  id: string;
  current: boolean;
  userAgent: string;
  ipAddress: string;
  rememberMe: boolean;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface AuthConfigState {
  emailDeliveryConfigured: boolean;
  emailProvider: string;
  googleOAuthConfigured: boolean;
  passwordMinLength: number;
}

export interface InitialAuthPayload {
  authenticated: boolean;
  user: PublicAuthUser | null;
  session: PublicSessionInfo | null;
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: PublicAuthUser | null;
  session: PublicSessionInfo | null;
  config: AuthConfigState;
  refreshAuth: () => Promise<PublicAuthUser | null>;
  setAuthenticatedState: (user: PublicAuthUser, session: PublicSessionInfo | null) => void;
  clearAuthState: () => void;
  logout: () => Promise<void>;
}

const DEFAULT_CONFIG: AuthConfigState = {
  emailDeliveryConfigured: false,
  emailProvider: 'unconfigured',
  googleOAuthConfigured: false,
  passwordMinLength: 10,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function readSsrInitialAuth(): InitialAuthPayload | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('nextrade-ssr-auth');
  if (!el || !el.textContent) return null;
  try {
    const parsed = JSON.parse(el.textContent) as InitialAuthPayload;
    if (parsed && typeof parsed.authenticated === 'boolean') {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export const AuthProvider: React.FC<{
  initialAuth?: InitialAuthPayload | null;
  children: React.ReactNode;
}> = ({ initialAuth, children }) => {
  const [resolvedInitial] = useState<InitialAuthPayload | null>(
    () => initialAuth ?? readSsrInitialAuth(),
  );

  const [status, setStatus] = useState<AuthStatus>(() => {
    if (resolvedInitial?.authenticated && resolvedInitial.user) return 'authenticated';
    if (resolvedInitial && resolvedInitial.authenticated === false) return 'unauthenticated';
    return 'loading';
  });
  const [user, setUser] = useState<PublicAuthUser | null>(
    () => resolvedInitial?.user ?? null,
  );
  const [session, setSession] = useState<PublicSessionInfo | null>(
    () => resolvedInitial?.session ?? null,
  );
  const [config, setConfig] = useState<AuthConfigState>(DEFAULT_CONFIG);

  const refreshAuth = useCallback(async (): Promise<PublicAuthUser | null> => {
    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) {
        setUser(null);
        setSession(null);
        setStatus('unauthenticated');
        return null;
      }
      const data = (await res.json()) as {
        authenticated?: boolean;
        user?: PublicAuthUser;
        session?: PublicSessionInfo;
      };
      if (data.authenticated && data.user) {
        setUser(data.user);
        setSession(data.session ?? null);
        setStatus('authenticated');
        return data.user;
      }
      setUser(null);
      setSession(null);
      setStatus('unauthenticated');
      return null;
    } catch {
      setUser(null);
      setSession(null);
      setStatus('unauthenticated');
      return null;
    }
  }, []);

  useEffect(() => {
    if (resolvedInitial === null) {
      void refreshAuth();
    }
    fetch('/api/auth/config', { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AuthConfigState | null) => {
        if (data && typeof data.passwordMinLength === 'number') {
          setConfig(data);
        }
      })
      .catch(() => undefined);
  }, [refreshAuth, resolvedInitial]);

  const setAuthenticatedState = useCallback(
    (nextUser: PublicAuthUser, nextSession: PublicSessionInfo | null) => {
      setUser(nextUser);
      setSession(nextSession);
      setStatus('authenticated');
    },
    [],
  );

  const clearAuthState = useCallback(() => {
    setUser(null);
    setSession(null);
    setStatus('unauthenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      setUser(null);
      setSession(null);
      setStatus('unauthenticated');
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        session,
        config,
        refreshAuth,
        setAuthenticatedState,
        clearAuthState,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
