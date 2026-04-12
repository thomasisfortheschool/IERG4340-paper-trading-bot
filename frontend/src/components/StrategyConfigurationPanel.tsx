'use client';

import React, { useEffect, useState } from 'react';
import { Settings, Play, Square, RefreshCw } from 'lucide-react';
import { configApi } from '@/lib/api';

interface StrategyConfig {
  name: string;
  enabled: boolean;
  allocation_pct?: number;
  description: string;
  entry_logic: string;
  exit_logic: string;
  timeframe: string;
  risk_level: 'Low' | 'Medium' | 'High';
  icon: string;
}

const STRATEGY_CONFIGS: StrategyConfig[] = [
  {
    name: 'Momentum Trading',
    enabled: true,
    allocation_pct: 25,
    description: 'Trades stocks with strong recent RSI and positive price momentum',
    entry_logic: 'RSI between 50-70 + 5-day momentum > 2%',
    exit_logic: '+6% profit target or -3% stop loss',
    timeframe: '1-5 days',
    risk_level: 'Medium',
    icon: '🚀',
  },
  {
    name: 'Swing Trading',
    enabled: true,
    allocation_pct: 25,
    description: 'Trades oversold stocks poised for reversals at support levels',
    entry_logic: 'RSI < 30 (oversold) near 52-week low',
    exit_logic: '+5% profit target or -2.5% stop loss',
    timeframe: '5-15 days',
    risk_level: 'Medium',
    icon: '📈',
  },
  {
    name: 'Value Investing',
    enabled: true,
    allocation_pct: 25,
    description: 'Finds undervalued stocks with strong fundamentals',
    entry_logic: 'Low P/E ratio (< 15) + High dividend yield (> 3%)',
    exit_logic: '+12% profit target or -5% stop loss',
    timeframe: 'Weeks to months',
    risk_level: 'Low',
    icon: '💎',
  },
  {
    name: 'Growth Investing',
    enabled: true,
    allocation_pct: 15,
    description: 'Finds high-growth companies with strong earnings',
    entry_logic: 'Revenue growth > 20% + Earnings growth > 15%',
    exit_logic: '+15% profit target or -6% stop loss',
    timeframe: 'Medium to long term',
    risk_level: 'High',
    icon: '📊',
  },
  {
    name: 'Mean Reversion',
    enabled: true,
    allocation_pct: 10,
    description: 'Trades RSI extremes for quick reversals',
    entry_logic: 'RSI extremes (< 30 buy, > 70 sell)',
    exit_logic: '+3% profit target or -1.5% stop loss',
    timeframe: 'Hours to 2-3 days',
    risk_level: 'High',
    icon: '⚖️',
  },
];

export default function StrategyConfigurationPanel() {
  const [strategies, setStrategies] = useState(STRATEGY_CONFIGS);
  const [autoRunning, setAutoRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await configApi.getCurrent();
      const config = res.data.config || {};

      // Update strategies based on config if it exists
      const strategies_config = config.strategies || {};
      setStrategies((prev) =>
        prev.map((s) => ({
          ...s,
          enabled: strategies_config[s.name.replace(' ', '_').toLowerCase()]?.enabled ?? s.enabled,
          allocation_pct: strategies_config[s.name.replace(' ', '_').toLowerCase()]?.allocation_pct ?? s.allocation_pct,
        }))
      );

      setAutoRunning(config.execution_mode === 'automatic');
      setLastSync(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Error fetching config:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    try {
      setLoading(true);

      // Build strategies config object
      const strategiesConfig: Record<string, any> = {};
      strategies.forEach((s) => {
        const key = s.name.replace(' ', '_').toLowerCase();
        strategiesConfig[key] = {
          enabled: s.enabled,
          allocation_pct: s.allocation_pct || 20,
        };
      });

      await configApi.update({
        strategies: strategiesConfig,
      });

      setLastSync(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Error saving config:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleStrategy = (name: string) => {
    setStrategies((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const updateAllocation = (name: string, pct: number) => {
    const total = strategies.reduce((sum, s) => sum + (s.name !== name ? s.allocation_pct || 0 : pct), 0);
    if (total <= 100) {
      setStrategies((prev) =>
        prev.map((s) => (s.name === name ? { ...s, allocation_pct: pct } : s))
      );
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const totalAllocation = strategies.reduce((sum, s) => sum + (s.enabled && s.allocation_pct ? s.allocation_pct : 0), 0);
  const enabledCount = strategies.filter((s) => s.enabled).length;

  return (
    <div className="w-full h-full flex flex-col bg-slate-900/50 overflow-hidden">
      {/* Header */}
      <div
        className="border-b border-slate-700 px-6 py-4 sticky top-0 bg-slate-900/30 z-10 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-blue-400" />
          <div>
            <h2 className="font-semibold text-white">Strategy Configuration</h2>
            <p className="text-xs text-slate-400">
              {enabledCount} of {strategies.length} strategies active • Total allocation: {totalAllocation}%
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastSync && <p className="text-xs text-slate-500">Synced: {lastSync}</p>}
          <button
            onClick={() => {
              fetchConfig();
            }}
            className="p-2 hover:bg-slate-700 rounded transition"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Info Banner */}
        <div className="mx-4 mt-4 p-4 bg-blue-900/30 border border-blue-700/50 rounded-lg text-sm text-blue-100">
          <p className="font-semibold mb-2">💡 How Strategy Selection Works</p>
          <ul className="text-xs space-y-1 text-blue-200 list-disc list-inside">
            <li>Enable/disable strategies to activate them in automatic mode</li>
            <li>Allocation % determines how much capital each strategy gets</li>
            <li>Total allocation should not exceed 100%</li>
            <li>Watch the Performance tab to see real-time results</li>
            <li>The bot scans continuously and executes trades when entry criteria are met</li>
          </ul>
        </div>

        {/* Strategies Grid */}
        <div className="p-4 space-y-3">
          {strategies.map((strategy) => (
            <div
              key={strategy.name}
              className={`border rounded-lg p-4 transition ${
                strategy.enabled
                  ? 'bg-slate-800/60 border-slate-600'
                  : 'bg-slate-800/30 border-slate-700 opacity-60'
              }`}
            >
              {/* Header with Toggle */}
              <div className="flex items-start gap-3 mb-3">
                <input
                  type="checkbox"
                  checked={strategy.enabled}
                  onChange={() => toggleStrategy(strategy.name)}
                  className="mt-1 w-4 h-4 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-2xl">{strategy.icon}</span>
                    <h3 className="font-semibold text-white">{strategy.name}</h3>
                    <span className={`text-xs px-2 py-1 rounded ${
                      strategy.risk_level === 'Low'
                        ? 'bg-green-900/50 text-green-200'
                        : strategy.risk_level === 'Medium'
                          ? 'bg-amber-900/50 text-amber-200'
                          : 'bg-rose-900/50 text-rose-200'
                    }`}>
                      {strategy.risk_level} Risk
                    </span>
                  </div>
                  <p className="text-sm text-slate-300">{strategy.description}</p>
                </div>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-3 gap-3 mb-3 ml-8">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Entry Logic</p>
                  <p className="text-xs text-slate-200 bg-slate-900/40 p-2 rounded">{strategy.entry_logic}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Exit Logic</p>
                  <p className="text-xs text-slate-200 bg-slate-900/40 p-2 rounded">{strategy.exit_logic}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Typical Hold</p>
                  <p className="text-xs text-slate-200 bg-slate-900/40 p-2 rounded text-center">{strategy.timeframe}</p>
                </div>
              </div>

              {/* Allocation Slider */}
              {strategy.enabled && (
                <div className="ml-8 flex items-center gap-3">
                  <label className="text-xs text-slate-400 w-20">Capital Allocation:</label>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    value={strategy.allocation_pct || 0}
                    onChange={(e) => updateAllocation(strategy.name, parseInt(e.target.value))}
                    className="flex-1 h-2 bg-slate-700 rounded-lg cursor-pointer"
                  />
                  <span className="text-sm font-semibold text-blue-300 w-12 text-right">
                    {strategy.allocation_pct}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Warnings */}
        {totalAllocation > 100 && (
          <div className="mx-4 mb-4 p-3 bg-rose-900/30 border border-rose-700/50 rounded text-sm text-rose-100">
            ⚠️ Total allocation exceeds 100% ({totalAllocation}%). Please adjust strategy allocations.
          </div>
        )}

        {totalAllocation < 50 && enabledCount > 0 && (
          <div className="mx-4 mb-4 p-3 bg-amber-900/30 border border-amber-700/50 rounded text-sm text-amber-100">
            ℹ️ Low capital allocation ({totalAllocation}%). Consider enabling more strategies or increasing allocations for better diversification.
          </div>
        )}
      </div>

      {/* Footer with Save Button */}
      <div className="border-t border-slate-700 px-6 py-4 bg-slate-900/30 flex justify-end gap-2">
        <button
          onClick={fetchConfig}
          className="px-4 py-2 text-slate-300 hover:text-slate-100 transition text-sm"
        >
          Reset
        </button>
        <button
          onClick={saveConfig}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded font-medium text-sm transition flex items-center gap-2"
        >
          {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
          Save Configuration
        </button>
      </div>
    </div>
  );
}
