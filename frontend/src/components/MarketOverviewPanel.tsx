'use client';

import { useEffect, useMemo, useState } from 'react';
import { marketApi } from '@/lib/api';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type IndexPoint = {
  time: string;
  price: number;
};

type MarketIndex = {
  symbol: string;
  name: string;
  region: string;
  price: number;
  previous_close: number;
  change: number;
  change_pct: number;
  trend: 'up' | 'down';
  points: IndexPoint[];
};

const FALLBACK_INDICES: MarketIndex[] = [
  {
    symbol: '^GSPC',
    name: 'S&P 500',
    region: 'US',
    price: 0,
    previous_close: 0,
    change: 0,
    change_pct: 0,
    trend: 'up',
    points: [],
  },
];

export default function MarketOverviewPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [asOf, setAsOf] = useState<string>('');
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('^GSPC');

  const fetchData = async () => {
    try {
      const res = await marketApi.getIndices();
      const rows = (res.data?.indices || []) as MarketIndex[];
      setIndices(rows);
      setAsOf(String(res.data?.as_of || new Date().toISOString()));
      setError('');

      if (rows.length > 0 && !rows.some((item) => item.symbol === selectedSymbol)) {
        setSelectedSymbol(rows[0].symbol);
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to load market overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => {
      void fetchData();
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  const rows = indices.length > 0 ? indices : FALLBACK_INDICES;
  const selected = rows.find((item) => item.symbol === selectedSymbol) || rows[0];
  const sortedByMove = [...rows].sort((a, b) => Math.abs(Number(b.change_pct || 0)) - Math.abs(Number(a.change_pct || 0)));
  const chartData = (selected?.points || []).map((point) => {
    const date = new Date(point.time);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return {
      t: `${hh}:${mm}`,
      price: Number(point.price || 0),
    };
  });

  const summaryText = useMemo(() => {
    if (!asOf) return '';
    return new Date(asOf).toLocaleString();
  }, [asOf]);

  if (loading) {
    return <div className="card text-sm text-slate-300">Loading major indices...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg md:text-xl font-bold">Global Market Pulse</h2>
            <p className="text-xs text-slate-300">Major indices with intraday movement</p>
          </div>
          {summaryText && <p className="text-xs text-slate-400">Updated {summaryText}</p>}
        </div>

        {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}

        <div className="mt-3 flex gap-2 overflow-x-auto whitespace-nowrap pb-1">
          {rows.map((item) => {
            const positive = Number(item.change || 0) >= 0;
            return (
              <button
                key={item.symbol}
                onClick={() => setSelectedSymbol(item.symbol)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-left transition ${
                  selected?.symbol === item.symbol
                    ? 'border-cyan-300 bg-cyan-900/25'
                    : 'border-slate-700/70 bg-slate-950/20 hover:border-slate-500'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">{item.region}</span>
                  <span className="text-xs font-semibold text-slate-100">{item.name}</span>
                  <span className="text-xs font-semibold text-slate-100">{Number(item.price || 0).toLocaleString()}</span>
                  <span className={`text-xs font-semibold ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {positive ? '+' : ''}{Number(item.change_pct || 0).toFixed(2)}%
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="card xl:col-span-8">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-lg font-semibold text-slate-100">{selected?.name || 'Index'} Intraday</h3>
            <div className="text-right">
              <span className="block text-xs text-slate-400">{selected?.symbol || '-'}</span>
              <span className={`text-sm font-semibold ${Number(selected?.change || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {Number(selected?.change || 0) >= 0 ? '+' : ''}{Number(selected?.change || 0).toFixed(2)} ({Number(selected?.change_pct || 0) >= 0 ? '+' : ''}{Number(selected?.change_pct || 0).toFixed(2)}%)
              </span>
            </div>
          </div>

          {chartData.length === 0 ? (
            <p className="text-sm text-slate-400">No intraday points available yet for this index.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <XAxis dataKey="t" stroke="#9ab5bf" minTickGap={26} />
                <YAxis stroke="#9ab5bf" domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f2230', border: '1px solid #2b5567', borderRadius: 10 }}
                  formatter={(value: any) => Number(value || 0).toLocaleString()}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke={Number(selected?.change || 0) >= 0 ? '#22e07a' : '#ff5f74'}
                  strokeWidth={2.2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card xl:col-span-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300 mb-3">Top Movers</h3>
          <div className="space-y-2">
            {sortedByMove.map((item) => {
              const positive = Number(item.change_pct || 0) >= 0;
              return (
                <button
                  key={`m-${item.symbol}`}
                  onClick={() => setSelectedSymbol(item.symbol)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    selected?.symbol === item.symbol
                      ? 'border-cyan-300 bg-cyan-900/20'
                      : 'border-slate-700/70 bg-slate-950/20 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-100">{item.name}</p>
                      <p className="text-[11px] text-slate-400">{item.symbol}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-200">{Number(item.price || 0).toLocaleString()}</p>
                      <p className={`text-xs font-semibold ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {positive ? '+' : ''}{Number(item.change_pct || 0).toFixed(2)}%
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
