'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export interface AuthUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
}

interface AuthCtx {
  token: string | null;
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  api: (path: string, opts?: RequestInit) => Promise<any>;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

const TOKEN_KEY = 'jh_token';
const USER_KEY = 'jh_user';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      if (t) {
        setToken(t);
        setUser(JSON.parse(localStorage.getItem(USER_KEY) || 'null'));
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const clear = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  };

  const api = async (path: string, opts: RequestInit = {}): Promise<any> => {
    const headers: Record<string, string> = { ...(opts.headers as any) };
    if (opts.body && typeof opts.body === 'string') headers['content-type'] = 'application/json';
    // Fall back to the persisted token: on a hard reload/navigation, useApi() can
    // fire before the AuthProvider effect restores `token` from localStorage.
    // Without this, the tokenless request 401s and the app wrongly logs the user out.
    const tk = token ?? (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null);
    if (tk) headers['authorization'] = `Bearer ${tk}`;
    const url = API_BASE ? `${API_BASE}${path}` : path;
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401) {
      clear();
      router.push('/login');
      throw new Error('Session expired — please log in');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `Request failed (${res.status})`);
    return data;
  };

  const authenticate = async (path: string, email: string, password: string) => {
    const url = API_BASE ? `${API_BASE.replace(/\/$/, '')}${path}` : path;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.accessToken) {
      throw new Error(data?.message || `Authentication failed (${response.status})`);
    }
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setToken(data.accessToken);
    setUser(data.user);
    router.push('/dashboard');
  };

  const login = (email: string, password: string) => authenticate('/api/auth/login', email, password);
  const register = (email: string, password: string) => authenticate('/api/auth/register', email, password);

  const logout = () => {
    clear();
    router.push('/login');
  };

  return (
    <Ctx.Provider value={{ token, user, ready, login, register, logout, api }}>
      {children}
    </Ctx.Provider>
  );
}
