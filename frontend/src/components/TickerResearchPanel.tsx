'use client';

import { ChangeEvent, KeyboardEvent, useMemo, useState } from 'react';
import { tickerApi } from '@/lib/api';

type ResearchResult = {
  symbol: string;
  company_name: string;
  sector?: string;
  industry?: string;
  price: number;
  previous_close: number;
  change: number;
  change_pct: number;
  market_cap?: number;
  trailing_pe?: number;
  forward_pe?: number;
  analyst_recommendation_mean?: number;
  analyst_opinions_count?: number;
  recommendation: {
    action: 'buy' | 'watch' | 'avoid';
    score: number;
    reasons: string[];
  };
};

export default function TickerResearchPanel() {
  const [query, setQuery] = useState('AAPL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ResearchResult | null>(null);

  const badgeClass = useMemo(() => {
    const action = result?.recommendation?.action;
    if (action === 'buy') return 'bg-green-900 text-green-200 border border-green-700';
    if (action === 'watch') return 'bg-yellow-900 text-yellow-200 border border-yellow-700';
    return 'bg-red-900 text-red-200 border border-red-700';
  }, [result]);

  const onSearch = async () => {
    const symbol = query.trim().toUpperCase();
    if (!symbol) return;

    setLoading(true);
    setError('');
    try {
      const res = await tickerApi.research(symbol);
      setResult(res.data);
    } catch (e: any) {
      const message = e?.response?.data?.error || 'Failed to fetch ticker research';
      setError(message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">Ticker Research Hub</h2>
        <p className="text-slate-300 mb-4 text-sm md:text-base">Find price, quality signals, and a simple buy/watch/avoid recommendation in one place.</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') {
                onSearch();
              }
            }}
            placeholder="Enter ticker, e.g. NVDA"
            className="input-modern flex-1"
          />
          <button onClick={onSearch} disabled={loading} className="btn-primary disabled:opacity-50">
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
        {error && <p className="text-rose-300 text-sm mt-3">{error}</p>}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-2xl md:text-3xl font-bold tracking-tight">{result.symbol}</h3>
                <p className="text-slate-200">{result.company_name}</p>
                <p className="text-sm text-slate-300">
                  {result.sector || 'N/A'} {result.industry ? `| ${result.industry}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl md:text-4xl font-bold">${result.price.toFixed(2)}</p>
                <p className={`text-sm ${result.change >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {result.change >= 0 ? '+' : ''}${result.change.toFixed(2)} ({result.change_pct.toFixed(2)}%)
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="rounded-xl border border-slate-600/60 bg-slate-900/30 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-300">Forward P/E</p>
                <p className="text-sm font-semibold">{result.forward_pe ?? 'N/A'}</p>
              </div>
              <div className="rounded-xl border border-slate-600/60 bg-slate-900/30 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-300">Trailing P/E</p>
                <p className="text-sm font-semibold">{result.trailing_pe ?? 'N/A'}</p>
              </div>
              <div className="rounded-xl border border-slate-600/60 bg-slate-900/30 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-300">Analyst Mean</p>
                <p className="text-sm font-semibold">{result.analyst_recommendation_mean ?? 'N/A'}</p>
              </div>
              <div className="rounded-xl border border-slate-600/60 bg-slate-900/30 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-300">Opinions</p>
                <p className="text-sm font-semibold">{result.analyst_opinions_count ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${badgeClass}`}>
                {result.recommendation.action}
              </span>
              <span className="text-sm text-slate-200">Score: {result.recommendation.score}/100</span>
            </div>
            <div className="mt-4">
              <p className="text-sm font-semibold mb-2">Why this recommendation</p>
              <ul className="space-y-1 text-sm text-slate-200 list-disc list-inside">
                {result.recommendation.reasons.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
