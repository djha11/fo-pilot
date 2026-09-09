'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AreaSeries, CandlestickSeries, ColorType, CrosshairMode, createChart, LineStyle, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { Activity, Bell, ChartNoAxesCombined, Check, Clock3, Cloud, Crosshair, Expand, LayoutDashboard, Menu, OctagonAlert, Radio, RefreshCcw, RotateCcw, ShieldCheck, Sparkles, TrendingUp, WalletCards, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

const API = 'https://michel-specially-hostel-tahoe.trycloudflare.com';
type Leg = { transaction_type: string; strike: number; option_type: string; quantity: number; entry_price: number };
type Opportunity = { id: string; rank: number; strategy: string; expiry: string; probability_of_profit: number; max_profit_inr: number; max_loss_inr: number; profit_target_inr: number; target_reward_risk: number; maximum_reward_risk: number; expected_value_status: string; score: number; legs: Leg[]; rationale: string[] };
type Position = { id: number; strategy: string; expiry: string; predicted_pop: number; planned_max_loss_inr: number; max_profit_inr: number; unrealized_pnl_inr: number | null; opened_at: string; legs: Leg[]; rationale: string[] };
type Learning = { mode: string; completed_trades: number; profitable_trades: number; minimum_samples_per_group: number };
type Training = { activated: boolean; training_days: number; validation_days: number };
type Point = { time: string; open: number; high: number; low: number; close: number };
type Research = { generated_candidates: number; qualified_candidates: number; research_only_candidates: number; ev_status: string; strategy_version: string };

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
  const [chartType, setChartType] = useState<'line' | 'candles'>('candles');
  const [chartInterval, setChartInterval] = useState(5);
  const [chartDays, setChartDays] = useState(30);
  const [marketStatus, setMarketStatus] = useState('CHECKING');
  const [marketOpen, setMarketOpen] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [decision, setDecision] = useState('LOADING');
  const [reason, setReason] = useState('Connecting to the risk engine…');
  const [updated, setUpdated] = useState<string | null>(null);
  const [learning, setLearning] = useState<Learning | null>(null);
  const [training, setTraining] = useState<Training | null>(null);
  const [research, setResearch] = useState<Research | null>(null);
  const [exiting, setExiting] = useState(false);

  const refresh = useCallback(async () => {
    const get = async (path: string) => {
      const response = await fetch(`${API}${path}`);
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      return response.json();
    };
    const results = await Promise.allSettled([
      get('/v1/market/nifty'), get('/v1/opportunities'),
      get(`/v1/market/nifty/chart?interval=${chartInterval}&days=${chartDays}`), get('/v1/paper/portfolio'),
    ]);
    const [marketResult, scanResult, chartResult, portfolioResult] = results;
    if (marketResult.status === 'fulfilled') {
      const market = marketResult.value;
      setNifty(market.last_price); setPreviousClose(market.previous_close);
      setMarketStatus(market.market_status ?? 'UNKNOWN'); setMarketOpen(Boolean(market.market_is_open));
    }
    if (scanResult.status === 'fulfilled') {
      const scan = scanResult.value;
      setItems(scan.items ?? []); setScanned(scan.contracts_scanned ?? 0);
      setDecision(scan.decision ?? 'NO_TRADE'); setReason(scan.reason ?? ''); setUpdated(scan.as_of ?? null);
      setLearning(scan.learning ?? null); setTraining(scan.historical_training ?? null);
      setResearch(scan.research ?? null);
    }
    if (chartResult.status === 'fulfilled') {
      const chartData = chartResult.value;
      setChart(chartData.points ?? []);
    }
    if (portfolioResult.status === 'fulfilled') {
      const portfolio = portfolioResult.value;
      setPosition(portfolio.open_position ?? null);
      setDailyPnl(portfolio.daily_realized_pnl_inr ?? 0);
    }
    if (marketResult.status === 'rejected' && scanResult.status === 'rejected') {
      setDecision('OFFLINE'); setMarketStatus('UNAVAILABLE'); setMarketOpen(false);
      setReason('The market gateway is temporarily unavailable. Automatic entry is paused safely.');
    }
  }, [chartDays, chartInterval]);

  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 15000); return () => window.clearInterval(timer); }, [refresh]);
  const change = nifty !== null && previousClose ? nifty - previousClose : null;
  const changePct = change !== null && previousClose ? change / previousClose * 100 : null;
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

        <section id="live-chart" className="mb-6 scroll-mt-24 overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm"><div className="border-b border-sky-100 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">NIFTY 50 trading chart</h2><p className="mt-1 text-xs text-slate-500">Scroll to move through history · pinch or wheel to zoom · live candles form on the right</p></div><div className="flex items-center gap-2"><Badge className={marketOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}>{marketOpen ? 'LIVE' : 'CLOSED'}</Badge><Button variant="outline" onClick={refresh}><RefreshCcw /> Refresh</Button></div></div><div className="mt-4 flex flex-wrap gap-2"><Control label="Chart" values={['candles','line']} value={chartType} onChange={v => setChartType(v as 'line'|'candles')} /><Control label="Interval" values={[1,2,5,15,30]} value={chartInterval} onChange={v => setChartInterval(Number(v))} suffix="m" /><Control label="History" values={[1,5,10,30]} value={chartDays} onChange={v => setChartDays(Number(v))} suffix="d" /></div></div><TradingChart points={chart} chartType={chartType} marketOpen={marketOpen} /></section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_350px]"><div className="space-y-6">
          <div id="positions" className="scroll-mt-24 rounded-2xl border border-sky-100 bg-white shadow-sm"><Title title="Paper position" subtitle="Monitored continuously by the cloud engine" />{position ? <div className="p-5"><div className="flex flex-col justify-between gap-5 sm:flex-row"><div><div className="flex items-center gap-2"><Badge className="bg-emerald-50 text-emerald-700">OPEN</Badge><h3 className="font-bold text-slate-900">{position.strategy}</h3></div><p className="mt-2 text-sm text-slate-600">{position.legs.map(l => `${l.transaction_type} ${l.strike} ${l.option_type} @ ₹${l.entry_price}`).join(' · ')}</p><p className="mt-2 text-xs text-slate-400">Opened {new Date(position.opened_at).toLocaleString('en-IN')} · Expiry {position.expiry}</p></div><div className="flex items-end gap-3 sm:flex-col"><p className={`text-2xl font-bold ${(position.unrealized_pnl_inr ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{position.unrealized_pnl_inr === null ? 'Valuing…' : money(position.unrealized_pnl_inr)}</p><Button variant="destructive" onClick={exit} disabled={exiting}>{exiting ? 'Exiting…' : 'Exit now'}</Button></div></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><Mini label="ENTRY POP" value={`${(position.predicted_pop * 100).toFixed(1)}%`} /><Mini label="PROFIT TARGET" value={money(position.max_profit_inr * .5)} /><Mini label="MAX LOSS GUARD" value={`-${money(position.planned_max_loss_inr)}`} /></div></div> : <Empty title="No open position" text="The engine will enter the highest-ranked qualified paper trade automatically during market hours." />}</div>
          <div id="opportunities" className="scroll-mt-24 overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm"><Title title="Qualified suggestions" subtitle="Only POP-qualified trades that pass loss, reward/risk, liquidity and regime checks can enter automatically" badge={items.length} />{items.length === 0 ? <Empty title="No qualified trade" text={reason} /> : <div className="divide-y divide-sky-50">{items.map(trade => <article key={trade.id} className="p-5"><div className="flex flex-col gap-4 lg:flex-row"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-500 font-bold text-white">{trade.rank}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{trade.strategy}</h3><Badge variant="outline">Expiry {trade.expiry}</Badge><Badge className="bg-amber-50 text-amber-700">EV uncalibrated</Badge></div><p className="mt-1 text-sm text-slate-600">{trade.legs.map(l => `${l.transaction_type} ${l.strike} ${l.option_type}`).join(' · ')}</p><div className="mt-3 space-y-1.5">{trade.rationale.map((r, i) => <p key={i} className="flex gap-2 text-xs text-slate-500"><Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />{r}</p>)}</div></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:w-[470px]"><Mini label="VENDOR POP" value={`${(trade.probability_of_profit * 100).toFixed(1)}%`} /><Mini label="TARGET" value={money(trade.profit_target_inr)} /><Mini label="MAX LOSS" value={money(trade.max_loss_inr)} danger /><Mini label="TARGET R:R" value={trade.target_reward_risk.toFixed(2)} /><Mini label="SCORE" value={`${trade.score}/100`} /></div></div></article>)}</div>}</div>
        </div><aside className="space-y-5"><div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold">Risk guard</h2><Badge className="bg-emerald-50 text-emerald-700"><ShieldCheck /> ACTIVE</Badge></div><Risk label="Per-trade cap" value="₹350" detail="Including estimated charges" used={position ? position.planned_max_loss_inr / 3.5 : 0} /><Risk label="Daily loss cap" value="₹600" detail={`${money(riskLeft)} remaining`} used={100-riskLeft/6} /><Risk label="Open positions" value={position ? '1 / 1' : '0 / 1'} detail="One position at a time · maximum two new trades daily" used={position ? 100 : 0} /><div className="mt-4 rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-sky-900">Real trading remains disabled. Its future entry threshold stays fixed at 95% and requires a separate activation review.</div></div><div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-bold">Research engine</h2><Badge className="bg-sky-50 text-sky-700"><Sparkles /> {learning?.mode === 'ACTIVE' ? 'ACTIVE' : 'LEARNING'}</Badge></div><p className="mt-3 text-2xl font-bold">{research?.generated_candidates ?? 0} <span className="text-sm font-medium text-slate-400">candidates tracked</span></p><div className="mt-3 grid grid-cols-2 gap-2"><Mini label="QUALIFIED" value={`${research?.qualified_candidates ?? 0}`} /><Mini label="RESEARCH ONLY" value={`${research?.research_only_candidates ?? 0}`} /></div><p className="mt-3 text-xs leading-relaxed text-slate-500">Every candidate is classified and stored. Only candidates above the configured POP threshold can enter the selected paper portfolio. EV remains uncalibrated until the outcome model is defensible.</p><div className="mt-4 border-t border-sky-100 pt-4"><p className="text-xs font-semibold">Historical regime filter</p><p className="mt-1 text-xs text-slate-500">{training ? `${training.training_days} training · ${training.validation_days} validation days` : 'Loading…'}</p><p className="mt-1 text-xs font-semibold text-emerald-600">{training?.activated ? 'Validated and active' : 'Not active'}</p></div></div><div className="rounded-2xl bg-gradient-to-br from-sky-600 to-blue-600 p-5 text-white shadow-lg"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-sky-100">AUTOMATION</p><Clock3 className="size-4" /></div><p className="mt-3 text-xl font-bold">Server-controlled</p><p className="mt-2 text-xs leading-relaxed text-sky-100">Scans every minute during market hours. Profit target, maximum-loss guard and 3:15 PM exit are automatic.</p></div><button onClick={exit} disabled={!position || exiting} className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white py-3 text-sm font-semibold text-rose-600 disabled:opacity-40"><OctagonAlert className="size-4" /> Emergency exit position</button></aside></section>
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
function Control({ label, values, value, onChange, suffix = '' }: { label: string; values: readonly (string|number)[]; value: string|number; onChange: (value: string|number) => void; suffix?: string }) { return <div className="flex items-center gap-1 rounded-xl bg-slate-50 p-1"><span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>{values.map(v => <button key={v} onClick={() => onChange(v)} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold capitalize transition ${value === v ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{v}{typeof v === 'number' ? suffix : ''}</button>)}</div>; }
function TradingChart({ points, chartType, marketOpen }: { points: Point[]; chartType: 'line'|'candles'; marketOpen: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(null);
  const firstLoad = useRef(true);
  const [hovered, setHovered] = useState<Point | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const api = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#475569', attributionLogo: true },
      localization: {
        locale: 'en-IN',
        timeFormatter: time => formatIndianChartTime(Number(time), true),
      },
      grid: { vertLines: { color: '#e2e8f0', style: LineStyle.Dotted }, horzLines: { color: '#e2e8f0', style: LineStyle.Dotted } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#cbd5e1', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: '#cbd5e1', rightOffset: 8, barSpacing: 8, minBarSpacing: 1, timeVisible: true, secondsVisible: false, shiftVisibleRangeOnNewBar: true, tickMarkFormatter: time => formatIndianChartTime(Number(time), false) },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      kineticScroll: { mouse: true, touch: true },
    });
    const series = chartType === 'candles'
      ? api.addSeries(CandlestickSeries, { upColor: '#089981', downColor: '#f23645', borderVisible: false, wickUpColor: '#089981', wickDownColor: '#f23645', priceLineVisible: true })
      : api.addSeries(AreaSeries, { lineColor: '#0284c7', topColor: 'rgba(14,165,233,.28)', bottomColor: 'rgba(14,165,233,.02)', lineWidth: 2, priceLineVisible: true });
    api.subscribeCrosshairMove(param => {
      if (!param.time) return setHovered(null);
      const hit = points.find(p => Math.floor(new Date(p.time).getTime() / 1000) === Number(param.time));
      setHovered(hit ?? null);
    });
    chartRef.current = api;
    seriesRef.current = series as typeof seriesRef.current;
    firstLoad.current = true;
    return () => { api.remove(); chartRef.current = null; seriesRef.current = null; };
  }, [chartType]);

  useEffect(() => {
    const api = chartRef.current;
    const series = seriesRef.current;
    if (!api || !series || !points.length) return;
    const data = points.map(p => chartType === 'candles'
      ? { time: Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp, open: p.open, high: p.high, low: p.low, close: p.close }
      : { time: Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp, value: p.close });
    (series as any).setData(data);
    if (firstLoad.current) {
      api.timeScale().fitContent();
      api.timeScale().scrollToRealTime();
      firstLoad.current = false;
    } else if (api.timeScale().scrollPosition() < 3) {
      api.timeScale().scrollToRealTime();
    }
  }, [points, chartType]);

  const goLive = () => chartRef.current?.timeScale().scrollToRealTime();
  const reset = () => { chartRef.current?.timeScale().fitContent(); chartRef.current?.timeScale().scrollToRealTime(); };
  const fullscreen = () => host.current?.parentElement?.requestFullscreen?.();
  const shown = hovered ?? points.at(-1) ?? null;

  return <div className="relative bg-white">
    <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2 text-xs">
      {shown && <><b className="text-slate-800">NIFTY 50</b><span>O <b>{shown.open.toFixed(2)}</b></span><span>H <b className="text-emerald-600">{shown.high.toFixed(2)}</b></span><span>L <b className="text-rose-600">{shown.low.toFixed(2)}</b></span><span>C <b className={shown.close >= shown.open ? 'text-emerald-600' : 'text-rose-600'}>{shown.close.toFixed(2)}</b></span></>}
      <div className="ml-auto flex items-center gap-1"><button onClick={goLive} className="flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-sky-700 hover:bg-sky-50"><Crosshair className="size-3.5" /> Go live</button><button onClick={reset} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Reset chart"><RotateCcw className="size-3.5" /></button><button onClick={fullscreen} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Fullscreen chart"><Expand className="size-3.5" /></button></div>
    </div>
    <div ref={host} className="h-[390px] touch-pan-y sm:h-[520px]" />
    <div className="pointer-events-none absolute bottom-9 left-4 rounded-md bg-white/85 px-2 py-1 text-[10px] font-medium text-slate-400">Scroll: history · Pinch/wheel: zoom · Drag: pan</div>
    {marketOpen && <div className="pointer-events-none absolute right-20 top-14 flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700"><span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> LIVE</div>}
  </div>;
}

function formatIndianChartTime(unixSeconds: number, includeDate: boolean) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    ...(includeDate ? { day: '2-digit', month: 'short' } : {}),
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(unixSeconds * 1000));
}
