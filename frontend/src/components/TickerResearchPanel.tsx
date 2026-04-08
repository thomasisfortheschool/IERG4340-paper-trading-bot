'use client';

import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { marketApi, tickerApi } from '@/lib/api';
import { BarChart3, Newspaper, PieChart } from 'lucide-react';

type ResearchResult = {
  symbol: string;
  input_symbol?: string;
  market?: 'us' | 'hk' | 'jp' | 'kr' | string;
  company_name: string;
  summary?: string;
  sector?: string;
  industry?: string;
  price: number;
  previous_close: number;
  change: number;
  change_pct: number;
  market_cap?: number;
  beta?: number;
  trailing_pe?: number;
  forward_pe?: number;
  trailing_eps?: number;
  forward_eps?: number;
  dividend_yield?: number;
  payout_ratio?: number;
  earnings_date?: string | null;
  analyst_recommendation_mean?: number;
  analyst_opinions_count?: number;
  chart?: {
    period?: string;
    interval?: string;
    points?: Array<{
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
  };
  dividends?: Array<{
    date: string;
    amount: number;
  }>;
  news?: Array<{
    title: string;
    publisher?: string;
    link?: string;
    published_at?: string | null;
    type?: string;
  }>;
  dcf?: {
    available: boolean;
    reason?: string;
    fair_value?: number;
    current_price?: number;
    upside_pct?: number;
    assumptions?: {
      growth_rate?: number;
      discount_rate?: number;
      terminal_growth?: number;
    };
  };
  recommendation: {
    action: 'buy' | 'watch' | 'avoid';
    score: number;
    reasons: string[];
  };
};

const CHART_PERIODS = [
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
  { id: '5y', label: '5Y' },
];

export default function TickerResearchPanel() {
  const [query, setQuery] = useState('AAPL');
  const [market, setMarket] = useState<'us' | 'hk' | 'jp' | 'kr'>('us');
  const [chartPeriod, setChartPeriod] = useState<'1m' | '3m' | '6m' | '1y' | '5y'>('1y');
  const [loading, setLoading] = useState(false);
  const [contextLoading, setContextLoading] = useState(true);
  const [error, setError] = useState('');
  const [contextError, setContextError] = useState('');
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [regime, setRegime] = useState<any>(null);
  const [regimePerformance, setRegimePerformance] = useState<any>(null);

  useEffect(() => {
    const loadContext = async () => {
      try {
        const [regimeRes, perfRes] = await Promise.allSettled([
          marketApi.getRegime(),
          marketApi.getPerformanceByRegime('blowup_stocks'),
        ]);

        if (regimeRes.status === 'fulfilled') {
          setRegime(regimeRes.value.data);
        }
        if (perfRes.status === 'fulfilled') {
          setRegimePerformance(perfRes.value.data);
        }
        setContextError('');
      } catch (e: any) {
        setContextError(e?.response?.data?.error || 'Market context unavailable');
      } finally {
        setContextLoading(false);
      }
    };

    void loadContext();
  }, []);

  const researchByRegime = useMemo(() => {
    const byRegime = regimePerformance?.by_regime || {};
    return Object.entries(byRegime).sort((a: any, b: any) => Number(b[1]?.win_rate ?? 0) - Number(a[1]?.win_rate ?? 0));
  }, [regimePerformance]);

  const bestRegimeEntry = researchByRegime[0];
  const bestRegimeData = bestRegimeEntry?.[1] as any;

  const badgeClass = useMemo(() => {
    const action = result?.recommendation?.action;
    if (action === 'buy') return 'bg-emerald-900 text-emerald-200 border border-emerald-700';
    if (action === 'watch') return 'bg-amber-900 text-amber-200 border border-amber-700';
    return 'bg-rose-900 text-rose-200 border border-rose-700';
  }, [result]);

  const confidenceScore = result?.recommendation?.score ?? 0;
  const confidenceBand = confidenceScore >= 80 ? 'High' : confidenceScore >= 60 ? 'Moderate' : 'Low';
  const confidenceClass = confidenceScore >= 80 ? 'text-emerald-300' : confidenceScore >= 60 ? 'text-cyan-300' : 'text-yellow-300';
  const currentRegime = String(regime?.regime || 'unknown').replace(/_/g, ' ');
  const regimeLabel = regime?.vix != null ? `VIX ${Number(regime.vix).toFixed(2)}` : 'VIX N/A';

  const chartData = useMemo(() => {
    return (result?.chart?.points || []).map((point) => ({
      ...point,
      label: new Date(point.date).toLocaleDateString(),
    }));
  }, [result]);

  const lastChartClose = chartData.length ? Number(chartData[chartData.length - 1]?.close) : NaN;
  const chartPreviousClose = chartData.length > 1 ? Number(chartData[chartData.length - 2]?.close) : NaN;
  const priceValue = Number.isFinite(Number(result?.price)) ? Number(result?.price) : lastChartClose;
  const changeValue = Number.isFinite(Number(result?.change))
    ? Number(result?.change)
    : Number.isFinite(priceValue) && Number.isFinite(Number(result?.previous_close))
      ? priceValue - Number(result?.previous_close)
      : Number.isFinite(priceValue) && Number.isFinite(chartPreviousClose)
        ? priceValue - chartPreviousClose
        : NaN;
  const changePctValue = Number.isFinite(Number(result?.change_pct))
    ? Number(result?.change_pct)
    : Number.isFinite(changeValue) && Number.isFinite(Number(result?.previous_close)) && Number(result?.previous_close) !== 0
      ? (changeValue / Number(result?.previous_close)) * 100
      : NaN;
  const hasQuote = Number.isFinite(priceValue) && Number.isFinite(changeValue) && Number.isFinite(changePctValue);
  const recommendationReasons = result?.recommendation?.reasons || [];

  const tickerInsights = useMemo(() => {
    if (!result) return [] as string[];

    const insights: string[] = [];
    const validCloses = chartData.map((point) => Number(point.close)).filter((value) => Number.isFinite(value));
    const selectedWindow = chartPeriod.toUpperCase();

    if (validCloses.length >= 2) {
      const firstClose = validCloses[0];
      const lastClose = validCloses[validCloses.length - 1];
      const windowMovePct = ((lastClose - firstClose) / firstClose) * 100;
      insights.push(
        `In the selected ${selectedWindow} window, ${result.symbol} moved ${windowMovePct >= 0 ? 'up' : 'down'} ${Math.abs(windowMovePct).toFixed(1)}% from $${firstClose.toFixed(2)} to $${lastClose.toFixed(2)}.`
      );

      const peakClose = Math.max(...validCloses);
      const drawdownPct = ((lastClose - peakClose) / peakClose) * 100;
      if (Math.abs(drawdownPct) >= 5) {
        insights.push(`It is currently ${Math.abs(drawdownPct).toFixed(1)}% below the selected-window peak, so momentum has room to recover or weaken further.`);
      }
    }

    if (hasQuote && Number.isFinite(changePctValue)) {
      insights.push(
        `${result.symbol} is ${changePctValue >= 0 ? 'up' : 'down'} ${Math.abs(changePctValue).toFixed(2)}% versus the previous close, which gives a fresh read on short-term pressure.`
      );
    }

    if (result.forward_pe != null || result.trailing_pe != null) {
      const peText = result.forward_pe != null
        ? `forward P/E ${Number(result.forward_pe).toFixed(2)}`
        : `trailing P/E ${Number(result.trailing_pe).toFixed(2)}`;
      insights.push(`Valuation is anchored by ${peText}, so this name is being priced more like a growth or quality compounder than a deep-value trade.`);
    }

    if (result.dcf?.available && result.dcf.upside_pct != null) {
      insights.push(
        `DCF points to ${result.dcf.upside_pct >= 0 ? 'about' : 'roughly'} ${Math.abs(Number(result.dcf.upside_pct)).toFixed(1)}% ${result.dcf.upside_pct >= 0 ? 'upside' : 'downside'} versus the current price.`
      );
    }

    if (result.dividend_yield != null || result.payout_ratio != null) {
      const dividendParts = [];
      if (result.dividend_yield != null) dividendParts.push(`yield ${(Number(result.dividend_yield) * 100).toFixed(2)}%`);
      if (result.payout_ratio != null) dividendParts.push(`payout ${(Number(result.payout_ratio) * 100).toFixed(1)}%`);
      insights.push(`Income profile: ${dividendParts.join(', ')}. That matters if you want cash flow rather than pure price appreciation.`);
    }

    if (result.earnings_date) {
      insights.push(`Next earnings date is ${result.earnings_date}, so the ticker has a concrete catalyst window to watch.`);
    }

    if (result.analyst_recommendation_mean != null && result.analyst_opinions_count != null) {
      insights.push(
        `Analysts are sitting at ${Number(result.analyst_recommendation_mean).toFixed(2)} across ${result.analyst_opinions_count} opinions, which shows whether sentiment is crowded or mixed.`
      );
    }

    if (result.market_cap != null) {
      insights.push(`Market cap is about $${(Number(result.market_cap) / 1e9).toFixed(2)}B, which helps frame whether this is a mega-cap, large-cap, or smaller beta name.`);
    }

    if (result.recommendation?.action && result.recommendation?.score != null) {
      insights.push(`Model output is ${result.recommendation.action.toUpperCase()} with score ${Number(result.recommendation.score).toFixed(0)}/100, so the research engine is not treating this as neutral.`);
    }

    return insights.slice(0, 4);
  }, [chartData, chartPeriod, changePctValue, hasQuote, result]);

  const fundamentals = [
    { label: 'Market Cap', value: result?.market_cap ? `$${(Number(result.market_cap) / 1e9).toFixed(2)}B` : 'N/A' },
    { label: 'Forward P/E', value: result?.forward_pe != null ? result.forward_pe.toFixed(2) : 'N/A' },
    { label: 'Trailing P/E', value: result?.trailing_pe != null ? result.trailing_pe.toFixed(2) : 'N/A' },
    { label: 'Beta', value: result?.beta != null ? result.beta.toFixed(2) : 'N/A' },
    { label: 'Dividend Yield', value: result?.dividend_yield != null ? `${(Number(result.dividend_yield) * 100).toFixed(2)}%` : 'N/A' },
    { label: 'Payout Ratio', value: result?.payout_ratio != null ? `${(Number(result.payout_ratio) * 100).toFixed(1)}%` : 'N/A' },
    { label: 'Trailing EPS', value: result?.trailing_eps != null ? result.trailing_eps.toFixed(2) : 'N/A' },
    { label: 'Forward EPS', value: result?.forward_eps != null ? result.forward_eps.toFixed(2) : 'N/A' },
  ];

  const fetchTicker = async (nextSymbol = query, nextMarket = market, nextChartPeriod = chartPeriod) => {
    const symbol = nextSymbol.trim().toUpperCase();
    if (!symbol) return;

    setLoading(true);
    setError('');
    try {
      const res = await tickerApi.research(symbol, nextMarket, nextChartPeriod);
      setResult(res.data);
    } catch (e: any) {
      const message = e?.response?.data?.error || 'Failed to fetch ticker research';
      setError(message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const onSearch = async () => {
    await fetchTicker();
  };

  const onPeriodChange = async (period: '1m' | '3m' | '6m' | '1y' | '5y') => {
    setChartPeriod(period);
    if (result || query.trim()) {
      await fetchTicker(query, market, period);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Research Desk</h2>
            <p className="text-slate-300 text-sm md:text-base">Ticker cockpit with chart, fundamentals, dividends, news, and trade thesis.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-600/70 px-3 py-1 text-xs text-slate-200">
            <BarChart3 size={14} /> Broker-style research
          </span>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as 'us' | 'hk' | 'jp' | 'kr')}
            className="input-modern lg:w-[160px]"
          >
            <option value="us">US Market</option>
            <option value="hk">Hong Kong</option>
            <option value="jp">Japan</option>
            <option value="kr">Korea</option>
          </select>
          <input
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') {
                onSearch();
              }
            }}
            placeholder="Enter ticker/code, e.g. NVDA or 0700"
            className="input-modern flex-1"
          />
          <button onClick={onSearch} disabled={loading} className="btn-primary disabled:opacity-50 lg:w-[140px]">
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
        {error && <p className="text-rose-300 text-sm mt-3">{error}</p>}
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="card xl:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Price Chart</h3>
              <p className="text-sm text-slate-300">Select a timeframe and compare price with volume.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {CHART_PERIODS.map((period) => (
                <button
                  key={period.id}
                  onClick={() => onPeriodChange(period.id as '1m' | '3m' | '6m' | '1y' | '5y')}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    chartPeriod === period.id
                      ? 'border-teal-300 bg-teal-900/25 text-teal-100'
                      : 'border-slate-600/70 bg-slate-900/35 text-slate-300 hover:border-slate-400'
                  }`}
                >
                  {period.label}
                </button>
              ))}
            </div>
          </div>

          {loading && !result ? (
            <p className="text-sm text-slate-400">Loading ticker data...</p>
          ) : chartData.length > 0 ? (
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#2b5567" />
                  <XAxis dataKey="label" stroke="#9ab5bf" tick={{ fontSize: 12 }} minTickGap={18} />
                  <YAxis yAxisId="price" stroke="#9ab5bf" domain={['auto', 'auto']} tickFormatter={(value) => `$${Number(value).toFixed(0)}`} />
                  <YAxis yAxisId="volume" orientation="right" stroke="#9ab5bf" tickFormatter={(value) => `${Number(value) / 1e6}M`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f2230', border: '1px solid #2b5567', borderRadius: 10 }}
                    labelStyle={{ color: '#cde4ea' }}
                    formatter={(value: any, name: string) => {
                      if (name === 'close') return [`$${Number(value).toFixed(2)}`, 'Close'];
                      if (name === 'volume') return [Number(value).toLocaleString(), 'Volume'];
                      return [value, name];
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="volume" dataKey="volume" fill="#1f7a8c" opacity={0.25} name="Volume" />
                  <Area yAxisId="price" type="monotone" dataKey="close" stroke="#22e07a" fill="#22e07a" fillOpacity={0.08} name="Close" />
                  <Line yAxisId="price" type="monotone" dataKey="close" stroke="#8cf5c0" strokeWidth={2.4} dot={false} name="Close line" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No chart data available for this ticker.</p>
          )}

          {result && (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {fundamentals.map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-600/60 bg-slate-900/30 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-300">{item.label}</p>
                  <p className="text-lg font-semibold text-slate-100 mt-1">{item.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card xl:col-span-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Decision Context</h3>
              <p className="text-sm text-slate-300">Confidence, regime fit, and why the idea matters.</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass} border-current/30 bg-slate-900/30`}>
              {confidenceBand} Confidence
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-600/60 bg-slate-900/30 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-300">Score</p>
              <p className={`text-2xl font-bold ${confidenceClass}`}>{confidenceScore}</p>
            </div>
            <div className="rounded-xl border border-slate-600/60 bg-slate-900/30 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-300">Regime</p>
              <p className="text-lg font-semibold capitalize text-slate-100">{currentRegime}</p>
            </div>
            <div className="rounded-xl border border-slate-600/60 bg-slate-900/30 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-300">VIX</p>
              <p className="text-lg font-semibold text-slate-100">{regime?.vix != null ? Number(regime.vix).toFixed(2) : 'N/A'}</p>
            </div>
          </div>

          {contextLoading ? (
            <p className="text-sm text-slate-400">Loading market context...</p>
          ) : contextError ? (
            <p className="text-sm text-rose-300">{contextError}</p>
          ) : (
            <div className="rounded-xl border border-slate-600/60 bg-slate-900/25 p-3">
              <p className="text-sm font-semibold text-slate-100 mb-2">Why this matters</p>
              <p className="text-xs text-slate-400 mb-3">
                This is built from the current ticker, not a generic market summary.
              </p>
              {tickerInsights.length ? (
                <ul className="space-y-2 text-sm text-slate-200 list-disc list-inside">
                  {tickerInsights.map((insight, index) => (
                    <li key={index}>{insight}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-300">No ticker-specific insight is available yet.</p>
              )}
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-slate-600/60 bg-slate-900/25 p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-2xl font-bold tracking-tight">{result.symbol}</h3>
                    <span className="text-xs px-2 py-1 rounded-full border border-sky-700/60 bg-sky-900/35 text-sky-200 uppercase">
                      {(result.market || market).toString()}
                    </span>
                  </div>
                  <p className="text-slate-200 mt-1">{result.company_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold">{hasQuote ? `$${priceValue.toFixed(2)}` : 'N/A'}</p>
                  <p className={`text-sm ${hasQuote && changeValue >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {hasQuote ? `${changeValue >= 0 ? '+' : ''}$${changeValue.toFixed(2)} (${changePctValue.toFixed(2)}%)` : 'Quote unavailable'}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                  <p className="text-xs uppercase text-slate-400">Business Summary</p>
                  <p className="text-sm text-slate-200 mt-1 leading-relaxed">
                    {result.summary || 'No company summary available.'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                  <p className="text-xs uppercase text-slate-400">Quick Thesis</p>
                  <p className="text-sm text-slate-200 mt-1 leading-relaxed">
                    {recommendationReasons[0] || 'No thesis summary available.'}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                <p className="text-xs uppercase text-slate-400 mb-2">Recommendation</p>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${badgeClass}`}>
                    {result.recommendation?.action || 'watch'}
                  </span>
                  <span className="text-sm text-slate-200">Score: {Number(result.recommendation?.score ?? 0)}/100</span>
                </div>
                <ul className="space-y-1 text-sm text-slate-200 list-disc list-inside mt-3">
                  {recommendationReasons.length ? recommendationReasons.map((r, idx) => (
                    <li key={idx}>{r}</li>
                  )) : <li>No recommendation details available.</li>}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="card xl:col-span-6 space-y-3">
            <div className="flex items-center gap-2">
              <PieChart size={18} className="text-teal-300" />
              <h3 className="text-lg font-semibold">Fundamentals</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: 'Market Cap', value: result.market_cap ? `$${(Number(result.market_cap) / 1e9).toFixed(2)}B` : 'N/A' },
                { label: 'Dividend Yield', value: result.dividend_yield != null ? `${(Number(result.dividend_yield) * 100).toFixed(2)}%` : 'N/A' },
                { label: 'Payout Ratio', value: result.payout_ratio != null ? `${(Number(result.payout_ratio) * 100).toFixed(1)}%` : 'N/A' },
                { label: 'Earnings Date', value: result.earnings_date || 'N/A' },
                { label: 'Trailing EPS', value: result.trailing_eps != null ? result.trailing_eps.toFixed(2) : 'N/A' },
                { label: 'Forward EPS', value: result.forward_eps != null ? result.forward_eps.toFixed(2) : 'N/A' },
                { label: 'Analyst Mean', value: result.analyst_recommendation_mean != null ? result.analyst_recommendation_mean.toFixed(2) : 'N/A' },
                { label: 'Analyst Opinions', value: result.analyst_opinions_count != null ? String(result.analyst_opinions_count) : 'N/A' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-600/60 bg-slate-900/30 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-300">{item.label}</p>
                  <p className="text-lg font-semibold text-slate-100 mt-1">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="card xl:col-span-6 space-y-3">
            <div className="flex items-center gap-2">
              <Newspaper size={18} className="text-teal-300" />
              <h3 className="text-lg font-semibold">Dividends & Headlines</h3>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-600/60 bg-slate-900/30 p-3">
                <p className="text-xs uppercase text-slate-400 mb-2">Recent Dividends</p>
                {result.dividends?.length ? (
                  <div className="space-y-2">
                    {result.dividends.slice(-4).reverse().map((item) => (
                      <div key={`${item.date}-${item.amount}`} className="flex items-center justify-between text-sm">
                        <span className="text-slate-200">{new Date(item.date).toLocaleDateString()}</span>
                        <span className="text-emerald-300">${Number(item.amount).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No dividend data available.</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-600/60 bg-slate-900/30 p-3">
                <p className="text-xs uppercase text-slate-400 mb-2">News</p>
                {result.news?.length ? (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                    {result.news.map((item, idx) => (
                      <a
                        key={`${item.title}-${idx}`}
                        href={item.link || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-slate-700 bg-slate-900/40 p-2 hover:border-teal-400/70 transition"
                      >
                        <p className="text-sm font-semibold text-slate-100 leading-snug">{item.title}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {item.publisher || 'Unknown source'}{item.published_at ? ` • ${new Date(item.published_at).toLocaleString()}` : ''}
                        </p>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No recent news returned by the data source.</p>
                )}
              </div>
            </div>

            {result.dcf?.available && (
              <div className="rounded-xl border border-slate-600/60 bg-slate-900/30 p-3">
                <p className="text-xs uppercase text-slate-400 mb-2">DCF Snapshot</p>
                <div className="grid gap-2 md:grid-cols-3">
                  <div>
                    <p className="text-xs text-slate-400">Fair Value</p>
                    <p className="text-lg font-semibold text-slate-100">${Number(result.dcf.fair_value ?? 0).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Upside</p>
                    <p className={`text-lg font-semibold ${(result.dcf.upside_pct ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {result.dcf.upside_pct != null ? `${result.dcf.upside_pct >= 0 ? '+' : ''}${Number(result.dcf.upside_pct).toFixed(2)}%` : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Inputs</p>
                    <p className="text-xs text-slate-200 mt-1">
                      g {(Number(result.dcf.assumptions?.growth_rate || 0) * 100).toFixed(1)}% / r {(Number(result.dcf.assumptions?.discount_rate || 0) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            )}

            {result.summary && (
              <div className="rounded-xl border border-slate-600/60 bg-slate-900/30 p-3">
                <p className="text-xs uppercase text-slate-400 mb-2">Company Summary</p>
                <p className="text-sm text-slate-200 leading-relaxed">{result.summary}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
