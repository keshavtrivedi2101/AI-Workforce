import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  browserPopupRedirectResolver,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { hasExternalSupabaseAuth, supabase } from '../lib/supabase';
import { BusinessRecord, MembershipRecord, ProfileRecord } from '../types';

type AuthProviderType = 'firebase' | 'local' | 'supabase' | null;

interface WorkspaceSession {
  profile: ProfileRecord;
  business: BusinessRecord;
  membership: MembershipRecord;
}

interface AuthContextValue {
  loading: boolean;
  workspaceLoading: boolean;
  isAuthenticated: boolean;
  provider: AuthProviderType;
  workspace: WorkspaceSession | null;
  authError: string | null;
  clearAuthError: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (fullName: string, email: string, password: string) => Promise<void>;
  signInWithSupabaseEmail: (email: string, password: string) => Promise<void>;
  registerWithSupabaseEmail: (fullName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  apiFetch: <T = any>(path: string, init?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function parseApiResponse(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();
  if (contentType.includes('application/json')) {
    try {
      return rawText ? JSON.parse(rawText) : {};
    } catch {
      return { error: 'Received an incomplete JSON response from server. Please retry.' };
    }
  }
  if (rawText.trim().startsWith('<')) {
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      return {
        error: `Server gateway timeout (${response.status}). Please retry the action.`,
      };
    }
    return {
      error: `Unexpected server response (${response.status}). Please refresh or retry.`,
    };
  }
  return { error: rawText.slice(0, 240) || `Request failed (${response.status})` };
}

function formatGoogleAuthError(err: any): string {
  const code = err?.code || '';
  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the Google sign-in popup inside this preview frame. Allow popups for this site, or sign in immediately below using your email and password.';
  }
  if (code === 'auth/cancelled-popup-request') {
    return 'Another sign-in popup is already open. Complete that window or sign in with your email and password below.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'Google OAuth popup is restricted on this preview domain. Please sign in or create an account below using your email and password.';
  }
  if (code === 'auth/web-storage-unsupported' || code === 'auth/internal-error') {
    return 'Browser third-party storage restrictions prevented Google popup sign-in in this frame. Please use Email & Password sign-in below for instant access.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network connection interrupted during Google Sign-In. Please retry or sign in with your email and password below.';
  }
  return err?.message || 'Google Sign-In could not be completed. You can also sign in with Email & Password below.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [localToken, setLocalToken] = useState<string | null>(null);
  const [supabaseToken, setSupabaseToken] = useState<string | null>(null);
  const [provider, setProvider] = useState<AuthProviderType>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSession | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Store active token strictly in memory (never in localStorage)
  const tokenCacheRef = useRef<{ token: string | null; provider: AuthProviderType }>({
    token: null,
    provider: null,
  });

  const getFreshToken = useCallback(async (): Promise<{
    token: string | null;
    provider: AuthProviderType;
  }> => {
    if (tokenCacheRef.current.provider === 'local' && tokenCacheRef.current.token) {
      return { token: tokenCacheRef.current.token, provider: 'local' };
    }
    if (localToken) {
      tokenCacheRef.current = { token: localToken, provider: 'local' };
      return { token: localToken, provider: 'local' };
    }

    const activeFbUser = firebaseUser || auth.currentUser;
    if (activeFbUser) {
      const token = await activeFbUser.getIdToken();
      tokenCacheRef.current = { token, provider: 'firebase' };
      return { token, provider: 'firebase' };
    }

    if (hasExternalSupabaseAuth && supabase && (supabaseToken || tokenCacheRef.current.provider === 'supabase')) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token || supabaseToken || tokenCacheRef.current.token;
      if (token) {
        tokenCacheRef.current = { token, provider: 'supabase' };
        return { token, provider: 'supabase' };
      }
    }

    if (tokenCacheRef.current.token && tokenCacheRef.current.provider) {
      return tokenCacheRef.current;
    }

    return { token: null, provider: null };
  }, [firebaseUser, localToken, supabaseToken]);

  const clearClientSession = useCallback(() => {
    tokenCacheRef.current = { token: null, provider: null };
    setFirebaseUser(null);
    setLocalToken(null);
    setSupabaseToken(null);
    setProvider(null);
    setWorkspace(null);
  }, []);

  const loadWorkspaceWithToken = useCallback(
    async (token: string, activeProvider: 'firebase' | 'local' | 'supabase') => {
      setWorkspaceLoading(true);
      try {
        const res = await fetch('/api/workspace', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Auth-Provider': activeProvider,
          },
        });
        const data = await parseApiResponse(res);
        if (res.status === 401) {
          clearClientSession();
          setAuthError(data?.error || 'Your session expired. Please sign in again.');
          return;
        }
        if (!res.ok) {
          throw new Error(data?.error || 'Unable to load workspace.');
        }
        setWorkspace(data);
        setAuthError(null);
      } catch (err: any) {
        setAuthError(err?.message || 'Unable to connect to workspace service.');
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [clearClientSession]
  );

  const apiFetch = useCallback(
    async <T = any>(path: string, init?: RequestInit): Promise<T> => {
      const { token, provider: activeProvider } = await getFreshToken();
      if (!token) {
        throw new Error('Your session has ended. Please sign in to continue.');
      }

      const headersObj: Record<string, string> = {};
      if (init?.headers) {
        const existing = new Headers(init.headers);
        existing.forEach((value, key) => {
          headersObj[key] = value;
        });
      }
      headersObj['Authorization'] = `Bearer ${token}`;
      if (activeProvider) {
        headersObj['X-Auth-Provider'] = activeProvider;
      }
      if (init?.body && !headersObj['Content-Type'] && !headersObj['content-type']) {
        headersObj['Content-Type'] = 'application/json';
      }

      const response = await fetch(path, {
        ...init,
        headers: headersObj,
      });

      const payload = await parseApiResponse(response);

      if (response.status === 401) {
        clearClientSession();
        setAuthError(payload?.error || 'Your session expired. Please sign in again.');
        throw new Error(payload?.error || 'Unauthorized');
      }

      if (!response.ok) {
        throw new Error(payload?.error || `Request failed (${response.status})`);
      }

      return payload as T;
    },
    [getFreshToken, clearClientSession]
  );

  const refreshWorkspace = useCallback(async () => {
    const { token, provider: activeProvider } = await getFreshToken();
    if (token && activeProvider) {
      await loadWorkspaceWithToken(token, activeProvider);
    }
  }, [getFreshToken, loadWorkspaceWithToken]);

  useEffect(() => {
    let settled = false;
    const safetyTimer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setLoading(false);
      }
    }, 3000);

    const unsubscribeFirebase = onAuthStateChanged(
      auth,
      async (user) => {
        if (user) {
          // Do not overwrite an active local session if one was explicitly chosen
          if (tokenCacheRef.current.provider === 'local' && tokenCacheRef.current.token) {
            settled = true;
            window.clearTimeout(safetyTimer);
            setLoading(false);
            return;
          }
          setFirebaseUser(user);
          setProvider('firebase');
          try {
            const token = await user.getIdToken();
            tokenCacheRef.current = { token, provider: 'firebase' };
            await loadWorkspaceWithToken(token, 'firebase');
          } catch (err: any) {
            setAuthError(err?.message || 'Failed to verify authentication token.');
          }
        } else {
          setFirebaseUser(null);
          if (tokenCacheRef.current.provider === 'firebase') {
            tokenCacheRef.current = { token: null, provider: null };
            setProvider(null);
            setWorkspace(null);
          }
        }
        settled = true;
        window.clearTimeout(safetyTimer);
        setLoading(false);
      },
      (err) => {
        console.warn('Firebase Auth listener warning:', err);
        settled = true;
        window.clearTimeout(safetyTimer);
        setLoading(false);
      }
    );

    let unsubscribeSupabase: (() => void) | undefined;
    if (hasExternalSupabaseAuth && supabase) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session?.access_token) {
          setSupabaseToken(data.session.access_token);
          setProvider('supabase');
          tokenCacheRef.current = { token: data.session.access_token, provider: 'supabase' };
          loadWorkspaceWithToken(data.session.access_token, 'supabase');
        }
      });

      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.access_token) {
          setSupabaseToken(session.access_token);
          setProvider('supabase');
          tokenCacheRef.current = { token: session.access_token, provider: 'supabase' };
          loadWorkspaceWithToken(session.access_token, 'supabase');
        } else if (tokenCacheRef.current.provider === 'supabase') {
          setSupabaseToken(null);
          tokenCacheRef.current = { token: null, provider: null };
          setProvider(null);
          setWorkspace(null);
        }
      });
      unsubscribeSupabase = () => listener.subscription.unsubscribe();
    }

    return () => {
      window.clearTimeout(safetyTimer);
      unsubscribeFirebase();
      if (unsubscribeSupabase) unsubscribeSupabase();
    };
  }, [loadWorkspaceWithToken]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      const credential = await signInWithPopup(
        auth,
        googleAuthProvider,
        browserPopupRedirectResolver
      );
      if (credential?.user) {
        const token = await credential.user.getIdToken(true);
        tokenCacheRef.current = { token, provider: 'firebase' };
        setLocalToken(null);
        setFirebaseUser(credential.user);
        setProvider('firebase');
        await loadWorkspaceWithToken(token, 'firebase');
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        return;
      }
      setAuthError(formatGoogleAuthError(err));
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    if (hasExternalSupabaseAuth && supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthError(error.message);
      }
      return;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await parseApiResponse(res);
      if (!res.ok) {
        setAuthError(data?.error || 'Invalid email address or password.');
        return;
      }
      tokenCacheRef.current = { token: data.token, provider: 'local' };
      setLocalToken(data.token);
      setProvider('local');
      setWorkspace(data.workspace);
      setAuthError(null);
    } catch (err: any) {
      setAuthError(err?.message || 'Unable to sign in right now. Please try again.');
    }
  };

  const registerWithEmail = async (fullName: string, email: string, password: string) => {
    setAuthError(null);
    if (hasExternalSupabaseAuth && supabase) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) {
        setAuthError(error.message);
      }
      return;
    }

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, password }),
      });
      const data = await parseApiResponse(res);
      if (!res.ok) {
        setAuthError(data?.error || 'Unable to create workspace account.');
        return;
      }
      tokenCacheRef.current = { token: data.token, provider: 'local' };
      setLocalToken(data.token);
      setProvider('local');
      setWorkspace(data.workspace);
      setAuthError(null);
    } catch (err: any) {
      setAuthError(err?.message || 'Unable to create workspace account. Please try again.');
    }
  };

  const signOut = async () => {
    setAuthError(null);
    try {
      if (firebaseUser || auth.currentUser) {
        await firebaseSignOut(auth);
      }
      if (hasExternalSupabaseAuth && supabase) {
        await supabase.auth.signOut();
      }
    } catch (err) {
      console.warn('Sign out cleanup warning:', err);
    } finally {
      clearClientSession();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        loading,
        workspaceLoading,
        isAuthenticated: Boolean(localToken || firebaseUser || supabaseToken),
        provider,
        workspace,
        authError,
        clearAuthError: () => setAuthError(null),
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        signInWithSupabaseEmail: signInWithEmail,
        registerWithSupabaseEmail: registerWithEmail,
        signOut,
        refreshWorkspace,
        apiFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
