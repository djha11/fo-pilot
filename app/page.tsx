'use client';

import { useState } from 'react';
import { Activity, Bell, ChartNoAxesCombined, Check, ChevronDown, CircleGauge, Clock3, Cloud, LayoutDashboard, LogOut, Menu, MoreHorizontal, OctagonAlert, Power, Radio, RefreshCcw, ShieldCheck, Sparkles, TrendingUp, WalletCards, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';

const opportunities = [
  { rank: 1, strategy: 'Bull Call Spread', legs: 'Buy 24,850 CE · Sell 24,900 CE', expiry: '10 Sep', pop: 96.4, maxProfit: 542, maxLoss: 327, score: 94, note: 'Momentum aligned · Liquid strikes' },
  { rank: 2, strategy: 'Bull Put Spread', legs: 'Sell 24,750 PE · Buy 24,700 PE', expiry: '10 Sep', pop: 95.8, maxProfit: 286, maxLoss: 339, score: 91, note: 'Strong support · Positive EV' },
];

const navItems = [
  { label: 'Overview', icon: LayoutDashboard, active: true },
  { label: 'Opportunities', icon: Sparkles },
  { label: 'Positions', icon: ChartNoAxesCombined },
  { label: 'Activity', icon: Activity },
];

export default function Home() {
  const [paperMode, setPaperMode] = useState(true);
  const [approved, setApproved] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-sky-100 bg-white px-4 py-5 transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="grid size-10 place-items-center rounded-xl bg-sky-500 text-white shadow-[0_8px_22px_rgba(14,165,233,.28)]"><ChartNoAxesCombined className="size-5" /></div>
          <div><p className="text-[15px] font-bold tracking-tight">F&O Pilot</p><p className="text-xs text-slate-400">Decision engine</p></div>
          <button className="ml-auto lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="size-5 text-slate-400" /></button>
        </div>
        <nav className="space-y-1" aria-label="Primary navigation">
          {navItems.map(({ label, icon: Icon, active }) => <button key={label} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active ? 'bg-sky-50 text-sky-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}><Icon className="size-[18px]" />{label}</button>)}
        </nav>
        <div className="mt-7 px-3 text-[10px] font-semibold uppercase tracking-[.15em] text-slate-400">System</div>
        <nav className="mt-2 space-y-1">
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50"><ShieldCheck className="size-[18px]" /> Risk controls</button>
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50"><CircleGauge className="size-[18px]" /> Backtests</button>
        </nav>
        <div className="mt-auto rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-sky-700"><Cloud className="size-4" /> Cloud engine online</div>
          <p className="text-[11px] leading-relaxed text-slate-500">Live data is fresh. Last tick received 0.8 seconds ago.</p>
        </div>
        <button className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50"><LogOut className="size-[18px]" /> Sign out</button>
      </aside>
      {mobileOpen && <button aria-label="Close navigation overlay" className="fixed inset-0 z-30 bg-slate-950/20 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />}

      <section className="min-h-screen lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center border-b border-sky-100/80 bg-white/85 px-5 backdrop-blur-xl sm:px-8">
          <button className="mr-3 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="size-5 text-slate-600" /></button>
          <div><h1 className="text-lg font-bold tracking-tight text-slate-900">Good morning, Durgesh</h1><p className="hidden text-xs text-slate-400 sm:block">Monday, 7 September · Indian market</p></div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-sky-100 bg-sky-50/70 px-3 py-1.5 sm:flex"><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span><span className="text-xs font-semibold text-slate-600">Market live</span></div>
            <Button variant="outline" size="icon" className="rounded-full border-sky-100 text-slate-500" aria-label="Notifications"><Bell /></Button>
            <div className="grid size-9 place-items-center rounded-full bg-sky-600 text-xs font-bold text-white">DK</div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
          <section className="mb-6 flex flex-col gap-4 rounded-2xl border border-sky-100 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,.035)] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className={`grid size-10 place-items-center rounded-xl ${paperMode ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700'}`}>{paperMode ? <RefreshCcw className="size-5" /> : <Power className="size-5" />}</div>
              <div><div className="flex items-center gap-2"><p className="text-sm font-bold text-slate-800">{paperMode ? 'Paper trading' : 'Real money'}</p><Badge className={paperMode ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700'}>{paperMode ? 'SAFE MODE' : 'LIVE CAPITAL'}</Badge></div><p className="mt-0.5 text-xs text-slate-400">Every entry still needs your approval</p></div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 sm:justify-start"><span className={`text-xs font-semibold ${paperMode ? 'text-sky-700' : 'text-slate-400'}`}>Paper</span><Switch checked={!paperMode} onCheckedChange={(checked) => { setPaperMode(!checked); setApproved(null); }} aria-label="Toggle real money mode" /><span className={`text-xs font-semibold ${!paperMode ? 'text-rose-600' : 'text-slate-400'}`}>Real money</span></div>
          </section>

          <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={<TrendingUp />} label="NIFTY 50" value="24,842.65" meta="+126.40 · +0.51%" positive />
            <MetricCard icon={<Radio />} label="Market regime" value="Mild bullish" meta="82% confidence" />
            <MetricCard icon={<WalletCards />} label="Available capital" value="₹50,000" meta="No open exposure" />
            <MetricCard icon={<ShieldCheck />} label="Daily risk left" value="₹600" meta="100% remaining" progress />
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px]">
            <div className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-[0_8px_30px_rgba(15,23,42,.035)]">
              <div className="flex flex-col gap-3 border-b border-sky-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div><div className="flex items-center gap-2"><Sparkles className="size-4 text-sky-500" /><h2 className="font-bold text-slate-900">Qualified opportunities</h2><Badge className="bg-sky-100 text-sky-700">2</Badge></div><p className="mt-1 text-xs text-slate-400">Only trades above 95% calibrated probability and within ₹350 total risk</p></div>
                <Button variant="outline" className="border-sky-100 text-slate-600"><RefreshCcw /> Refresh analysis</Button>
              </div>
              <div className="divide-y divide-sky-50">
                {opportunities.map((trade) => <article key={trade.rank} className="p-5 transition hover:bg-sky-50/25">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                    <div className="flex min-w-0 flex-1 gap-4"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-500 text-sm font-bold text-white">{trade.rank}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{trade.strategy}</h3><Badge variant="outline" className="border-sky-100 text-slate-500">NIFTY · {trade.expiry}</Badge></div><p className="mt-1 text-xs font-medium text-slate-500">{trade.legs}</p><p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-600"><Check className="size-3.5" /> {trade.note}</p></div></div>
                    <div className="grid grid-cols-4 gap-4 text-center lg:w-[340px]"><TradeStat label="POP" value={`${trade.pop}%`} accent /><TradeStat label="MAX PROFIT" value={`₹${trade.maxProfit}`} /><TradeStat label="MAX LOSS" value={`₹${trade.maxLoss}`} danger /><TradeStat label="SCORE" value={`${trade.score}/100`} /></div>
                    <Button className={`h-10 min-w-[118px] rounded-xl ${approved === trade.rank ? 'bg-emerald-500 hover:bg-emerald-500' : 'bg-sky-600 hover:bg-sky-700'}`} onClick={() => setApproved(trade.rank)} disabled={approved !== null && approved !== trade.rank}>{approved === trade.rank ? <><Check /> Approved</> : <>Review trade <ChevronDown /></>}</Button>
                  </div>
                </article>)}
              </div>
              <div className="flex items-center gap-2 bg-sky-50/50 px-5 py-3 text-xs text-slate-500"><ShieldCheck className="size-4 text-sky-500" /> 316 candidates checked · 314 rejected by safety filters</div>
            </div>

            <aside className="space-y-5">
              <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.035)]">
                <div className="mb-5 flex items-center justify-between"><h2 className="font-bold text-slate-900">Risk guard</h2><Badge className="bg-emerald-50 text-emerald-700"><ShieldCheck /> ACTIVE</Badge></div>
                <RiskRow label="Per-trade loss cap" value="₹350" detail="Includes all charges" used={93} /><RiskRow label="Daily loss cap" value="₹600" detail="₹600 remaining" used={0} /><RiskRow label="Open positions" value="0 / 1" detail="One at a time" used={0} />
                <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-xs leading-relaxed text-emerald-800">All account-level controls are healthy. No safety blocks detected.</div>
              </div>
              <div className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-600 to-blue-600 p-5 text-white shadow-[0_14px_32px_rgba(2,132,199,.22)]"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-sky-100">NEXT FULL SCAN</p><MoreHorizontal className="size-4 text-sky-200" /></div><div className="mt-3 flex items-end gap-2"><Clock3 className="mb-1 size-5 text-sky-200" /><span className="text-3xl font-bold tracking-tight">01:42</span></div><p className="mt-2 text-xs leading-relaxed text-sky-100">Live risk checks continue between full market scans.</p></div>
              <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white py-3 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"><OctagonAlert className="size-4" /> Emergency exit all</button>
            </aside>
          </section>
        </div>
      </section>
    </main>
  );
}

function MetricCard({ icon, label, value, meta, positive, progress }: { icon: React.ReactNode; label: string; value: string; meta: string; positive?: boolean; progress?: boolean }) {
  return <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,.035)]"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-400">{label}</span><span className="grid size-8 place-items-center rounded-lg bg-sky-50 text-sky-600 [&>svg]:size-4">{icon}</span></div><p className="mt-3 text-xl font-bold tracking-tight text-slate-900">{value}</p><p className={`mt-1 text-xs ${positive ? 'font-semibold text-emerald-600' : 'text-slate-400'}`}>{meta}</p>{progress && <Progress value={100} className="mt-3 [&_[data-slot=progress-indicator]]:bg-sky-500 [&_[data-slot=progress-track]]:bg-sky-100" />}</div>;
}

function TradeStat({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  return <div><p className="text-[9px] font-semibold tracking-wide text-slate-400">{label}</p><p className={`mt-1 text-sm font-bold ${accent ? 'text-sky-600' : danger ? 'text-rose-500' : 'text-slate-800'}`}>{value}</p></div>;
}

function RiskRow({ label, value, detail, used }: { label: string; value: string; detail: string; used: number }) {
  return <div className="mb-4 last:mb-0"><div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-600">{label}</span><span className="text-xs font-bold text-slate-800">{value}</span></div><Progress value={used} className={`mt-2 ${used > 80 ? '[&_[data-slot=progress-indicator]]:bg-amber-400' : '[&_[data-slot=progress-indicator]]:bg-sky-500'} [&_[data-slot=progress-track]]:bg-sky-50`} /><p className="mt-1.5 text-[10px] text-slate-400">{detail}</p></div>;
}
