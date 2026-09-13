'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
const CLIENT_ID = '5tak108eukdjn8qfv274e2l62t',
  DOMAIN = 'https://ap-south-1z5si5hbmg.auth.ap-south-1.amazoncognito.com',
  REDIRECT_URI = 'https://fo-pilot-risk-engine.siajha18.chatgpt.site/';
const ALLOWED = new Set([
  'siajha18@gmail.com',
  'djjhaimu@gmail.com',
  'keshavjha63@gmail.com',
]);
type AuthState = {
  loading: boolean;
  email: string | null;
  token: string | null;
  error: string;
  signIn: () => Promise<void>;
  signOut: () => void;
};
const AuthContext = createContext<AuthState | null>(null),
  b64url = (b: Uint8Array) =>
    btoa(String.fromCharCode(...b))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, ''),
  decode = (t: string) =>
    JSON.parse(
      decodeURIComponent(
        atob(t.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))
          .split('')
          .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
          .join(''),
      ),
    );
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true),
    [email, setEmail] = useState<string | null>(null),
    [token, setToken] = useState<string | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const saved = sessionStorage.getItem('fo_auth');
        if (saved) {
          const s = JSON.parse(saved),
            p = decode(s.id_token);
          if (
            p.exp * 1000 > Date.now() &&
            ALLOWED.has(String(p.email).toLowerCase())
          ) {
            setEmail(p.email);
            setToken(s.access_token);
            return;
          }
          sessionStorage.removeItem('fo_auth');
        }
        const code = new URLSearchParams(location.search).get('code');
        if (!code) return;
        const verifier = sessionStorage.getItem('fo_pkce');
        if (!verifier)
          throw new Error('Login session expired. Please sign in again.');
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: verifier,
          }),
          r = await fetch(`${DOMAIN}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
          }),
          d = await r.json();
        if (!r.ok)
          throw new Error(d.error_description || 'Could not complete sign in');
        const p = decode(d.id_token),
          mail = String(p.email || '').toLowerCase();
        if (!ALLOWED.has(mail))
          throw new Error('This email is not approved for F&O Pilot.');
        sessionStorage.setItem('fo_auth', JSON.stringify(d));
        sessionStorage.removeItem('fo_pkce');
        history.replaceState({}, '', location.pathname);
        setEmail(mail);
        setToken(d.access_token);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sign in failed');
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  const signIn = async () => {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48))),
      digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(verifier),
      ),
      challenge = b64url(new Uint8Array(digest));
    sessionStorage.setItem('fo_pkce', verifier);
    const q = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      scope: 'openid email',
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    });
    location.href = `${DOMAIN}/oauth2/authorize?${q}`;
  };
  const signOut = () => {
    sessionStorage.removeItem('fo_auth');
    location.href = `${DOMAIN}/logout?${new URLSearchParams({ client_id: CLIENT_ID, logout_uri: REDIRECT_URI })}`;
  };
  const value = useMemo(
    () => ({ loading, email, token, error, signIn, signOut }),
    [loading, email, token, error],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}
export function LoginGate() {
  const a = useAuth();
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-br from-white via-sky-50 to-blue-100 p-5">
      <section className="w-full max-w-md rounded-3xl border border-sky-100 bg-white p-8 text-center shadow-xl shadow-sky-200/40">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-sky-500 text-lg font-bold text-white">
          F&O
        </div>
        <h1 className="mt-5 text-3xl font-bold text-slate-900">
          F&O Command Centre
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Private paper-trading dashboard
        </p>
        {a.error && (
          <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            {a.error}
          </p>
        )}
        <button
          onClick={a.signIn}
          disabled={a.loading}
          className="mt-6 w-full rounded-xl bg-sky-500 px-5 py-3 font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
        >
          {a.loading ? 'Checking access…' : 'Sign in securely'}
        </button>
        <p className="mt-5 text-xs text-slate-400">
          Access is limited to approved email addresses.
        </p>
      </section>
    </main>
  );
}
