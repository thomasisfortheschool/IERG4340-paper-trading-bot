'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function PortfolioChart({ history, source = 'demo' }: { history: any[]; source?: string }) {
  if (!history || history.length === 0) {
    return <div className="card text-center text-slate-300">No portfolio history available yet.</div>;
  }

  const normalizedSource = String(source || 'demo').toLowerCase();
  const isLiveSource = normalizedSource !== 'demo';
  const sourceLabel = isLiveSource ? `Live ${normalizedSource.toUpperCase()} (positions-based)` : 'Demo simulated';

  const start = Number(history[0]?.cumulative_pnl ?? 0);
  const end = Number(history[history.length - 1]?.cumulative_pnl ?? 0);
  const isUp = end >= start;
  const cumulativeColor = isUp ? '#22e07a' : '#ff5f74';
  const trendLabel = isUp ? 'Uptrend' : 'Drawdown';

  const dailyValues = history.map((d) => Number(d?.daily_pnl ?? 0));
  const dailyMin = Math.min(...dailyValues);
  const dailyMax = Math.max(...dailyValues);
  const rawOffset =
    dailyMax <= 0
      ? 0
      : dailyMin >= 0
        ? 1
        : dailyMax / (dailyMax - dailyMin);
  const zeroOffset = Math.max(0, Math.min(1, rawOffset));

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Cumulative P&L Chart */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="text-xl md:text-2xl font-bold">Cumulative P&L</h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold border ${isLiveSource ? 'text-cyan-200 border-cyan-400/50 bg-cyan-900/30' : 'text-slate-200 border-slate-500/40 bg-slate-800/60'}`}>
              {sourceLabel}
            </span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold border ${isUp ? 'text-profit border-emerald-400/50 bg-emerald-900/35' : 'text-loss border-rose-400/50 bg-rose-900/35'}`}>
              {trendLabel} ({isUp ? '+' : ''}${(end - start).toFixed(2)})
            </span>
          </div>
        </div>
        <p className="text-sm text-slate-300 mb-4">
          {isLiveSource ? 'Last 30 trading days from broker account and position marks' : 'Last 30 trading days (simulated demo series)'}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="4 4" stroke="#2b5567" />
            <XAxis dataKey="date" stroke="#9ab5bf" />
            <YAxis stroke="#9ab5bf" />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f2230', border: '1px solid #2b5567', borderRadius: 10 }}
              formatter={(value: any) => `$${value?.toFixed(2)}`}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="cumulative_pnl"
              stroke={cumulativeColor}
              strokeWidth={2.5}
              dot={{ r: 2, fill: cumulativeColor }}
              name="Cumulative P&L"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Daily P&L Chart */}
      <div className="card">
        <h2 className="text-xl md:text-2xl font-bold mb-1">Daily P&L</h2>
        <p className="text-sm text-slate-300 mb-4">Day-by-day strategy outcome</p>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={history}>
            <defs>
              <linearGradient id="dailyPnLZeroSplit" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22e07a" />
                <stop offset={`${zeroOffset * 100}%`} stopColor="#22e07a" />
                <stop offset={`${zeroOffset * 100}%`} stopColor="#ff5f74" />
                <stop offset="100%" stopColor="#ff5f74" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="#2b5567" />
            <XAxis dataKey="date" stroke="#9ab5bf" />
            <YAxis stroke="#9ab5bf" />
            <Tooltip
              contentStyle={{ backgroundColor: '#0f2230', border: '1px solid #2b5567', borderRadius: 10 }}
              formatter={(value: any) => `$${value?.toFixed(2)}`}
            />
            <Line
              type="monotone"
              dataKey="daily_pnl"
              stroke="url(#dailyPnLZeroSplit)"
              strokeWidth={2.2}
              dot={{ r: 2, fill: '#d9f2f6' }}
              name="Daily P&L"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
