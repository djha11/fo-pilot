'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Bell, ChartNoAxesCombined, Check, Clock3, Cloud, LayoutDashboard, Menu, OctagonAlert, Radio, RefreshCcw, ShieldCheck, Sparkles, TrendingUp, WalletCards, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

const API = 'https://michel-specially-hostel-tahoe.trycloudflare.com';
type Leg = { transaction_type: string; strike: number; option_type: string; quantity: number; entry_price: number };
type Opportunity = { id: string; rank: number; strategy: string; expiry: string; probability_of_profit: number; max_profit_inr: number; max_loss_inr: number; score: number; legs: Leg[]; rationale: string[] };
type Position = { id: number; strategy: string; expiry: string; predicted_pop: number; planned_max_loss_inr: number; max_profit_inr: number; unrealized_pnl_inr: number | null; opened_at: string; legs: Leg[]; rationale: string[] };
type Learning = { mode: string; completed_trades: number; profitable_trades: number; minimum_samples_per_group: number };
type Training = { activated: boolean; training_days: number; validation_days: number };
type Point = { time: string; open: number; high: number; low: number; close: number };

const nav = [
  ['Overview', LayoutDashboard, 'overview'], ['Live chart', ChartNoAxesCombined, 'live-chart'],
  ['Opportunities', Sparkles, 'opportunities'], ['Positions', Activity, 'positions'],
] as const;

export default function Home() {
  const [menu, setMenu] = useState(false);
  const [items, setItems] = useState<Opportunity[]>([]);
  const [position, setPosition] = useState<Position | null>(null);
  const [dailyPnl, setDailyPnl] = useState(0);
  const [nifty, setNifty] = useState<number | null>(null);
  const [previousClose, setPreviousClose] = useState<number | null>(null);
  const [chart, setChart] = useState<Point[]>([]);
  const [marketStatus, setMarketStatus] = useState('CHECKING');
  const [marketOpen, setMarketOpen] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [decision, setDecision] = useState('LOADING');
  const [reason, setReason] = useState('Connecting to the risk engine…');
  const [updated, setUpdated] = useState<string | null>(null);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [training, setTraining] = useState<Training | null>(null);
  const [exiting, setExiting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const responses = await Promise.all([
        fetch(`${API}/v1/market/nifty`), fetch(`${API}/v1/opportunities`),
        fetch(`${API}/v1/market/nifty/chart`), fetch(`${API}/v1/paper/portfolio`),
      ]);
      if (!responses.every(r => r.ok)) throw new Error();
      const [market, scan, chartData, portfolio] = await Promise.all(responses.map(r => r.json()));
      setNifty(market.last_price); setPreviousClose(market.previous_close);
      setMarketStatus(market.market_status ?? 'UNKNOWN'); setMarketOpen(Boolean(market.market_is_open));
      setItems(scan.items ?? []); setScanned(scan.contracts_scanned ?? 0);
      setDecision(scan.decision ?? 'NO_TRADE'); setReason(scan.reason ?? ''); setUpdated(scan.as_of ?? market.as_of);
      setLearning(scan.learning ?? null); setTraining(scan.historical_training ?? null);
      setChart(chartData.points ?? []); setPosition(portfolio.open_position ?? null);
      setDailyPnl(portfolio.daily_realized_pnl_inr ?? 0);
    } catch {
      setDecision('OFFLINE'); setMarketStatus('UNAVAILABLE'); setMarketOpen(false);
      setReason('The market gateway is temporarily unavailable. Automatic entry is paused safely.');
    }
  }, []);

  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 15000); return () => window.clearInterval(timer); }, [refresh]);
  const change = nifty !== null && previousClose ? nifty - previousClose : null;
  const changePct = change !== null && previousClose ? change / previousClose * 100 : null;
  const points = useMemo(() => chart.map(p => ({ ...p, label: new Date(p.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) })), [chart]);
  const riskLeft = Math.max(0, 600 + Math.min(0, dailyPnl));
  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date());
  const go = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); setMenu(false); };
  const exit = async () => { if (!position || exiting) return; setExiting(true); try { await fetch(`${API}/v1/positions/${position.id}/exit`, { method: 'POST' }); await refresh(); } finally { setExiting(false); } };

  return <main className="min-h-screen bg-background text-foreground">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-sky-100 bg-white px-4 py-5 transition-transform lg:translate-x-0 ${menu ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="mb-8 flex items-center gap-3 px-2"><div className="grid size-10 place-items-center rounded-xl bg-sky-500 text-white shadow-lg"><ChartNoAxesCombined className="size-5" /></div><div><p className="text-[15px] font-bold">F&O Pilot</p><p className="text-xs text-slate-400">Autonomous paper engine</p></div><button className="ml-auto lg:hidden" onClick={() => setMenu(false)} aria-label="Close menu"><X /></button></div>
      <nav className="space-y-1">{nav.map(([label, Icon, target], i) => <button key={label} onClick={() => go(target)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${i ? 'text-slate-500 hover:bg-slate-50' : 'bg-sky-50 text-sky-700'}`}><Icon className="size-[18px]" />{label}</button>)}</nav>
      <div className="mt-auto rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-sky-700"><Cloud className="size-4" /> Cloud engine online</div><p className="text-[11px] leading-relaxed text-slate-500">Updates every 15 seconds. Paper entries and exits run even while this page is closed.</p></div>
    </aside>
    {menu && <button className="fixed inset-0 z-30 bg-slate-950/20 lg:hidden" onClick={() => setMenu(false)} aria-label="Close menu" />}
    <section className="min-h-screen lg:pl-[248px]">
      <header className="sticky top-0 z-20 flex h-[72px] items-center border-b border-sky-100/80 bg-white/90 px-5 backdrop-blur-xl sm:px-8"><button className="mr-3 lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu"><Menu className="size-5" /></button><div><h1 className="text-lg font-bold text-slate-900">F&O command centre</h1><p className="hidden text-xs text-slate-400 sm:block">{today} · Indian market</p></div><div className="ml-auto flex items-center gap-3"><div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${marketOpen ? 'border-emerald-100 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}><span className={`size-2 rounded-full ${marketOpen ? 'animate-pulse bg-emerald-500' : 'bg-slate-400'}`} /><span className="text-xs font-semibold text-slate-600">{marketOpen ? 'Market open' : marketStatus === 'NORMAL_CLOSE' ? 'Market closed' : marketStatus.replaceAll('_', ' ').toLowerCase()}</span></div><Button variant="outline" size="icon" className="rounded-full border-sky-100"><Bell /></Button><div className="grid size-9 place-items-center rounded-full bg-sky-600 text-xs font-bold text-white">DK</div></div></header>
      <div id="overview" className="mx-auto max-w-[1500px] scroll-mt-24 p-5 sm:p-8">
        <section className="mb-6 flex flex-col gap-4 rounded-2xl border border-sky-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-sky-100 text-sky-700"><RefreshCcw className="size-5" /></div><div><div className="flex items-center gap-2"><p className="text-sm font-bold text-slate-800">Automatic paper trading</p><Badge className="bg-emerald-100 text-emerald-700">RUNNING</Badge></div><p className="mt-0.5 text-xs text-slate-500">Automatic entry and exit · no approval required</p></div></div><div className="flex gap-2"><Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">PAPER ≥ 75%</Badge><Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-500">REAL ≥ 95% · LOCKED</Badge></div></section>
        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><button onClick={() => go('live-chart')} className="text-left"><Metric icon={<TrendingUp />} label="NIFTY 50 · OPEN CHART" value={nifty?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ?? 'Connecting…'} meta={change === null ? 'Upstox market feed' : `${change >= 0 ? '+' : ''}${change.toFixed(2)} · ${changePct?.toFixed(2)}%`} positive={change !== null && change >= 0} /></button><Metric icon={<Radio />} label="SCANNER DECISION" value={decision === 'TRADE_CANDIDATES' ? 'Candidates ready' : decision === 'NO_TRADE' ? 'No trade' : decision === 'OFFLINE' ? 'Offline' : 'Scanning…'} meta={`${scanned} contracts checked`} /><Metric icon={<WalletCards />} label="PAPER CAPITAL" value="₹50,000" meta={position ? '1 open position' : 'No open exposure'} /><Metric icon={<ShieldCheck />} label="DAILY RISK LEFT" value={`₹${riskLeft.toFixed(0)}`} meta={`Realized today: ${money(dailyPnl)}`} progress={riskLeft / 6} /></section>

        <section id="live-chart" className="mb-6 scroll-mt-24 overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100 px-5 py-4"><div><h2 className="font-bold text-slate-900">NIFTY 50 live intraday</h2><p className="mt-1 text-xs text-slate-500">One-minute Upstox candles · {marketOpen ? 'updating while the market trades' : 'final session prices; market is closed'}</p></div><div className="flex items-center gap-2"><Badge className={marketOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}>{marketOpen ? 'LIVE' : 'CLOSED'}</Badge><Button variant="outline" onClick={refresh}><RefreshCcw /> Refresh</Button></div></div><div className="h-[320px] p-4 sm:h-[390px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={points}><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0ea5e9" stopOpacity={.28}/><stop offset="100%" stopColor="#0ea5e9" stopOpacity={.02}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#e0f2fe" vertical={false}/><XAxis dataKey="label" minTickGap={45} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false}/><YAxis domain={['dataMin - 10', 'dataMax + 10']} orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={64}/><Tooltip contentStyle={{ borderRadius: 12, borderColor: '#bae6fd', fontSize: 12 }} formatter={v => [Number(v).toLocaleString('en-IN'), 'NIFTY']}/><Area type="monotone" dataKey="close" stroke="#0284c7" strokeWidth={2.5} fill="url(#fill)" isAnimationActive={marketOpen}/></AreaChart></ResponsiveContainer></div></section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_350px]"><div className="space-y-6">
          <div id="positions" className="scroll-mt-24 rounded-2xl border border-sky-100 bg-white shadow-sm"><Title title="Paper position" subtitle="Monitored continuously by the cloud engine" />{position ? <div className="p-5"><div className="flex flex-col justify-between gap-5 sm:flex-row"><div><div className="flex items-center gap-2"><Badge className="bg-emerald-50 text-emerald-700">OPEN</Badge><h3 className="font-bold text-slate-900">{position.strategy}</h3></div><p className="mt-2 text-sm text-slate-600">{position.legs.map(l => `${l.transaction_type} ${l.strike} ${l.option_type} @ ₹${l.entry_price}`).join(' · ')}</p><p className="mt-2 text-xs text-slate-400">Opened {new Date(position.opened_at).toLocaleString('en-IN')} · Expiry {position.expiry}</p></div><div className="flex items-end gap-3 sm:flex-col"><p className={`text-2xl font-bold ${(position.unrealized_pnl_inr ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{position.unrealized_pnl_inr === null ? 'Valuing…' : money(position.unrealized_pnl_inr)}</p><Button variant="destructive" onClick={exit} disabled={exiting}>{exiting ? 'Exiting…' : 'Exit now'}</Button></div></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><Mini label="ENTRY POP" value={`${(position.predicted_pop * 100).toFixed(1)}%`} /><Mini label="PROFIT TARGET" value={money(position.max_profit_inr * .5)} /><Mini label="MAX LOSS GUARD" value={`-${money(position.planned_max_loss_inr)}`} /></div></div> : <Empty title="No open position" text="The engine will enter the highest-ranked qualified paper trade automatically during market hours." />}</div>
          <div id="opportunities" className="scroll-mt-24 overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm"><Title title="Qualified suggestions" subtitle="Paper threshold 75%; liquidity, historical-regime and ₹350 loss controls remain mandatory" badge={items.length} />{items.length === 0 ? <Empty title="No qualified trade" text={reason} /> : <div className="divide-y divide-sky-50">{items.map(trade => <article key={trade.id} className="p-5"><div className="flex flex-col gap-4 lg:flex-row"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-500 font-bold text-white">{trade.rank}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{trade.strategy}</h3><Badge variant="outline">Expiry {trade.expiry}</Badge></div><p className="mt-1 text-sm text-slate-600">{trade.legs.map(l => `${l.transaction_type} ${l.strike} ${l.option_type}`).join(' · ')}</p><div className="mt-3 space-y-1.5">{trade.rationale.map((r, i) => <p key={i} className="flex gap-2 text-xs text-slate-500"><Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />{r}</p>)}</div></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[360px]"><Mini label="POP" value={`${(trade.probability_of_profit * 100).toFixed(1)}%`} /><Mini label="MAX PROFIT" value={money(trade.max_profit_inr)} /><Mini label="MAX LOSS" value={money(trade.max_loss_inr)} danger /><Mini label="SCORE" value={`${trade.score}/100`} /></div></div></article>)}</div>}</div>
        </div><aside className="space-y-5"><div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">Risk guard</h2><Badge className="bg-emerald-50 text-emerald-700"><ShieldCheck /> ACTIVE</Badge></div><Risk label="Per-trade cap" value="₹350" detail="Including estimated charges" used={position ? position.planned_max_loss_inr / 3.5 : 0} /><Risk label="Daily loss cap" value="₹600" detail={`${money(riskLeft)} remaining`} used={100-riskLeft/6} /><Risk label="Open positions" value={position ? '1 / 1' : '0 / 1'} detail="One position at a time" used={position ? 100 : 0} /><div className="mt-4 rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-sky-900">Real trading remains disabled. Its future entry threshold stays fixed at 95% and requires a separate activation review.</div></div><div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-bold">Learning engine</h2><Badge className="bg-sky-50 text-sky-700"><Sparkles /> {learning?.mode === 'ACTIVE' ? 'ACTIVE' : 'LEARNING'}</Badge></div><p className="mt-3 text-2xl font-bold">{learning?.completed_trades ?? 0} <span className="text-sm font-medium text-slate-400">completed trades</span></p><p className="mt-2 text-xs leading-relaxed text-slate-500">Outcome adjustments start only after {learning?.minimum_samples_per_group ?? 30} comparable trades. Hard risk controls never learn themselves away.</p><div className="mt-4 border-t border-sky-100 pt-4"><p className="text-xs font-semibold">Historical regime filter</p><p className="mt-1 text-xs text-slate-500">{training ? `${training.training_days} training · ${training.validation_days} validation days` : 'Loading…'}</p><p className="mt-1 text-xs font-semibold text-emerald-600">{training?.activated ? 'Validated and active' : 'Not active'}</p></div></div><div className="rounded-2xl bg-gradient-to-br from-sky-600 to-blue-600 p-5 text-white shadow-lg"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-sky-100">AUTOMATION</p><Clock3 className="size-4" /></div><p className="mt-3 text-xl font-bold">Server-controlled</p><p className="mt-2 text-xs leading-relaxed text-sky-100">Scans every minute during market hours. Profit target, maximum-loss guard and 3:15 PM exit are automatic.</p></div><button onClick={exit} disabled={!position || exiting} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white py-3 text-sm font-semibold text-rose-600 disabled:opacity-40"><OctagonAlert className="size-4" /> Emergency exit position</button></aside></section>
        <p className="mt-6 text-center text-xs text-slate-400">Last synchronized {updated ? new Date(updated).toLocaleTimeString('en-IN') : '—'} · Paper results do not guarantee future performance.</p>
      </div>
    </section>
  </main>;
}

function money(v: number) { return `${v < 0 ? '-' : ''}₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`; }
function Metric({ icon, label, value, meta, positive, progress }: { icon: React.ReactNode; label: string; value: string; meta: string; positive?: boolean; progress?: number }) { return <div className="h-full rounded-2xl border border-sky-100 bg-white p-5 shadow-sm transition hover:border-sky-200 hover:shadow-md"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-400">{label}</span><span className="grid size-8 place-items-center rounded-lg bg-sky-50 text-sky-600 [&>svg]:size-4">{icon}</span></div><p className="mt-3 text-xl font-bold text-slate-900">{value}</p><p className={`mt-1 text-xs ${positive ? 'font-semibold text-emerald-600' : 'text-slate-400'}`}>{meta}</p>{progress !== undefined && <Progress value={progress} className="mt-3 [&_[data-slot=progress-indicator]]:bg-sky-500 [&_[data-slot=progress-track]]:bg-sky-100" />}</div>; }
function Mini({ label, value, danger }: { label: string; value: string; danger?: boolean }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-semibold tracking-wide text-slate-400">{label}</p><p className={`mt-1 text-sm font-bold ${danger ? 'text-rose-600' : 'text-slate-800'}`}>{value}</p></div>; }
function Title({ title, subtitle, badge }: { title: string; subtitle: string; badge?: number }) { return <div className="border-b border-sky-100 px-5 py-4"><div className="flex items-center gap-2"><h2 className="font-bold text-slate-900">{title}</h2>{badge !== undefined && <Badge className="bg-sky-100 text-sky-700">{badge}</Badge>}</div><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="p-9 text-center"><ShieldCheck className="mx-auto size-8 text-sky-500" /><h3 className="mt-3 font-bold">{title}</h3><p className="mx-auto mt-1 max-w-xl text-sm text-slate-500">{text}</p></div>; }
function Risk({ label, value, detail, used }: { label: string; value: string; detail: string; used: number }) { return <div className="mb-4"><div className="flex justify-between text-xs"><span className="font-medium text-slate-600">{label}</span><span className="font-bold">{value}</span></div><Progress value={Math.min(100, Math.max(0, used))} className="mt-2 [&_[data-slot=progress-indicator]]:bg-sky-500 [&_[data-slot=progress-track]]:bg-sky-50" /><p className="mt-1.5 text-[10px] text-slate-400">{detail}</p></div>; }
