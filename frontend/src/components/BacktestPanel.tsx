'use client';

import React, { useState } from 'react';
import { backtestApi } from '@/lib/api';
import { Play, Zap, BarChart3 } from 'lucide-react';

interface BacktestResult {
  symbol: string;
  strategy: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  total_pnl_pct: number;
  final_capital: number;
  avg_win: number;
  avg_loss: number;
  trades?: any[];
  error?: string;
}

const QUICK_BACKTESTS = [
  { symbol: 'NVDA', strategy: 'momentum', label: '🚀 NVDA Momentum' },
  { symbol: 'AAPL', strategy: 'swing', label: '📈 AAPL Swing' },
  { symbol: 'JPM', strategy: 'mean_reversion', label: '💎 JPM Mean Reversion' },
  { symbol: 'NFLX', strategy: 'momentum', label: '🚀 NFLX Growth' },
];

export default function BacktestPanel() {
  const [symbol, setSymbol] = useState('AAPL');
  const [strategy, setStrategy] = useState('momentum');
  const [daysLookback, setDaysLookback] = useState(60);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null);

  const runBacktest = async (sym?: string, strat?: string) => {
    try {
      setLoading(true);
      const res = await backtestApi.run(
        sym || symbol,
        strat || strategy,
        daysLookback,
        10000
      );
      setResult(res.data);
    } catch (err: any) {
      setResult({
        symbol: sym || symbol,
        strategy: strat || strategy,
        error: err.message || 'Backtest failed',
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        win_rate: 0,
        total_pnl: 0,
        total_pnl_pct: 0,
        final_capital: 0,
        avg_win: 0,
        avg_loss: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const money = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(val);
  };

  return (
    <div className="w-full space-y-4 pb-8">
      {/* Quick Backtests */}
      <div className="px-4">
        <p className="text-xs font-semibold text-slate-300 mb-2 uppercase">Quick Test</p>
        <div className="grid grid-cols-2 gap-2">
          {QUICK_BACKTESTS.map((test) => (
            <button
              key={`${test.symbol}-${test.strategy}`}
              onClick={() => runBacktest(test.symbol, test.strategy)}
              disabled={loading}
              className="bg-slate-800/50 hover:bg-slate-700/50 disabled:opacity-50 border border-slate-700 rounded p-2 text-xs font-medium transition text-left"
            >
              <div>
                <p className="text-slate-200">{test.label}</p>
                <p className="text-slate-500 text-xs mt-0.5">{test.strategy}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Test Form */}
      <div className="px-4 space-y-3 bg-slate-800/30 rounded-lg border border-slate-700 p-4">
        <div>
          <label className="text-xs text-slate-400 mb-1 block">Symbol</label>
          <input
            type="text"
            value={symbol.toUpperCase()}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="AAPL"
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 outline-none"
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1 block">Strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
          >
            <option value="momentum">Momentum</option>
            <option value="swing">Swing</option>
            <option value="mean_reversion">Mean Reversion</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1 block">
            Lookback: {daysLookback} days
          </label>
          <input
            type="range"
            min="30"
            max="365"
            value={daysLookback}
            onChange={(e) => setDaysLookback(parseInt(e.target.value))}
            className="w-full h-2 bg-slate-700 rounded-lg cursor-pointer"
          />
        </div>

        <button
          onClick={() => runBacktest()}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded py-2 font-medium text-sm transition flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Zap className="w-4 h-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Run Backtest
            </>
          )}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="px-4 space-y-3">
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-lg border border-slate-700 p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-5 h-5 text-blue-400" />
              <div className="flex-1">
                <p className="font-semibold text-white">
                  {result.symbol} • {result.strategy}
                </p>
                <p className="text-xs text-slate-400">{daysLookback} days backtest</p>
              </div>
            </div>

            {result.error ? (
              <p className="text-sm text-rose-300">{result.error}</p>
            ) : (
              <>
                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <p className="text-xs text-slate-400">Total P&L</p>
                    <p className={`text-lg font-bold ${result.total_pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {money(result.total_pnl)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Return</p>
                    <p className={`text-lg font-bold ${result.total_pnl_pct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {result.total_pnl_pct > 0 ? '+' : ''}{result.total_pnl_pct.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Win Rate</p>
                    <p className="text-lg font-bold text-blue-300">{result.win_rate.toFixed(0)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Trades</p>
                    <p className="text-lg font-bold text-slate-200">
                      {result.winning_trades}W/{result.losing_trades}L
                    </p>
                  </div>
                </div>

                {/* Trade Details */}
                {result.avg_win !== 0 && (
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-300">
                      <span>Avg Win:</span>
                      <span className="text-emerald-300">{money(result.avg_win)}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Avg Loss:</span>
                      <span className="text-rose-300">{money(result.avg_loss)}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Final Capital:</span>
                      <span className="text-blue-300">{money(result.final_capital)}</span>
                    </div>
                  </div>
                )}

                {/* Trades List */}
                {result.trades && result.trades.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    <p className="text-xs font-semibold text-slate-400 mb-2">Trades ({result.trades.length})</p>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {result.trades.slice(0, 10).map((trade, idx) => (
                        <button
                          key={idx}
                          onClick={() => setExpandedTrade(expandedTrade === idx ? null : idx)}
                          className="w-full bg-slate-700/30 hover:bg-slate-700/50 rounded p-2 text-left transition text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span>Trade {idx + 1}</span>
                            <span className={trade.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                              {trade.pnl >= 0 ? '+' : ''}{money(trade.pnl)}
                            </span>
                          </div>
                          {expandedTrade === idx && (
                            <div className="text-slate-400 mt-2 space-y-1">
                              <p>Entry: ${trade.entry.toFixed(4)}</p>
                              <p>Exit: ${trade.exit.toFixed(4)}</p>
                              <p>Shares: {trade.shares}</p>
                              <p>{trade.pnl_pct > 0 ? '+' : ''}{trade.pnl_pct.toFixed(1)}%</p>
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
