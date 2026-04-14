'use client';

import React, { useEffect, useState } from 'react';
import { summaryApi } from '@/lib/api';
import { Moon, TrendingUp, TrendingDown, AlertCircle, CheckCircle } from 'lucide-react';

interface OvernightSummary {
  date: string;
  trades_count: number;
  winning_trades: number;
  losing_trades: number;
  total_pnl: number;
  unrealized_pnl?: number;
  total_pnl_including_unrealized?: number;
  total_pnl_pct: number;
  win_rate: number;
  by_strategy: Record<
    string,
    {
      trades: number;
      pnl: number;
      wins: number;
    }
  >;
  recent_trades: any[];
  comparison: {
    yesterday_pnl: number;
    improvement: number;
  };
  alerts: string[];
}

export default function OvernightSummaryPanel() {
  const [summary, setSummary] = useState<OvernightSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const fetchSummary = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await summaryApi.getOvernightSummary();
      setSummary(res.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load overnight summary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchSummary, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center p-6 text-slate-400">
        <div className="text-center">
          <Moon className="w-8 h-8 mx-auto mb-2 animate-pulse" />
          <p className="text-sm">Loading overnight summary...</p>
        </div>
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="bg-rose-900/20 border border-rose-700/50 rounded p-4 text-rose-100 text-sm">
        <p className="font-semibold">Error loading data</p>
        <p>{error}</p>
        <button
          onClick={fetchSummary}
          className="mt-2 px-3 py-1 bg-rose-600 hover:bg-rose-500 rounded text-xs font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!summary) {
    return <div className="text-slate-400 text-center py-8">No data available</div>;
  }

  const money = (val: number) => {
    if (!val) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: val < 1 ? 2 : val < 100 ? 2 : 0,
    }).format(val);
  };

  return (
    <div className="w-full space-y-4 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-800/50 rounded-lg border border-slate-700">
        <Moon className="w-5 h-5 text-blue-400" />
        <div className="flex-1">
          <h2 className="font-semibold text-white text-sm">What Bot Did Last Night</h2>
          <p className="text-xs text-slate-400">{summary.date}</p>
        </div>
        <button
          onClick={() => {
            setRefreshCount(c => c + 1);
            fetchSummary();
          }}
          className="text-slate-400 hover:text-slate-200 text-xs"
        >
          ↻
        </button>
      </div>

      {/* Main Stats - Mobile Friendly Grid */}
      <div className="px-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Total P&L */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg p-3 border border-slate-700">
          <p className="text-xs text-slate-400 mb-1">Total P&L</p>
          <p className={`text-lg font-bold ${Number(summary.total_pnl_including_unrealized ?? summary.total_pnl) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {money(Number(summary.total_pnl_including_unrealized ?? summary.total_pnl))}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            R {money(summary.total_pnl)} / U {money(Number(summary.unrealized_pnl || 0))}
          </p>
        </div>

        {/* Trades Count */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg p-3 border border-slate-700">
          <p className="text-xs text-slate-400 mb-1">Trades</p>
          <p className="text-lg font-bold text-blue-300">{summary.trades_count}</p>
          <p className="text-xs text-slate-500 mt-1">
            {summary.winning_trades}W / {summary.losing_trades}L
          </p>
        </div>

        {/* Win Rate */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-lg p-3 border border-slate-700">
          <p className="text-xs text-slate-400 mb-1">Win Rate</p>
          <p className="text-lg font-bold text-amber-300">{summary.win_rate.toFixed(0)}%</p>
          <p className="text-xs text-slate-500 mt-1">{summary.trades_count > 0 ? 'of trades' : 'no trades'}</p>
        </div>

        {/* vs Yesterday */}
        <div
          className={`bg-gradient-to-br rounded-lg p-3 border ${
            summary.comparison.improvement >= 0
              ? 'from-emerald-900/30 to-emerald-800/20 border-emerald-700/50'
              : 'from-rose-900/30 to-rose-800/20 border-rose-700/50'
          }`}
        >
          <p className="text-xs text-slate-400 mb-1">vs Yesterday</p>
          <p className={`text-lg font-bold ${summary.comparison.improvement >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {summary.comparison.improvement >= 0 ? '+' : ''}{money(summary.comparison.improvement)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Yesterday: {money(summary.comparison.yesterday_pnl)}
          </p>
        </div>
      </div>

      {/* Strategy Breakdown */}
      {Object.keys(summary.by_strategy).length > 0 && (
        <div className="px-4">
          <p className="text-xs font-semibold text-slate-300 mb-2 uppercase">By Strategy</p>
          <div className="space-y-2">
            {Object.entries(summary.by_strategy).map(([strategy, data]) => (
              <div key={strategy} className="bg-slate-800/50 rounded border border-slate-700 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-200">{strategy}</p>
                    <p className="text-xs text-slate-400">{data.trades} trades • {data.wins} wins</p>
                  </div>
                  <p className={`text-sm font-semibold ${data.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {data.pnl >= 0 ? '+' : ''}{money(data.pnl)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alerts */}
      {summary.alerts.length > 0 && (
        <div className="px-4">
          <p className="text-xs font-semibold text-slate-300 mb-2 uppercase">Alerts</p>
          <div className="space-y-2">
            {summary.alerts.map((alert, idx) => {
              const isWarning = alert.includes('⚠️');
              const isError = alert.includes('🔴');
              const isSuccess = alert.includes('✓');
              
              return (
                <div
                  key={idx}
                  className={`rounded border p-3 text-xs flex items-start gap-2 ${
                    isError
                      ? 'bg-rose-900/20 border-rose-700/50 text-rose-100'
                      : isWarning
                        ? 'bg-amber-900/20 border-amber-700/50 text-amber-100'
                        : 'bg-emerald-900/20 border-emerald-700/50 text-emerald-100'
                  }`}
                >
                  {isError && <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                  {isSuccess && <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                  <span>{alert}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Trades */}
      {summary.recent_trades.length > 0 && (
        <div className="px-4">
          <p className="text-xs font-semibold text-slate-300 mb-2 uppercase">Last 5 Trades</p>
          <div className="space-y-2">
            {summary.recent_trades.map((trade, idx) => (
              <div key={idx} className="bg-slate-800/50 rounded border border-slate-700 p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-white text-sm">{trade.symbol}</p>
                  <p className={`font-semibold text-sm ${trade.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {trade.pnl >= 0 ? '+' : ''}{money(trade.pnl)}
                  </p>
                </div>
                <p className="text-xs text-slate-400">
                  {trade.quantity} @ {trade.entry_price.toFixed(2)} → {trade.exit_price.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">{trade.strategy}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Data State */}
      {summary.trades_count === 0 && (
        <div className="px-4 py-8 text-center text-slate-400">
          <Moon className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Bot didn't trade last night</p>
          <p className="text-xs text-slate-500 mt-1">Check back after the bot has run</p>
        </div>
      )}
    </div>
  );
}
