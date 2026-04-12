'use client';

import React, { useEffect, useState } from 'react';
import { tradeMetricsApi } from '@/lib/api';
import { TrendingUp, TrendingDown, Activity, BarChart3, Calendar } from 'lucide-react';

interface Trade {
  id: string;
  symbol: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl: number;
  pnl_pct: number;
  strategy: string;
  entry_reason: string;
  timestamp: string;
  date: string;
  mode: string;
}

interface Metrics {
  win_rate: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  avg_win: number;
  avg_loss: number;
  total_pnl: number;
  avg_pnl_pct: number;
  largest_win: number;
  largest_loss: number;
  sharpe_ratio: number;
  profit_factor: number;
}

interface DailyPnL {
  date: string;
  trades_count: number;
  pnl: number;
  pnl_pct: number;
}

const STRATEGIES = [
  {
    name: 'MomentumTradingBot',
    description: 'Trades stocks with strong recent RSI and positive price momentum',
    icon: '🚀',
    color: 'from-blue-500 to-blue-600',
  },
  {
    name: 'SwingTradingBot',
    description: 'Trades oversold stocks (RSI < 30) poised for reversals',
    icon: '📈',
    color: 'from-green-500 to-green-600',
  },
  {
    name: 'ValueInvestingBot',
    description: 'Finds undervalued stocks with strong fundamentals (low P/E, high dividend)',
    icon: '💎',
    color: 'from-purple-500 to-purple-600',
  },
  {
    name: 'GrowthInvestingBot',
    description: 'Finds high-growth companies (revenue & earnings growth > 20%)',
    icon: '📊',
    color: 'from-amber-500 to-amber-600',
  },
  {
    name: 'MeanReversionBot',
    description: 'Trades RSI extremes - buys oversold (RSI < 30), sells overbought (RSI > 70)',
    icon: '⚖️',
    color: 'from-pink-500 to-pink-600',
  },
];

export default function StrategyPerformancePanel() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [strategyMetrics, setStrategyMetrics] = useState<Record<string, Metrics>>({});
  const [dailyPnL, setDailyPnL] = useState<DailyPnL[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'trades' | 'strategies'>('overview');
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [historyRes, metricsRes, strategyRes, dailyRes] = await Promise.all([
        tradeMetricsApi.getHistory(200),
        tradeMetricsApi.getMetrics(),
        tradeMetricsApi.getMetricsByStrategy(),
        tradeMetricsApi.getDailyPnL(),
      ]);

      setTrades(historyRes.data.trades || []);
      setMetrics(metricsRes.data.metrics || null);
      setStrategyMetrics(strategyRes.data.strategies || {});
      setDailyPnL(dailyRes.data.daily || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const money = (val: number) => {
    if (!val) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: val < 1 ? 2 : val < 100 ? 2 : 0,
    }).format(val);
  };

  const pct = (val: number) => {
    if (!val) return '0.0%';
    return `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;
  };

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-96 text-slate-400">
        <div className="text-center">
          <Activity className="w-12 h-12 mx-auto mb-2 animate-spin" />
          <p>Loading performance data...</p>
        </div>
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="bg-rose-900/20 border border-rose-700/50 rounded p-4 text-rose-100">
        <p className="font-semibold">Error loading data</p>
        <p className="text-sm text-rose-200">{error}</p>
        <button
          onClick={fetchData}
          className="mt-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 rounded text-sm font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  // ========================================================================
  // OVERVIEW TAB - Overall Metrics & Daily P&L
  // ========================================================================

  const OverviewTab = () => (
    <div className="space-y-6">
      {/* Overall Metrics Cards */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <p className="text-xs text-slate-400 mb-1">TOTAL P&L</p>
            <p className={`text-2xl font-bold ${metrics.total_pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {money(metrics.total_pnl)}
            </p>
            <p className="text-xs text-slate-500 mt-1">{metrics.total_trades} trades</p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <p className="text-xs text-slate-400 mb-1">WIN RATE</p>
            <p className="text-2xl font-bold text-blue-300">{metrics.win_rate.toFixed(1)}%</p>
            <p className="text-xs text-slate-500 mt-1">
              {metrics.winning_trades}W / {metrics.losing_trades}L
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <p className="text-xs text-slate-400 mb-1">AVG TRADE</p>
            <p className={`text-2xl font-bold ${metrics.avg_pnl_pct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {pct(metrics.avg_pnl_pct)}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Avg Win: {pct(metrics.avg_win > 0 ? (metrics.avg_win / Math.abs(metrics.avg_loss || 1)) * 100 : 0)}
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <p className="text-xs text-slate-400 mb-1">SHARPE RATIO</p>
            <p className={`text-2xl font-bold ${metrics.sharpe_ratio >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {metrics.sharpe_ratio.toFixed(2)}
            </p>
            <p className="text-xs text-slate-500 mt-1">Risk-adjusted return</p>
          </div>
        </div>
      )}

      {/* Daily P&L Chart */}
      <div className="bg-slate-900/40 border border-slate-700 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold">Daily P&L</h3>
        </div>

        {dailyPnL.length === 0 ? (
          <p className="text-slate-400 text-center py-8">No trading data yet</p>
        ) : (
          <div className="space-y-3">
            {dailyPnL.slice(0, 10).map((day) => (
              <div key={day.date} className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-300">{day.date}</p>
                  <p className="text-xs text-slate-500">{day.trades_count} trades</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-32 h-6 bg-slate-700 rounded">
                    <div
                      className={`h-full rounded ${
                        day.pnl >= 0 ? 'bg-emerald-500/60' : 'bg-rose-500/60'
                      }`}
                      style={{
                        width: `${Math.min(Math.abs((day.pnl / 100) * 100), 100)}%`,
                      }}
                    />
                  </div>
                  <div className="text-right w-20">
                    <p className={`text-sm font-semibold ${day.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {money(day.pnl)}
                    </p>
                    <p className="text-xs text-slate-500">{pct(day.pnl_pct)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ========================================================================
  // TRADES TAB - Detailed Trade History
  // ========================================================================

  const TradesTab = () => {
    const filteredTrades = selectedStrategy
      ? trades.filter((t) => t.strategy === selectedStrategy)
      : trades;

    return (
      <div className="space-y-4">
        {/* Strategy Filter */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedStrategy(null)}
            className={`px-3 py-1 rounded text-sm font-medium transition ${
              selectedStrategy === null
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            All ({trades.length})
          </button>
          {Array.from(new Set(trades.map((t) => t.strategy))).map((strat) => (
            <button
              key={strat}
              onClick={() => setSelectedStrategy(strat)}
              className={`px-3 py-1 rounded text-sm font-medium transition ${
                selectedStrategy === strat
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {strat} ({trades.filter((t) => t.strategy === strat).length})
            </button>
          ))}
        </div>

        {/* Trade List */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredTrades.length === 0 ? (
            <p className="text-slate-400 text-center py-8">No trades yet</p>
          ) : (
            filteredTrades.map((trade) => (
              <div key={trade.id} className="bg-slate-800/50 border border-slate-700 rounded p-3 text-sm">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-white">{trade.symbol}</p>
                    <p className="text-xs text-slate-400">{trade.strategy}</p>
                  </div>
                  <p
                    className={`font-semibold ${
                      trade.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {money(trade.pnl)} ({pct(trade.pnl_pct)})
                  </p>
                </div>
                <p className="text-xs text-slate-400 mb-1">
                  Entered @ ${trade.entry_price.toFixed(4)} | Exited @ ${trade.exit_price.toFixed(4)} | {trade.quantity} shares
                </p>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{trade.date}</span>
                  <span className="capitalize">{trade.mode}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // ========================================================================
  // STRATEGIES TAB - Strategy Info & Performance
  // ========================================================================

  const StrategiesTab = () => (
    <div className="space-y-4">
      {STRATEGIES.map((strategy) => {
        const metric = strategyMetrics[strategy.name] || null;
        const strategy_color = strategy.color;

        return (
          <div
            key={strategy.name}
            className={`bg-gradient-to-r ${strategy_color} p-0.5 rounded-lg`}
          >
            <div className="bg-slate-900/95 rounded-lg p-4">
              <div className="flex items-start gap-4">
                <span className="text-3xl">{strategy.icon}</span>
                <div className="flex-1">
                  <h4 className="font-semibold text-white mb-1">{strategy.name}</h4>
                  <p className="text-sm text-slate-300 mb-3">{strategy.description}</p>

                  {metric ? (
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div className="bg-slate-700/50 rounded p-2">
                        <p className="text-slate-400">Win Rate</p>
                        <p className="font-semibold text-blue-300">{metric.win_rate.toFixed(1)}%</p>
                      </div>
                      <div className="bg-slate-700/50 rounded p-2">
                        <p className="text-slate-400">Total P&L</p>
                        <p
                          className={`font-semibold ${
                            metric.total_pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'
                          }`}
                        >
                          {money(metric.total_pnl)}
                        </p>
                      </div>
                      <div className="bg-slate-700/50 rounded p-2">
                        <p className="text-slate-400">Trades</p>
                        <p className="font-semibold text-white">{metric.total_trades}</p>
                      </div>
                      <div className="bg-slate-700/50 rounded p-2">
                        <p className="text-slate-400">Sharpe</p>
                        <p
                          className={`font-semibold ${
                            metric.sharpe_ratio >= 0 ? 'text-emerald-300' : 'text-rose-300'
                          }`}
                        >
                          {metric.sharpe_ratio.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">No trades yet for this strategy</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col bg-slate-900/50">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700 px-4 py-3 sticky top-0 bg-slate-900/30 z-10">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 rounded-t text-sm font-medium transition ${
            activeTab === 'overview'
              ? 'bg-slate-700 text-white border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Overview
          </div>
        </button>
        <button
          onClick={() => setActiveTab('trades')}
          className={`px-4 py-2 rounded-t text-sm font-medium transition ${
            activeTab === 'trades'
              ? 'bg-slate-700 text-white border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Trades ({trades.length})
          </div>
        </button>
        <button
          onClick={() => setActiveTab('strategies')}
          className={`px-4 py-2 rounded-t text-sm font-medium transition ${
            activeTab === 'strategies'
              ? 'bg-slate-700 text-white border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Strategies
          </div>
        </button>
        <button
          onClick={fetchData}
          className="ml-auto px-3 py-2 text-slate-400 hover:text-slate-200 transition text-sm"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'trades' && <TradesTab />}
        {activeTab === 'strategies' && <StrategiesTab />}
      </div>
    </div>
  );
}
