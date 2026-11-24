import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, TrendingDown, TrendingUp, X } from 'lucide-react';
import { computeCurrentBudgetSummary } from '../sim/economy';
import type { BudgetSnapshot, CityState } from '../sim/types';

interface BudgetOverlayProps {
  cityState: CityState;
  onClose: () => void;
}

type ChartMode = 'cashflow' | 'tax_mix';

function formatMop(value: number): string {
  const rounded = Math.round(value);
  return `${rounded < 0 ? '-' : ''}$${Math.abs(rounded).toLocaleString()}`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    payload?: BudgetSnapshot;
  }>;
  label?: string;
}

const TrendTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const snap = payload[0]?.payload;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs shadow-xl">
      <div className="mb-1.5 flex items-center justify-between gap-4 border-b border-slate-800 pb-1">
        <span className="font-semibold text-white">{label}</span>
        {snap && (
          <span className="font-mono-num text-amber-300">
            庫房 {formatMop(snap.treasury)}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span
                className="inline-block h-2 w-2 rounded-xs"
                style={{ backgroundColor: entry.color || '#38bdf8' }}
              />
              {entry.name}
            </span>
            <span className="font-mono-num font-semibold text-white">
              {formatMop(Number(entry.value || 0))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

interface SpendingTooltipProps {
  active?: boolean;
  payload?: Array<{
    value?: number;
    payload?: { name: string; amount: number; detail: string; color: string };
  }>;
}

const SpendingTooltip: React.FC<SpendingTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold text-white">{item.name}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{item.detail}</div>
      <div className="mt-1 font-mono-num font-semibold text-rose-300">
        {formatMop(item.amount)}
      </div>
    </div>
  );
};

export const BudgetOverlay: React.FC<BudgetOverlayProps> = ({ cityState, onClose }) => {
  const [chartMode, setChartMode] = useState<ChartMode>('cashflow');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const summary = useMemo(() => computeCurrentBudgetSummary(cityState), [cityState]);
  const history = useMemo(() => cityState.budgetHistory ?? [], [cityState.budgetHistory]);

  const spendingItems = useMemo(() => {
    const u = summary.unitCounts;
    const raw = [
      {
        name: '二線街道維護',
        amount: summary.streetUpkeep,
        detail: `${u.streetSegments} 條街巷 ($18/段)`,
        color: '#38bdf8',
      },
      {
        name: '主幹大道維護',
        amount: summary.avenueUpkeep,
        detail: `${u.avenueSegments} 條大道 ($35/段)`,
        color: '#818cf8',
      },
      {
        name: '巴士專線營運',
        amount: summary.busUpkeep,
        detail: `${u.busSegments} 條專線 ($52/段)`,
        color: '#34d399',
      },
      {
        name: '跨海大橋養護',
        amount: summary.bridgeUpkeep,
        detail: `${u.bridgeSegments} 條跨海橋 (1.5x養護)`,
        color: '#f59e0b',
      },
      {
        name: '城市地標營運',
        amount: summary.landmarkUpkeep,
        detail: `${u.landmarks} 座地標 ($140/座)`,
        color: '#c084fc',
      },
      {
        name: '本期資本基建',
        amount: summary.pendingCapitalSpending,
        detail: '道路、分區、圓形地、分區解鎖',
        color: '#fb7185',
      },
    ];
    return raw;
  }, [summary]);

  const totalCurrentPeriodOutflow =
    summary.recurringUpkeep + summary.pendingCapitalSpending;
  const totalCurrentPeriodInflow =
    summary.recurringRevenue +
    summary.pendingStampAndSalesTax +
    summary.pendingEventAndGrants;
  const currentNetForecast = totalCurrentPeriodInflow - totalCurrentPeriodOutflow;

  const avgPeriodTaxRevenue = useMemo(() => {
    if (history.length === 0) return summary.recurringRevenue;
    const sum = history.reduce((acc, h) => acc + h.totalRevenue, 0);
    return Math.round(sum / history.length);
  }, [history, summary.recurringRevenue]);

  const taxMixRows = useMemo(() => {
    const u = summary.unitCounts;
    const baseTotal = Math.max(1, totalCurrentPeriodInflow);
    return [
      {
        label: '住宅區物業稅',
        meta: `${u.residentialBuildings} 棟現役`,
        amount: summary.residentialTax,
        share: Math.round((summary.residentialTax / baseTotal) * 100),
        color: '#34d399',
      },
      {
        label: '商業區利得稅',
        meta: `${u.commercialBuildings} 棟現役`,
        amount: summary.commercialTax,
        share: Math.round((summary.commercialTax / baseTotal) * 100),
        color: '#38bdf8',
      },
      {
        label: '文旅娛樂專稅',
        meta: `${u.tourismBuildings} 棟現役`,
        amount: summary.tourismTax,
        share: Math.round((summary.tourismTax / baseTotal) * 100),
        color: '#f59e0b',
      },
      {
        label: '科創工業稅收',
        meta: `${u.industrialBuildings} 棟現役`,
        amount: summary.industrialTax,
        share: Math.round((summary.industrialTax / baseTotal) * 100),
        color: '#a78bfa',
      },
      {
        label: '市民人口稅基',
        meta: `${cityState.stats.population.toLocaleString()} 人`,
        amount: summary.citizenHeadTax,
        share: Math.round((summary.citizenHeadTax / baseTotal) * 100),
        color: '#94a3b8',
      },
      {
        label: '印花及市民消費稅',
        meta: '本週期累計待結算',
        amount: summary.pendingStampAndSalesTax,
        share: Math.round((summary.pendingStampAndSalesTax / baseTotal) * 100),
        color: '#fb7185',
      },
    ];
  }, [cityState.stats.population, summary, totalCurrentPeriodInflow]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center pointer-events-auto bg-slate-950/75 p-3 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="市政財政預算總覽"
      data-testid="budget-overlay"
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-xl border border-white/15 bg-slate-950/96 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Bar Contract: Breadcrumb/title left, view toggle + close right */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-400/30 bg-sky-500/15 text-sky-300">
              <BarChart3 className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-400">
                澳門市政府 / 市長專屬財政帳簿 · 第 {cityState.stats.day} 日
              </div>
              <h2 className="font-display text-base font-bold text-white">
                市政財政預算總覽 · Budget View
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5">
              <button
                type="button"
                data-budget-tab="cashflow"
                onClick={() => setChartMode('cashflow')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  chartMode === 'cashflow'
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                收支趨勢
              </button>
              <button
                type="button"
                data-budget-tab="tax_mix"
                onClick={() => setChartMode('tax_mix')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  chartMode === 'tax_mix'
                    ? 'bg-amber-400 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                稅源結構
              </button>
            </div>

            <button
              type="button"
              aria-label="關閉財政預算視窗"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 4-KPI Single-Elevation Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-800 border-b border-slate-800 bg-slate-900/40">
          <div className="px-5 py-3.5">
            <div className="text-[11px] font-medium text-slate-400">當前市政庫房餘額</div>
            <div className="mt-1 text-xl font-bold font-mono-num text-amber-300">
              {formatMop(cityState.stats.treasury)}
            </div>
            <div className="mt-0.5 text-[11px] font-mono-num text-slate-400">
              週期均稅收 {formatMop(avgPeriodTaxRevenue)} / 期
            </div>
          </div>

          <div className="px-5 py-3.5">
            <div className="text-[11px] font-medium text-slate-400">本期常規稅收 + 印花稅</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold font-mono-num text-emerald-400">
                +{formatMop(totalCurrentPeriodInflow)}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] font-mono-num text-slate-400">
              常規 {formatMop(summary.recurringRevenue)} · 印花/補助{' '}
              {formatMop(summary.pendingStampAndSalesTax + summary.pendingEventAndGrants)}
            </div>
          </div>

          <div className="px-5 py-3.5">
            <div className="text-[11px] font-medium text-slate-400">本期市政維護 + 基建支出</div>
            <div className="mt-1 text-xl font-bold font-mono-num text-rose-400">
              -{formatMop(totalCurrentPeriodOutflow)}
            </div>
            <div className="mt-0.5 text-[11px] font-mono-num text-slate-400">
              常規養護 {formatMop(summary.recurringUpkeep)} · 資本{' '}
              {formatMop(summary.pendingCapitalSpending)}
            </div>
          </div>

          <div className="px-5 py-3.5">
            <div className="text-[11px] font-medium text-slate-400">本期預估淨結餘</div>
            <div
              className={`mt-1 flex items-center gap-1.5 text-xl font-bold font-mono-num ${
                currentNetForecast >= 0 ? 'text-sky-300' : 'text-rose-400'
              }`}
            >
              {currentNetForecast >= 0 ? (
                <TrendingUp className="h-4 w-4 shrink-0" />
              ) : (
                <TrendingDown className="h-4 w-4 shrink-0" />
              )}
              <span>
                {currentNetForecast >= 0 ? '+' : ''}
                {formatMop(currentNetForecast)}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] font-mono-num text-slate-400">
              常規淨營運 {summary.projectedNetRecurring >= 0 ? '+' : ''}
              {formatMop(summary.projectedNetRecurring)} / 期
            </div>
          </div>
        </div>

        {/* Main Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
          {/* Left Column (7 cols): Tax Revenue & Fiscal Trend Chart + Tax Breakdown Table */}
          <div className="lg:col-span-7 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-white">
                  {chartMode === 'cashflow'
                    ? '稅收與市政支出歷史走勢 (近 24 週期)'
                    : '各分區稅收與印花稅貢獻構成'}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {chartMode === 'cashflow'
                    ? '即時同步地產稅、跨海大橋養護費、商人印花稅及市政基建開支'
                    : '追蹤住宅、商業、文旅娛樂、科創工業及人口與印花稅動態'}
                </p>
              </div>
              <span className="font-mono-num text-[11px] text-slate-400">
                樣本 {history.length} 期
              </span>
            </div>

            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === 'cashflow' ? (
                  <ComposedChart data={history} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: '#334155' }}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `$${v}`}
                      width={58}
                    />
                    <Tooltip content={<TrendTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: '11px', color: '#cbd5e1', paddingTop: '6px' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="totalRevenue"
                      name="市政總稅收"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#revGrad)"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="totalSpending"
                      name="市政總支出"
                      stroke="#f43f5e"
                      strokeWidth={2}
                      fill="url(#spendGrad)"
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="netBalance"
                      name="淨結餘"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: '#38bdf8' }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                ) : (
                  <BarChart data={history} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: '#334155' }}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `$${v}`}
                      width={58}
                    />
                    <Tooltip content={<TrendTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: '11px', color: '#cbd5e1', paddingTop: '6px' }}
                    />
                    <Bar dataKey="residentialTax" name="住宅稅" stackId="tax" fill="#34d399" isAnimationActive={false} />
                    <Bar dataKey="commercialTax" name="商業稅" stackId="tax" fill="#38bdf8" isAnimationActive={false} />
                    <Bar dataKey="tourismTax" name="文旅稅" stackId="tax" fill="#f59e0b" isAnimationActive={false} />
                    <Bar dataKey="industrialTax" name="科創稅" stackId="tax" fill="#a78bfa" isAnimationActive={false} />
                    <Bar dataKey="citizenHeadTax" name="人口稅" stackId="tax" fill="#94a3b8" isAnimationActive={false} />
                    <Bar dataKey="stampAndSalesTax" name="印花消費稅" stackId="tax" fill="#fb7185" isAnimationActive={false} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Compact Tax Source Ledger Table */}
            <div className="border-t border-slate-800 pt-3">
              <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-slate-400">
                <span>當前週期稅源明細</span>
                <span>佔總收入比 · 金額 (MOP)</span>
              </div>
              <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg overflow-hidden">
                {taxMixRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex h-9 items-center justify-between px-3 text-xs hover:bg-slate-900/70"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-xs"
                        style={{ backgroundColor: row.color }}
                      />
                      <span className="font-medium text-slate-200 truncate">{row.label}</span>
                      <span className="text-[11px] text-slate-500 font-mono-num shrink-0">
                        ({row.meta})
                      </span>
                    </div>
                    <div className="flex items-center gap-4 font-mono-num shrink-0">
                      <span className="w-10 text-right text-[11px] text-slate-400">
                        {row.share}%
                      </span>
                      <span className="w-20 text-right font-semibold text-emerald-300">
                        +{formatMop(row.amount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column (5 cols): Municipal Spending Statistics */}
          <div className="lg:col-span-5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-white">市政分項支出統計</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  道路維護、跨海大橋營運、地標開銷與即時工程撥款
                </p>
              </div>
              <span className="font-mono-num text-[11px] text-rose-300">
                -{formatMop(totalCurrentPeriodOutflow)}
              </span>
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={spendingItems}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 6, bottom: 4 }}
                >
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#334155' }}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={96}
                    stroke="#64748b"
                    tick={{ fill: '#cbd5e1', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<SpendingTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }} />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
                    {spendingItems.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Compact Spending Breakdown Ledger */}
            <div className="border-t border-slate-800 pt-3">
              <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-slate-400">
                <span>市政支出科目一覽</span>
                <span>佔比 · 金額 (MOP)</span>
              </div>
              <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg overflow-hidden">
                {spendingItems.map((item) => {
                  const pct =
                    totalCurrentPeriodOutflow > 0
                      ? Math.round((item.amount / totalCurrentPeriodOutflow) * 100)
                      : 0;
                  return (
                    <div
                      key={item.name}
                      className="flex h-10 items-center justify-between px-3 text-xs hover:bg-slate-900/70"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-xs"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="font-medium text-slate-200 truncate">{item.name}</span>
                        </div>
                        <div className="pl-4.5 text-[10px] text-slate-500 font-mono-num truncate">
                          {item.detail}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 font-mono-num shrink-0">
                        <span className="w-9 text-right text-[11px] text-slate-400">{pct}%</span>
                        <span className="w-20 text-right font-semibold text-rose-300">
                          -{formatMop(item.amount)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
