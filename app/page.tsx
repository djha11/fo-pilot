'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  BarChart3,
  Bell,
  BookOpenCheck,
  Check,
  Crosshair,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCcw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  WalletCards,
  X,
} from 'lucide-react';
import { LoginGate, useAuth } from './auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';

const API = 'https://michel-specially-hostel-tahoe.trycloudflare.com';
type Leg = {
  transaction_type: string;
  strike: number;
  option_type: string;
  quantity: number;
  entry_price: number;
};
type Opportunity = {
  id: string;
  rank: number;
  strategy: string;
  expiry: string;
  probability_of_profit: number;
  max_profit_inr: number;
  max_loss_inr: number;
  profit_target_inr: number;
  target_reward_risk: number;
  expected_value_inr?: number;
  expected_value_status?: string;
  score: number;
  legs: Leg[];
  rationale: string[];
  qualified_for_paper_entry?: boolean;
  manual_entry_eligible?: boolean;
  rejection_reasons?: string[];
};
type Position = {
  id: number;
  strategy: string;
  expiry: string;
  predicted_pop: number;
  planned_max_loss_inr: number;
  max_profit_inr: number;
  unrealized_pnl_inr: number | null;
  realized_pnl_inr?: number | null;
  status?: string;
  exit_reason?: string | null;
  opened_at: string;
  closed_at?: string | null;
  legs: Leg[];
};
type Point = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};
type Research = {
  generated_candidates: number;
  qualified_candidates: number;
  research_only_candidates: number;
  ev_status: string;
  rejection_reason_counts?: Record<string, number>;
};
type PaperConfig = {
  automatic_order_placement: boolean;
  paper_minimum_probability_of_profit: number;
  expiry_day_minimum_probability_of_profit: number;
  paper_minimum_target_reward_risk: number;
  paper_minimum_expected_value_inr: number;
  paper_max_loss_per_trade_inr: number;
  paper_max_daily_loss_inr: number;
  max_new_trades_per_day: number;
  profit_target_ratio: number;
  timed_exit: string;
};
const defaultConfig: PaperConfig = {
  automatic_order_placement: true,
  paper_minimum_probability_of_profit: 0.75,
  expiry_day_minimum_probability_of_profit: 0.97,
  paper_minimum_target_reward_risk: 0.4,
  paper_minimum_expected_value_inr: 0,
  paper_max_loss_per_trade_inr: 4000,
  paper_max_daily_loss_inr: 8000,
  max_new_trades_per_day: 3,
  profit_target_ratio: 0.5,
  timed_exit: '15:15',
};
type View =
  | 'dashboard'
  | 'opportunities'
  | 'analysis'
  | 'trades'
  | 'risk'
  | 'research'
  | 'settings';
const nav: [string, React.ElementType, View][] = [
  ['Dashboard', LayoutDashboard, 'dashboard'],
  ['Opportunities', Sparkles, 'opportunities'],
  ['Market Analysis', BarChart3, 'analysis'],
  ['Paper Trades', BookOpenCheck, 'trades'],
  ['Risk & Capital', WalletCards, 'risk'],
  ['Research', FlaskConical, 'research'],
  ['Settings', Settings, 'settings'],
];

export default function Home() {
  const auth = useAuth();
  const [view, setView] = useState<View>('dashboard'),
    [menu, setMenu] = useState(false),
    [items, setItems] = useState<Opportunity[]>([]),
    [position, setPosition] = useState<Position | null>(null),
    [positions, setPositions] = useState<Position[]>([]);
  const [dailyPnl, setDailyPnl] = useState(0),
    [totalPnl, setTotalPnl] = useState(0),
    [newTradesToday, setNewTradesToday] = useState(0),
    [nifty, setNifty] = useState<number | null>(null),
    [previousClose, setPreviousClose] = useState<number | null>(null),
    [chart, setChart] = useState<Point[]>([]);
  const [chartType, setChartType] = useState<'line' | 'candles'>('candles'),
    [chartInterval, setChartInterval] = useState(5),
    [chartDays, setChartDays] = useState(5),
    [marketStatus, setMarketStatus] = useState('CHECKING'),
    [marketOpen, setMarketOpen] = useState(false),
    [scanned, setScanned] = useState(0),
    [decision, setDecision] = useState('LOADING'),
    [reason, setReason] = useState('Connecting…'),
    [updated, setUpdated] = useState<string | null>(null),
    [research, setResearch] = useState<Research | null>(null);
  const [autoPlace, setAutoPlace] = useState(true),
    [config, setConfig] = useState<PaperConfig>(defaultConfig),
    [selected, setSelected] = useState<Opportunity | null>(null),
    [busy, setBusy] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  const request = useCallback(
    async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`);
      const r = await fetch(`${API}${path}`, { ...init, headers }),
        d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || `Request failed (${r.status})`);
      return d;
    },
    [auth.token],
  );
  const refresh = useCallback(async () => {
    const a = await Promise.allSettled([
      request('/v1/market/nifty'),
      request('/v1/opportunities'),
      request(
        `/v1/market/nifty/chart?interval=${chartInterval}&days=${chartDays}`,
      ),
      request('/v1/paper/portfolio'),
      request('/v1/settings/automation'),
    ]);
    const [m, o, c, p, s] = a;
    if (m.status === 'fulfilled') {
      setNifty(m.value.last_price);
      setPreviousClose(m.value.previous_close);
      setMarketStatus(m.value.market_status ?? 'UNKNOWN');
      setMarketOpen(Boolean(m.value.market_is_open));
    }
    if (o.status === 'fulfilled') {
      setItems(o.value.items ?? []);
      setScanned(o.value.contracts_scanned ?? 0);
      setDecision(o.value.decision ?? 'NO_TRADE');
      setReason(o.value.reason ?? '');
      setUpdated(o.value.as_of ?? null);
      setResearch(o.value.research ?? null);
    }
    if (c.status === 'fulfilled') setChart(c.value.points ?? []);
    if (p.status === 'fulfilled') {
      setPosition(p.value.open_position ?? null);
      setPositions(p.value.positions ?? []);
      setDailyPnl(p.value.daily_realized_pnl_inr ?? 0);
      setTotalPnl(p.value.total_realized_pnl_inr ?? 0);
      setNewTradesToday(p.value.new_trades_today ?? 0);
    }
    if (s.status === 'fulfilled') {
      const next = { ...defaultConfig, ...s.value };
      setConfig(next);
      setAutoPlace(Boolean(next.automatic_order_placement));
    }
    if (m.status === 'rejected' && o.status === 'rejected') {
      setDecision('OFFLINE');
      setMarketStatus('UNAVAILABLE');
      setMarketOpen(false);
    }
  }, [chartDays, chartInterval, request]);
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, marketOpen ? 5000 : 15000);
    return () => window.clearInterval(id);
  }, [refresh, marketOpen]);
  const saveAuto = async (v: boolean) => {
    setAutoPlace(v);
    setNotice('Saving…');
    try {
      await request('/v1/settings/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automatic_order_placement: v }),
      });
      setNotice(
        v ? 'Automatic paper orders enabled' : 'Manual approval mode enabled',
      );
    } catch (e) {
      setAutoPlace(!v);
      setNotice(e instanceof Error ? e.message : 'Could not save');
    }
  };
  const saveConfig = async (next: PaperConfig) => {
    setBusy('settings');
    setNotice('Saving paper-trading configuration…');
    try {
      const saved = await request('/v1/settings/paper', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const merged = { ...defaultConfig, ...saved };
      setConfig(merged);
      setAutoPlace(Boolean(merged.automatic_order_placement));
      setNotice('Paper-trading configuration saved and active');
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : 'Could not save configuration',
      );
      throw e;
    } finally {
      setBusy(null);
    }
  };
  const order = async (t: Opportunity) => {
    setBusy(t.id);
    setNotice('Placing paper order…');
    try {
      await request(`/v1/paper/orders/${encodeURIComponent(t.id)}`, {
        method: 'POST',
      });
      setNotice('Paper order placed and monitoring started');
      setSelected(null);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Order failed');
    } finally {
      setBusy(null);
    }
  };
  const exit = async () => {
    if (!position) return;
    setBusy('exit');
    try {
      await request(`/v1/positions/${position.id}/exit`, { method: 'POST' });
      setNotice('Position exited');
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Exit failed');
    } finally {
      setBusy(null);
    }
  };
  const change = nifty !== null && previousClose ? nifty - previousClose : null,
    pct =
      change !== null && previousClose ? (change / previousClose) * 100 : null,
    closed = positions.filter((p) => p.status === 'CLOSED'),
    wins = closed.filter((p) => (p.realized_pnl_inr ?? 0) > 0),
    reserved = position?.planned_max_loss_inr ?? 0,
    equity = 50000 + totalPnl + (position?.unrealized_pnl_inr ?? 0),
    riskLeft = Math.max(
      0,
      config.paper_max_daily_loss_inr + Math.min(0, dailyPnl),
    );
  const today = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date());
  const p = {
    items,
    position,
    positions,
    closed,
    wins,
    nifty,
    change,
    pct,
    chart,
    chartType,
    setChartType,
    chartInterval,
    setChartInterval,
    chartDays,
    setChartDays,
    marketOpen,
    scanned,
    decision,
    reason,
    research,
    totalPnl,
    dailyPnl,
    newTradesToday,
    reserved,
    equity,
    riskLeft,
    autoPlace,
    config,
    setSelected,
    order,
    busy,
    exit,
    refresh,
  };
  if (auth.loading || !auth.email) return <LoginGate />;
  return (
    <main className="min-h-screen bg-[#f3f7fb] text-slate-900">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[224px] flex-col bg-[#071b2d] px-3 py-4 text-slate-300 transition-transform lg:translate-x-0 ${menu ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="mb-7 flex items-center gap-3 px-2">
          <div className="grid size-9 place-items-center rounded-lg bg-sky-500 text-white">
            <TrendingUp className="size-5" />
          </div>
          <b className="text-sm leading-tight text-white">
            F&O Command
            <br />
            Centre
          </b>
          <button onClick={() => setMenu(false)} className="ml-auto lg:hidden">
            <X />
          </button>
        </div>
        <nav className="space-y-1">
          {nav.map(([label, Icon, id]) => (
            <button
              key={id}
              onClick={() => {
                setView(id);
                setMenu(false);
              }}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm ${view === id ? 'bg-[#087df1] text-white' : 'hover:bg-white/10 hover:text-white'}`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-2">
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
            System running
          </div>
          <p className="mt-2 text-xl font-semibold text-white">
            {updated
              ? new Date(updated).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '--:--'}
          </p>
          <p className="text-xs text-slate-400">
            {marketOpen ? 'Market open' : 'Market closed'}
          </p>
        </div>
      </aside>
      {menu && (
        <button
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
          onClick={() => setMenu(false)}
        />
      )}
      <section className="min-h-screen lg:pl-[224px]">
        <header className="sticky top-0 z-20 flex h-16 items-center border-b bg-white/95 px-4 sm:px-6">
          <button onClick={() => setMenu(true)} className="mr-3 lg:hidden">
            <Menu />
          </button>
          <p className="text-sm text-slate-600">{today}</p>
          <Badge
            className={`ml-4 ${marketOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
          >
            {marketOpen ? 'Market Open' : marketStatus.replaceAll('_', ' ')}
          </Badge>
          <div className="ml-auto flex items-center gap-4">
            <Bell className="size-5 text-slate-500" />
            <div className="grid size-9 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">
              DK
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
          {notice && (
            <div className="mb-4 flex justify-between rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              {notice}
              <button onClick={() => setNotice('')}>
                <X className="size-4" />
              </button>
            </div>
          )}
          {view === 'dashboard' && <Dashboard {...p} />}{' '}
          {view === 'opportunities' && <Opportunities {...p} />}{' '}
          {view === 'analysis' && <Analysis {...p} />}{' '}
          {view === 'trades' && <Trades {...p} />}{' '}
          {view === 'risk' && <RiskCapital {...p} />}{' '}
          {view === 'research' && <ResearchView {...p} />}{' '}
          {view === 'settings' && (
            <SettingsView autoPlace={autoPlace} saveAuto={saveAuto} />
          )}
        </div>
      </section>
      <TradeDialog
        trade={selected}
        onClose={() => setSelected(null)}
        onOrder={order}
        busy={busy}
      />
    </main>
  );
}

function Dashboard(p: any) {
  const qualified = p.items.filter(
      (x: Opportunity) => x.qualified_for_paper_entry,
    ).length,
    manual = p.items.filter(
      (x: Opportunity) =>
        !x.qualified_for_paper_entry && x.manual_entry_eligible,
    ).length;
  return (
    <>
      <Top
        title="Dashboard"
        sub="Live market overview and paper-trading decisions"
        badge={p.autoPlace ? 'Auto orders on' : 'Manual orders'}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="NIFTY 50"
          value={
            p.nifty?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) ??
            'Connecting…'
          }
          delta={
            p.change === null
              ? 'Upstox live feed'
              : `${p.change >= 0 ? '+' : ''}${p.change.toFixed(2)} (${p.pct?.toFixed(2)}%)`
          }
          good={p.change >= 0}
        />
        <Stat
          label="SCANNER"
          value={
            p.decision === 'TRADE_CANDIDATES'
              ? 'Trade ready'
              : p.decision === 'NO_TRADE'
                ? 'No trade'
                : 'Scanning…'
          }
          delta={`${p.scanned} contracts scanned`}
        />
        <Stat
          label="CURRENT EQUITY"
          value={money(p.equity)}
          delta={`${signed(p.totalPnl)} realized`}
          good={p.totalPnl >= 0}
        />
        <Stat
          label="MARKET REGIME"
          value={p.marketOpen ? 'LIVE' : 'CLOSED'}
          delta="Historical loss filter active"
          good
        />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="AUTO QUALIFIED"
          value={String(qualified)}
          delta="All configured gates passed"
          good={qualified > 0}
        />
        <Stat
          label="MANUAL REVIEW"
          value={String(manual)}
          delta="Visible, never auto-entered"
        />
        <Stat
          label="BLOCKED"
          value={String(Math.max(0, p.items.length - qualified - manual))}
          delta="Invalid price/liquidity or risk"
        />
      </div>
      <section className="mt-5 rounded-xl border bg-white">
        <Head
          title="Top Trade Opportunities"
          sub="Qualified setups ranked by the risk engine"
        />
        {p.items.length ? (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
            {p.items.slice(0, 5).map((t: Opportunity) => (
              <TradeCard
                key={t.id}
                trade={t}
                onView={p.setSelected}
                onOrder={p.order}
                busy={p.busy}
              />
            ))}
          </div>
        ) : (
          <Empty text={p.reason} />
        )}
      </section>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_340px]">
        <section className="overflow-hidden rounded-xl border bg-white">
          <Head
            title="NIFTY 50"
            sub="Live candles continue forming on the right"
          />
          <TradingChart
            points={p.chart}
            chartType="candles"
            marketOpen={p.marketOpen}
          />
        </section>
        <div className="space-y-4">
          <Panel title="Open paper position">
            {p.position ? (
              <>
                <b>{p.position.strategy}</b>
                <p className="mt-2 text-sm text-slate-500">
                  {legs(p.position.legs)}
                </p>
                <p
                  className={`mt-3 text-2xl font-bold ${(p.position.unrealized_pnl_inr ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}
                >
                  {money(p.position.unrealized_pnl_inr ?? 0)}
                </p>
                <Button
                  variant="destructive"
                  className="mt-3 w-full"
                  onClick={p.exit}
                >
                  Exit position
                </Button>
              </>
            ) : (
              <Empty text="No open position" />
            )}
          </Panel>
          <Panel title="Safety status">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <ShieldCheck />
              All configured limits active
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Paper ≥
              {Math.round(p.config.paper_minimum_probability_of_profit * 100)}%
              POP · Real trading locked at ≥95%
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Opportunities(p: any) {
  const [q, setQ] = useState(''),
    [strategy, setStrategy] = useState('All'),
    [expiry, setExpiry] = useState('All'),
    [minPop, setMinPop] = useState(0),
    [maxLoss, setMaxLoss] = useState(10000);
  const strategies = [
      'All',
      ...Array.from(new Set(p.items.map((t: Opportunity) => t.strategy))),
    ],
    expiries = [
      'All',
      ...Array.from(new Set(p.items.map((t: Opportunity) => t.expiry))),
    ];
  const shown = p.items.filter(
    (t: Opportunity) =>
      `${t.strategy} ${legs(t.legs)}`.toLowerCase().includes(q.toLowerCase()) &&
      (strategy === 'All' || t.strategy === strategy) &&
      (expiry === 'All' || t.expiry === expiry) &&
      t.probability_of_profit * 100 >= minPop &&
      t.max_loss_inr <= maxLoss,
  );
  const reset = () => {
    setQ('');
    setStrategy('All');
    setExpiry('All');
    setMinPop(0);
    setMaxLoss(10000);
  };
  return (
    <>
      <Top
        title="Trade Opportunities"
        sub="All ranked research setups are visible; only qualified POP setups are automatic"
      />
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3">
        <Filter
          label="Strategy"
          value={strategy}
          onChange={setStrategy}
          options={strategies}
        />
        <Filter
          label="Expiry"
          value={expiry}
          onChange={setExpiry}
          options={expiries}
        />
        <Filter
          label="Minimum POP"
          value={String(minPop)}
          onChange={(v) => setMinPop(Number(v))}
          options={['0', '50', '60', '70', '75', '80', '85', '90', '95']}
          suffix="%"
        />
        <Filter
          label="Maximum loss"
          value={String(maxLoss)}
          onChange={(v) => setMaxLoss(Number(v))}
          options={['350', '1000', '2000', '4000', '10000']}
          prefix="₹"
        />
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="rounded-md border py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <Button variant="outline" onClick={reset}>
          Reset
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1160px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {[
                '#',
                'Strategy',
                'Legs',
                'Expiry',
                'POP',
                'Target',
                'Proxy EV',
                'Max Profit',
                'Max Loss',
                'Target R:R',
                'Status',
                'Action',
              ].map((x) => (
                <th key={x} className="px-3 py-3">
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((t: Opportunity) => (
              <tr key={t.id} className="hover:bg-sky-50/40">
                <td className="px-3 py-3">{t.rank}</td>
                <td className="px-3 font-semibold">{t.strategy}</td>
                <td className="px-3 text-slate-500">{legs(t.legs)}</td>
                <td className="px-3">{t.expiry}</td>
                <td
                  className={`px-3 font-bold ${t.qualified_for_paper_entry ? 'text-emerald-600' : 'text-amber-600'}`}
                >
                  {percent(t.probability_of_profit)}
                </td>
                <td className="px-3 text-emerald-600">
                  {signed(t.profit_target_inr)}
                </td>
                <td className="px-3 font-semibold">
                  {signed(t.expected_value_inr ?? 0)}
                </td>
                <td className="px-3">{money(t.max_profit_inr)}</td>
                <td className="px-3 text-rose-600">{money(t.max_loss_inr)}</td>
                <td className="px-3">{t.target_reward_risk.toFixed(2)}</td>
                <td className="px-3">
                  <Badge
                    className={
                      t.qualified_for_paper_entry
                        ? 'bg-emerald-100 text-emerald-700'
                        : t.manual_entry_eligible
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-rose-100 text-rose-700'
                    }
                  >
                    {t.qualified_for_paper_entry
                      ? 'AUTO'
                      : t.manual_entry_eligible
                        ? 'MANUAL'
                        : 'BLOCKED'}
                  </Badge>
                </td>
                <td className="px-3">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => p.setSelected(t)}
                    >
                      View
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => p.order(t)}
                      disabled={p.busy === t.id || !t.manual_entry_eligible}
                    >
                      {t.qualified_for_paper_entry ? 'Order' : 'Manual order'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && (
          <Empty
            text={
              p.items.length
                ? 'No opportunity matches these filters.'
                : p.reason
            }
          />
        )}
      </div>
    </>
  );
}

function Analysis(p: any) {
  const m = marketMetrics(p.chart);
  return (
    <>
      <Top
        title="Market Analysis"
        sub="NIFTY price action and calculated indicators from the Upstox feed"
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Stat label="TREND" value={m.trend} />
        <Stat
          label="RSI (14)"
          value={m.rsi === null ? '—' : m.rsi.toFixed(1)}
          delta={
            m.rsi === null
              ? 'Needs 15 candles'
              : m.rsi > 70
                ? 'Overbought zone'
                : m.rsi < 30
                  ? 'Oversold zone'
                  : 'Neutral zone'
          }
        />
        <Stat
          label="ATR (14)"
          value={m.atr === null ? '—' : m.atr.toFixed(1)}
          delta="Average candle range"
        />
        <Stat
          label="20-PERIOD AVG"
          value={m.sma20 === null ? '—' : m.sma20.toFixed(1)}
        />
        <Stat
          label="SUPPORT"
          value={m.support === null ? '—' : m.support.toFixed(1)}
          delta="Recent 20-bar low"
        />
        <Stat
          label="RESISTANCE"
          value={m.resistance === null ? '—' : m.resistance.toFixed(1)}
          delta="Recent 20-bar high"
        />
      </div>
      <section className="overflow-hidden rounded-xl border bg-white">
        <div className="flex flex-wrap gap-2 border-b p-4">
          <Control
            label="Chart"
            values={['candles', 'line']}
            value={p.chartType}
            onChange={p.setChartType}
          />
          <Control
            label="Interval"
            values={[1, 2, 5, 15, 30]}
            value={p.chartInterval}
            onChange={(v: any) => p.setChartInterval(Number(v))}
            suffix="m"
          />
          <Control
            label="History"
            values={[1, 5, 10, 30]}
            value={p.chartDays}
            onChange={(v: any) => p.setChartDays(Number(v))}
            suffix="d"
          />
          <Button variant="outline" onClick={p.refresh}>
            <RefreshCcw />
            Refresh
          </Button>
        </div>
        <TradingChart
          points={p.chart}
          chartType={p.chartType}
          marketOpen={p.marketOpen}
        />
      </section>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Decision context">
          <Line
            label="Last close"
            value={m.last === null ? '—' : m.last.toFixed(2)}
          />
          <Line
            label="Distance from 20-period average"
            value={
              m.last !== null && m.sma20 !== null
                ? `${((m.last / m.sma20 - 1) * 100).toFixed(2)}%`
                : '—'
            }
          />
          <Line label="Candles analysed" value={String(p.chart.length)} />
          <Line
            label="Feed status"
            value={p.marketOpen ? 'Live market' : 'Latest completed session'}
          />
        </Panel>
        <Panel title="Interpretation guardrail">
          <p className="text-sm text-slate-600">
            Indicators describe price behaviour; they do not predict profit.
            Automatic entry still requires POP, positive proxy EV, target
            reward/risk, liquidity, loss and regime checks.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Trades(p: any) {
  const [tab, setTab] = useState<'all' | 'open' | 'closed' | 'performance'>(
      'all',
    ),
    [period, setPeriod] = useState<
      'day' | 'week' | 'month' | 'year' | 'custom'
    >('month'),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const rows =
    tab === 'open'
      ? p.positions.filter((x: Position) => x.status === 'OPEN')
      : tab === 'closed'
        ? p.closed
        : p.positions;
  const now = new Date(),
    start = new Date(now);
  if (period === 'day') start.setHours(0, 0, 0, 0);
  if (period === 'week') {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  }
  if (period === 'month') {
    start.setMonth(now.getMonth() - 1);
    start.setHours(0, 0, 0, 0);
  }
  if (period === 'year') {
    start.setFullYear(now.getFullYear() - 1);
    start.setHours(0, 0, 0, 0);
  }
  const performance = p.closed.filter((x: Position) => {
      const d = new Date(x.closed_at ?? x.opened_at);
      if (period === 'custom') {
        if (from && d < new Date(`${from}T00:00:00`)) return false;
        if (to && d > new Date(`${to}T23:59:59`)) return false;
        return true;
      }
      return d >= start && d <= now;
    }),
    performancePnl = performance.reduce(
      (s: number, x: Position) => s + (x.realized_pnl_inr ?? 0),
      0,
    ),
    performanceWins = performance.filter(
      (x: Position) => (x.realized_pnl_inr ?? 0) > 0,
    ),
    grossProfit = performanceWins.reduce(
      (s: number, x: Position) => s + (x.realized_pnl_inr ?? 0),
      0,
    ),
    grossLoss = Math.abs(
      performance
        .filter((x: Position) => (x.realized_pnl_inr ?? 0) < 0)
        .reduce((s: number, x: Position) => s + (x.realized_pnl_inr ?? 0), 0),
    ),
    profitFactor = grossLoss ? grossProfit / grossLoss : null;
  return (
    <>
      <Top
        title="Paper Trades"
        sub="Open positions, completed trades and measured performance"
      />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border bg-white p-1">
        {(
          [
            ['all', 'All Trades'],
            [
              'open',
              `Open Positions (${p.positions.filter((x: Position) => x.status === 'OPEN').length})`,
            ],
            ['closed', `Closed Trades (${p.closed.length})`],
            ['performance', 'Performance'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${tab === id ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'performance' ? (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
            <Control
              label="View by"
              values={['day', 'week', 'month', 'year', 'custom']}
              value={period}
              onChange={(v: any) => setPeriod(v)}
            />
            {period === 'custom' && (
              <>
                <label className="text-xs font-semibold text-slate-500">
                  From
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="mt-1 block rounded-md border bg-white px-3 py-2 text-sm text-slate-800"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-500">
                  To
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="mt-1 block rounded-md border bg-white px-3 py-2 text-sm text-slate-800"
                  />
                </label>
              </>
            )}
            <span className="ml-auto text-sm text-slate-500">
              {performance.length} completed trade
              {performance.length === 1 ? '' : 's'} in selected period
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="TOTAL TRADES" value={String(performance.length)} />
            <Stat
              label="WIN RATE"
              value={
                performance.length
                  ? `${((performanceWins.length / performance.length) * 100).toFixed(1)}%`
                  : '—'
              }
              good
            />
            <Stat
              label="TOTAL P&L"
              value={money(performancePnl)}
              good={performancePnl >= 0}
            />
            <Stat
              label="AVERAGE TRADE"
              value={
                performance.length
                  ? money(performancePnl / performance.length)
                  : '—'
              }
            />
            <Stat
              label="PROFIT FACTOR"
              value={profitFactor === null ? '—' : profitFactor.toFixed(2)}
            />
          </div>
          <Panel title="Performance integrity">
            <p className="text-sm text-slate-600">
              Statistics use only completed paper trades within the selected
              period. Open-position P&L and uncalibrated research candidates are
              excluded.
            </p>
          </Panel>
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {[
                  'Date',
                  'Strategy',
                  'Legs',
                  'Entry POP',
                  'Risk',
                  'P&L',
                  'Exit reason',
                  'Status',
                  'Action',
                ].map((x) => (
                  <th className="px-4 py-3" key={x}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((x: Position) => (
                <tr key={x.id}>
                  <td className="px-4 py-3">
                    {new Date(x.opened_at).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 font-semibold">{x.strategy}</td>
                  <td className="px-4 text-slate-500">{legs(x.legs)}</td>
                  <td className="px-4">{percent(x.predicted_pop)}</td>
                  <td className="px-4">{money(x.planned_max_loss_inr)}</td>
                  <td
                    className={`px-4 font-bold ${(x.realized_pnl_inr ?? x.unrealized_pnl_inr ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}
                  >
                    {money(x.realized_pnl_inr ?? x.unrealized_pnl_inr ?? 0)}
                  </td>
                  <td className="px-4">
                    {x.exit_reason?.replaceAll('_', ' ') ?? 'Monitoring'}
                  </td>
                  <td className="px-4">
                    <Badge
                      className={
                        x.status === 'OPEN'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-100 text-slate-600'
                      }
                    >
                      {x.status ?? 'CLOSED'}
                    </Badge>
                  </td>
                  <td className="px-4">
                    {x.status === 'OPEN' && (
                      <Button size="sm" variant="destructive" onClick={p.exit}>
                        Exit now
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty
              text={
                tab === 'open'
                  ? 'No open paper position'
                  : tab === 'closed'
                    ? 'No closed paper trades yet'
                    : 'No paper trades recorded yet'
              }
            />
          )}
        </div>
      )}
    </>
  );
}

function RiskCapital(p: any) {
  const c: PaperConfig = p.config;
  return (
    <>
      <Top
        title="Risk & Capital"
        sub="Paper capital allocation and safety limits"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="PAPER CAPITAL" value="₹50,000" />
        <Stat
          label="CURRENT EQUITY"
          value={money(p.equity)}
          delta={signed(p.totalPnl)}
          good={p.totalPnl >= 0}
        />
        <Stat
          label="DAILY RISK LEFT"
          value={money(p.riskLeft)}
          delta={`of ${money(c.paper_max_daily_loss_inr)} · ${p.newTradesToday}/${c.max_new_trades_per_day} trades`}
        />
        <Stat
          label="OPEN RISK"
          value={money(p.reserved)}
          delta={p.position ? '1 open position' : 'No exposure'}
        />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Risk limits (Paper)">
          <Risk
            label="Max loss per trade"
            value={money(c.paper_max_loss_per_trade_inr)}
            used={(p.reserved / c.paper_max_loss_per_trade_inr) * 100}
          />
          <Risk
            label="Daily loss budget"
            value={money(c.paper_max_daily_loss_inr)}
            used={
              ((c.paper_max_daily_loss_inr - p.riskLeft) /
                c.paper_max_daily_loss_inr) *
              100
            }
          />
          <Risk
            label="Open strategies"
            value={p.position ? '1 / 1' : '0 / 1'}
            used={p.position ? 100 : 0}
          />
          <Risk
            label="New trades per day"
            value={`${p.newTradesToday} / ${c.max_new_trades_per_day}`}
            used={(p.newTradesToday / c.max_new_trades_per_day) * 100}
          />
        </Panel>
        <Panel title="Today’s activity">
          <Line label="Realized P&L" value={money(p.dailyPnl)} />
          <Line
            label="Trades taken"
            value={`${p.newTradesToday} / ${c.max_new_trades_per_day}`}
          />
          <Line
            label="Available paper capital"
            value={money(50000 + p.totalPnl - p.reserved)}
          />
          <div className="mt-5 rounded-xl bg-emerald-50 p-5 text-center text-emerald-700">
            <ShieldCheck className="mx-auto size-8" />
            <b className="mt-2 block">Risk controls active</b>
            <span className="text-xs">Real-money trading remains locked</span>
          </div>
        </Panel>
      </div>
    </>
  );
}

function ResearchView(p: any) {
  return (
    <>
      <Top
        title="Research / Backtesting"
        sub="Continuous evidence collection and model readiness"
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="CANDIDATES"
          value={String(p.research?.generated_candidates ?? 0)}
        />
        <Stat
          label="QUALIFIED"
          value={String(p.research?.qualified_candidates ?? 0)}
          good
        />
        <Stat
          label="RESEARCH ONLY"
          value={String(p.research?.research_only_candidates ?? 0)}
        />
        <Stat
          label="MODEL STATUS"
          value={p.research?.ev_status?.replaceAll('_', ' ') ?? 'Loading'}
        />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <Panel title="Candidate research coverage">
          <div className="flex h-56 items-end gap-2 rounded-xl bg-gradient-to-t from-emerald-50 to-white p-5">
            {[28, 38, 34, 50, 47, 61, 58, 72, 66, 81, 76, 90].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-emerald-400/70"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <p className="mt-3 text-sm text-slate-500">
            Coverage visualization only. No simulated profits are invented.
          </p>
        </Panel>
        <Panel title="Rejection breakdown">
          {Object.entries(p.research?.rejection_reason_counts ?? {}).map(
            ([k, v]) => (
              <Line key={k} label={k.replaceAll('_', ' ')} value={String(v)} />
            ),
          )}
          {!Object.keys(p.research?.rejection_reason_counts ?? {}).length && (
            <Empty text="Waiting for research data" />
          )}
        </Panel>
      </div>
    </>
  );
}

function SettingsView({
  autoPlace,
  saveAuto,
}: {
  autoPlace: boolean;
  saveAuto: (v: boolean) => void;
}) {
  const auth = useAuth();
  const [draft, setDraft] = useState<PaperConfig>({
      ...defaultConfig,
      automatic_order_placement: autoPlace,
    }),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    fetch(`${API}/v1/settings/automation`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then((r) => r.json())
      .then((v) => setDraft({ ...defaultConfig, ...v }))
      .catch(() => setMessage('Showing defaults until the server reconnects.'))
      .finally(() => setLoading(false));
  }, [auth.token]);
  useEffect(
    () => setDraft((v) => ({ ...v, automatic_order_placement: autoPlace })),
    [autoPlace],
  );
  const set = (key: keyof PaperConfig, value: number | string | boolean) =>
    setDraft((v) => ({ ...v, [key]: value }));
  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const r = await fetch(`${API}/v1/settings/paper`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify(draft),
        }),
        d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || 'Could not save settings');
      setDraft({ ...defaultConfig, ...d });
      if (Boolean(d.automatic_order_placement) !== autoPlace)
        saveAuto(Boolean(d.automatic_order_placement));
      setMessage(
        'Saved. The scanner and paper engine will use these values on their next cycle.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Top
        title="Settings"
        sub="Editable paper-trading rules and locked real-money controls"
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Panel title="Trading rules">
          <div className="flex items-center justify-between gap-5 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <div>
              <b>Automatic trade placement</b>
              <p className="mt-1 text-sm text-slate-500">
                On: place the highest-ranked qualified paper trade. Off: use
                Order now.
              </p>
            </div>
            <Switch
              checked={draft.automatic_order_placement}
              onCheckedChange={(v) => set('automatic_order_placement', v)}
            />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <ConfigField
              label="Paper POP threshold (%)"
              value={draft.paper_minimum_probability_of_profit * 100}
              min={50}
              max={99}
              step={1}
              onChange={(v) =>
                set('paper_minimum_probability_of_profit', v / 100)
              }
            />
            <ConfigField
              label="Expiry-day POP threshold (%)"
              value={draft.expiry_day_minimum_probability_of_profit * 100}
              min={50}
              max={99.5}
              step={0.5}
              onChange={(v) =>
                set('expiry_day_minimum_probability_of_profit', v / 100)
              }
            />
            <ConfigField
              label="Minimum target reward/risk"
              value={draft.paper_minimum_target_reward_risk}
              min={0}
              max={5}
              step={0.05}
              onChange={(v) => set('paper_minimum_target_reward_risk', v)}
            />
            <ConfigField
              label="Minimum expected value (₹)"
              value={draft.paper_minimum_expected_value_inr}
              min={0}
              max={100000}
              step={1}
              onChange={(v) => set('paper_minimum_expected_value_inr', v)}
            />
            <ConfigField
              label="Paper max loss / trade (₹)"
              value={draft.paper_max_loss_per_trade_inr}
              min={1}
              max={10000}
              step={50}
              onChange={(v) => set('paper_max_loss_per_trade_inr', v)}
            />
            <ConfigField
              label="Daily paper loss budget (₹)"
              value={draft.paper_max_daily_loss_inr}
              min={1}
              max={25000}
              step={100}
              onChange={(v) => set('paper_max_daily_loss_inr', v)}
            />
            <ConfigField
              label="New trades / day"
              value={draft.max_new_trades_per_day}
              min={1}
              max={20}
              step={1}
              onChange={(v) => set('max_new_trades_per_day', v)}
            />
            <ConfigField
              label="Profit target (% of max profit)"
              value={draft.profit_target_ratio * 100}
              min={10}
              max={100}
              step={5}
              onChange={(v) => set('profit_target_ratio', v / 100)}
            />
            <label className="rounded-xl border p-4 text-sm text-slate-500">
              Timed exit (IST)
              <input
                type="time"
                value={draft.timed_exit}
                min="09:15"
                max="15:29"
                onChange={(e) => set('timed_exit', e.target.value)}
                className="mt-2 block w-full rounded-md border bg-white px-3 py-2 font-semibold text-slate-900"
              />
            </label>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={loading || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDraft({
                  ...defaultConfig,
                  automatic_order_placement: autoPlace,
                });
                setMessage(
                  'Defaults loaded locally. Select Save changes to apply them.',
                );
              }}
            >
              Load defaults
            </Button>
            {message && <p className="text-sm text-slate-600">{message}</p>}
          </div>
        </Panel>
        <Panel title="Real trading">
          <Badge className="bg-slate-200 text-slate-600">LOCKED</Badge>
          <p className="mt-3 text-sm text-slate-600">
            95% POP · ₹350 maximum all-in loss · separate activation review
            required.
          </p>
          <p className="mt-3 text-xs text-slate-500">
            These editable controls apply only to paper trading. Real-money
            guardrails cannot be changed here.
          </p>
        </Panel>
      </div>
    </>
  );
}

function ConfigField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="rounded-xl border p-4 text-sm text-slate-500">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 block w-full rounded-md border bg-white px-3 py-2 font-semibold text-slate-900"
      />
    </label>
  );
}

function TradeDialog({
  trade,
  onClose,
  onOrder,
  busy,
}: {
  trade: Opportunity | null;
  onClose: () => void;
  onOrder: (t: Opportunity) => void;
  busy: string | null;
}) {
  const eligible = Boolean(trade?.manual_entry_eligible);
  return (
    <Dialog open={!!trade} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{trade?.strategy}</DialogTitle>
          <DialogDescription>
            Review the complete paper-trade setup.
          </DialogDescription>
        </DialogHeader>
        {trade && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Mini label="POP" value={percent(trade.probability_of_profit)} />
              <Mini label="TARGET" value={money(trade.profit_target_inr)} />
              <Mini label="MAX PROFIT" value={money(trade.max_profit_inr)} />
              <Mini label="MAX LOSS" value={money(trade.max_loss_inr)} bad />
              <Mini label="R:R" value={trade.target_reward_risk.toFixed(2)} />
            </div>
            <div className="mt-4 rounded-xl bg-slate-50 p-4">
              <b>Strategy legs</b>
              <p className="mt-2 text-sm text-slate-600">{legs(trade.legs)}</p>
            </div>
            <div className="mt-4 space-y-2">
              {trade.rationale.map((r, i) => (
                <p key={i} className="flex gap-2 text-sm text-slate-600">
                  <Check className="size-4 text-emerald-500" />
                  {r}
                </p>
              ))}
            </div>
            {!eligible && (
              <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                Order blocked:{' '}
                {(trade.rejection_reasons ?? ['Safety checks failed'])
                  .map((x) => x.replaceAll('_', ' '))
                  .join(', ')}
                .
              </p>
            )}
            <Button
              className="mt-5 w-full"
              onClick={() => onOrder(trade)}
              disabled={busy === trade.id || !eligible}
            >
              {busy === trade.id
                ? 'Placing…'
                : eligible
                  ? 'Order now · Paper trade'
                  : 'Order blocked by safety checks'}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
function TradeCard({
  trade,
  onView,
  onOrder,
  busy,
}: {
  trade: Opportunity;
  onView: (t: Opportunity) => void;
  onOrder: (t: Opportunity) => void;
  busy: string | null;
}) {
  const eligible = Boolean(trade.manual_entry_eligible);
  return (
    <article className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-blue-500 text-xs font-bold text-white">
          {trade.rank}
        </span>
        <b className="truncate text-sm">{trade.strategy}</b>
      </div>
      <p className="mt-2 truncate text-xs text-slate-500">{legs(trade.legs)}</p>
      <div className="mt-3">
        <Line label="POP" value={percent(trade.probability_of_profit)} good />
        <Line label="Exp. P&L" value={signed(trade.profit_target_inr)} good />
        <Line label="Max Loss" value={money(trade.max_loss_inr)} />
        <Line label="R:R" value={trade.target_reward_risk.toFixed(2)} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => onView(trade)}>
          View
        </Button>
        <Button
          size="sm"
          onClick={() => onOrder(trade)}
          disabled={busy === trade.id || !eligible}
        >
          {eligible ? 'Order now' : 'Blocked'}
        </Button>
      </div>
    </article>
  );
}
function Top({
  title,
  sub,
  badge,
}: {
  title: string;
  sub: string;
  badge?: string;
}) {
  const auth = useAuth();
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{sub}</p>
      </div>
      <div className="flex items-center gap-2">
        {badge && <Badge className="bg-blue-100 text-blue-700">{badge}</Badge>}
        <button
          onClick={auth.signOut}
          title={`Sign out ${auth.email}`}
          className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <LogOut className="size-4" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </div>
  );
}
function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="border-b px-4 py-3">
      <b>{title}</b>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  );
}
function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <h2 className="mb-4 font-bold">{title}</h2>
      {children}
    </section>
  );
}
function Stat({
  label,
  value,
  delta,
  good,
}: {
  label: string;
  value: string;
  delta?: string;
  good?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      {delta && (
        <p
          className={`mt-1 text-xs ${good ? 'font-semibold text-emerald-600' : 'text-slate-500'}`}
        >
          {delta}
        </p>
      )}
    </div>
  );
}
function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <b>{value}</b>
    </div>
  );
}
function Mini({
  label,
  value,
  bad,
}: {
  label: string;
  value: string;
  bad?: boolean;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-[11px] font-semibold text-slate-400">{label}</p>
      <b className={bad ? 'text-rose-600' : ''}>{value}</b>
    </div>
  );
}
function Line({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <b className={good ? 'text-emerald-600' : ''}>{value}</b>
    </div>
  );
}
function Risk({
  label,
  value,
  used,
}: {
  label: string;
  value: string;
  used: number;
}) {
  return (
    <div className="mb-5">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <Progress value={Math.max(0, Math.min(100, used))} className="mt-2" />
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="p-8 text-center text-sm text-slate-500">{text}</div>;
}
function Control({
  label,
  values,
  value,
  onChange,
  suffix = '',
}: {
  label: string;
  values: (string | number)[];
  value: string | number;
  onChange: (v: any) => void;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
      <span className="px-2 text-xs font-semibold text-slate-500">{label}</span>
      {values.map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${value === v ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
        >
          {v}
          {typeof v === 'number' ? suffix : ''}
        </button>
      ))}
    </div>
  );
}
function Filter({
  label,
  value,
  onChange,
  options,
  suffix = '',
  prefix = '',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  suffix?: string;
  prefix?: string;
}) {
  return (
    <label className="text-xs font-semibold text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block min-w-28 rounded-md border bg-white px-3 py-2 text-sm font-normal text-slate-800"
      >
        {options.map((x) => (
          <option key={x} value={x}>
            {prefix}
            {x}
            {suffix}
          </option>
        ))}
      </select>
    </label>
  );
}
const money = (v: number) =>
    `${v < 0 ? '-' : ''}₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
  signed = (v: number) =>
    `${v >= 0 ? '+' : '-'}₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
  percent = (v: number) => `${(v * 100).toFixed(0)}%`,
  legs = (v: Leg[]) =>
    v
      .map((x) => `${x.transaction_type} ${x.strike} ${x.option_type}`)
      .join(' / ');

function marketMetrics(points: Point[]) {
  const closes = points.map((x) => Number(x.close)).filter(Number.isFinite),
    recent = points.slice(-20),
    last = closes.at(-1) ?? null,
    sma = (n: number) =>
      closes.length >= n
        ? closes.slice(-n).reduce((a, b) => a + b, 0) / n
        : null,
    sma5 = sma(5),
    sma20 = sma(20);
  let rsi: number | null = null,
    atr: number | null = null;
  if (closes.length >= 15) {
    let gains = 0,
      losses = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d;
      else losses -= d;
    }
    rsi = losses === 0 ? 100 : 100 - 100 / (1 + gains / 14 / (losses / 14));
    const ranges = points.slice(-14).map((x, i, a) => {
      const prev = i
        ? a[i - 1].close
        : points[Math.max(0, points.length - 15)].close;
      return Math.max(
        x.high - x.low,
        Math.abs(x.high - prev),
        Math.abs(x.low - prev),
      );
    });
    atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  }
  const trend =
    sma5 === null || sma20 === null
      ? 'WAITING'
      : sma5 > sma20 * 1.001
        ? 'UPTREND'
        : sma5 < sma20 * 0.999
          ? 'DOWNTREND'
          : 'RANGE';
  return {
    last,
    sma20,
    rsi,
    atr,
    trend,
    support: recent.length ? Math.min(...recent.map((x) => x.low)) : null,
    resistance: recent.length ? Math.max(...recent.map((x) => x.high)) : null,
  };
}

function TradingChart({
  points,
  chartType,
  marketOpen,
}: {
  points: Point[];
  chartType: 'line' | 'candles';
  marketOpen: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    chartRef = useRef<IChartApi | null>(null),
    seriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(
      null,
    ),
    first = useRef(true);
  useEffect(() => {
    if (!host.current) return;
    const api = createChart(host.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: '#fff' },
          textColor: '#64748b',
          attributionLogo: true,
        },
        localization: {
          timeFormatter: (time: any) =>
            new Date((Number(time) - 19800) * 1000).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }),
        },
        grid: {
          vertLines: { color: '#e2e8f0', style: LineStyle.Dotted },
          horzLines: { color: '#e2e8f0', style: LineStyle.Dotted },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#cbd5e1' },
        timeScale: {
          borderColor: '#cbd5e1',
          rightOffset: 8,
          barSpacing: 8,
          minBarSpacing: 1,
          timeVisible: true,
          shiftVisibleRangeOnNewBar: true,
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: true,
        },
        kineticScroll: { mouse: true, touch: true },
      }),
      series =
        chartType === 'candles'
          ? api.addSeries(CandlestickSeries, {
              upColor: '#10b981',
              downColor: '#ef4444',
              borderVisible: false,
              wickUpColor: '#10b981',
              wickDownColor: '#ef4444',
            })
          : api.addSeries(AreaSeries, {
              lineColor: '#0ea5e9',
              topColor: 'rgba(14,165,233,.25)',
              bottomColor: 'rgba(14,165,233,.02)',
              lineWidth: 2,
            });
    chartRef.current = api;
    seriesRef.current = series as any;
    first.current = true;
    return () => api.remove();
  }, [chartType]);
  useEffect(() => {
    if (!seriesRef.current || !points.length) return;
    const data = points.map((p) => {
      const time = (Math.floor(new Date(p.time).getTime() / 1000) +
        19800) as UTCTimestamp;
      return chartType === 'candles'
        ? { time, open: p.open, high: p.high, low: p.low, close: p.close }
        : { time, value: p.close };
    });
    (seriesRef.current as any).setData(data);
    if (first.current) {
      chartRef.current?.timeScale().fitContent();
      chartRef.current?.timeScale().scrollToRealTime();
      first.current = false;
    } else if ((chartRef.current?.timeScale().scrollPosition() ?? 99) < 3)
      chartRef.current?.timeScale().scrollToRealTime();
  }, [points, chartType]);
  return (
    <div className="relative">
      <div className="flex items-center border-b px-4 py-2 text-xs">
        <b>NIFTY 50 · NSE · IST</b>
        <button
          className="ml-auto flex items-center gap-1 text-blue-600"
          onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
        >
          <Crosshair className="size-4" />
          Go live
        </button>
        <button
          className="ml-2"
          onClick={() => chartRef.current?.timeScale().fitContent()}
        >
          <RotateCcw className="size-4" />
        </button>
      </div>
      <div ref={host} className="h-[430px] touch-pan-y" />
      {marketOpen && (
        <Badge className="absolute right-16 top-14 bg-emerald-100 text-emerald-700">
          LIVE
        </Badge>
      )}
    </div>
  );
}
