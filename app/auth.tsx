'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

const API = 'https://michel-specially-hostel-tahoe.trycloudflare.com';
type AuthState = { loading: boolean; email: string | null; token: string | null; error: string; signOut: () => void; complete: (data: { email: string; token: string }) => void };
const AuthContext = createContext<AuthState | null>(null);
async function post(path: string, body: unknown) {
  const response = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || 'Request failed');
  return data;
}
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true), [email, setEmail] = useState<string | null>(null), [token, setToken] = useState<string | null>(null);
  useEffect(() => { const saved = localStorage.getItem('fo_auth'); if (saved) try { const v = JSON.parse(saved); setEmail(v.email); setToken(v.token); } catch { localStorage.removeItem('fo_auth'); } setLoading(false); }, []);
  const complete = (data: { email: string; token: string }) => { localStorage.setItem('fo_auth', JSON.stringify(data)); setEmail(data.email); setToken(data.token); };
  const signOut = () => { const old = token; localStorage.removeItem('fo_auth'); setEmail(null); setToken(null); if (old) fetch(`${API}/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${old}` } }).catch(() => undefined); };
  const value = useMemo(() => ({ loading, email, token, error: '', signOut, complete }), [loading, email, token]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider missing'); return value; }
export function LoginGate() {
  const auth = useAuth(), [step, setStep] = useState<'login'|'otp'|'password'>('login');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [otp, setOtp] = useState(''), [setupToken, setSetupToken] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); } finally { setBusy(false); } };
  const requestOtp = () => run(async () => { await post('/v1/auth/request-otp', { email }); setMessage('A six-digit code was sent to your email.'); setStep('otp'); });
  const verifyOtp = () => run(async () => { const d = await post('/v1/auth/verify-otp', { email, otp }); setSetupToken(d.setup_token); setStep('password'); });
  const setNewPassword = () => run(async () => { if (password !== confirm) throw new Error('Passwords do not match'); auth.complete(await post('/v1/auth/set-password', { setup_token: setupToken, password })); });
  const login = () => run(async () => auth.complete(await post('/v1/auth/login', { email, password })));
  return <main className="grid min-h-screen place-items-center bg-gradient-to-br from-white via-sky-50 to-blue-100 p-5"><section className="w-full max-w-md rounded-3xl border border-sky-100 bg-white p-8 shadow-xl shadow-sky-200/40">
    <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-sky-500 text-lg font-bold text-white">F&O</div>
    <h1 className="mt-5 text-center text-3xl font-bold text-slate-900">F&O Command Centre</h1><p className="mt-2 text-center text-sm text-slate-500">Secure access for approved users</p>
    {message && <p className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}{error && <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {step === 'login' && <div className="mt-6 space-y-4"><label className="block text-sm font-medium text-slate-700">Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="email" className="mt-1 w-full rounded-xl border border-sky-200 px-4 py-3"/></label><label className="block text-sm font-medium text-slate-700">Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password" className="mt-1 w-full rounded-xl border border-sky-200 px-4 py-3"/></label><button onClick={login} disabled={busy} className="w-full rounded-xl bg-sky-500 px-5 py-3 font-semibold text-white disabled:opacity-60">Sign in</button><button onClick={requestOtp} disabled={busy||!email} className="w-full text-sm font-semibold text-sky-700">First login or reset password</button></div>}
    {step === 'otp' && <div className="mt-6 space-y-5 text-center"><InputOTP maxLength={6} value={otp} onChange={setOtp}><InputOTPGroup className="mx-auto">{[0,1,2,3,4,5].map(i=><InputOTPSlot key={i} index={i}/>)}</InputOTPGroup></InputOTP><button onClick={verifyOtp} disabled={busy||otp.length!==6} className="w-full rounded-xl bg-sky-500 px-5 py-3 font-semibold text-white disabled:opacity-60">Verify code</button><button onClick={requestOtp} disabled={busy} className="text-sm font-semibold text-sky-700">Send a new code</button></div>}
    {step === 'password' && <div className="mt-6 space-y-4"><p className="text-sm text-slate-600">Use at least 10 characters with uppercase, lowercase and a number.</p><input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="New password" autoComplete="new-password" className="w-full rounded-xl border border-sky-200 px-4 py-3"/><input value={confirm} onChange={e=>setConfirm(e.target.value)} type="password" placeholder="Confirm password" autoComplete="new-password" className="w-full rounded-xl border border-sky-200 px-4 py-3"/><button onClick={setNewPassword} disabled={busy} className="w-full rounded-xl bg-sky-500 px-5 py-3 font-semibold text-white disabled:opacity-60">Set password and sign in</button></div>}
    <p className="mt-6 text-center text-xs text-slate-400">Only the four approved email addresses can request a code.</p>
  </section></main>;
}
