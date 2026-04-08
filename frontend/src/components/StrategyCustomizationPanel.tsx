'use client';

import { useState, useEffect } from 'react';
import { strategyApi, backtestApi, marketApi } from '@/lib/api';
import { Settings, CheckCircle2 } from 'lucide-react';

const GUIDED_PRESETS: Record<string, { label: string; description: string; updates: any }> = {
  conservative: {
    label: 'Conservative',
    description: 'Fewer trades, tighter risk, prioritize capital protection.',
    updates: {
      risk_controls: {
        max_position_size_pct: 3,
        stop_loss_pct: 2,
        take_profit_pct: 4,
        max_holding_days: 7,
        max_loss_pct: 0.5,
      },
    },
  },
  balanced: {
    label: 'Balanced',
    description: 'Moderate risk/reward and medium holding horizon.',
    updates: {
      risk_controls: {
        max_position_size_pct: 5,
        stop_loss_pct: 3,
        take_profit_pct: 5,
        max_holding_days: 14,
        max_loss_pct: 1.0,
      },
    },
  },
  aggressive: {
    label: 'Aggressive',
    description: 'Higher volatility tolerance for stronger upside attempts.',
    updates: {
      risk_controls: {
        max_position_size_pct: 8,
        stop_loss_pct: 4,
        take_profit_pct: 8,
        max_holding_days: 21,
        max_loss_pct: 2.0,
      },
    },
  },
};

const FRIENDLY_LABELS: Record<string, string> = {
  relative_volume_threshold: 'Minimum Relative Volume (x)',
  price_momentum_threshold: 'Minimum Price Momentum (%)',
  max_holding_days: 'Max Holding Days',
  stop_loss_pct: 'Stop Loss (%)',
  take_profit_pct: 'Take Profit (%)',
  trailing_stop_pct: 'Trailing Stop (%)',
  max_position_size_pct: 'Max Position Size (%)',
  max_loss_pct: 'Max Daily Loss (%)',
};

const FRIENDLY_HELP: Record<string, string> = {
  relative_volume_threshold: 'Higher value means only unusual volume spikes trigger entries.',
  price_momentum_threshold: 'Higher value means stricter trend confirmation before buying.',
  max_holding_days: 'How long to hold before forcing an exit if target/stop are not hit.',
  stop_loss_pct: 'Maximum tolerated loss per position before auto exit.',
  take_profit_pct: 'Profit target per position before taking gains.',
  trailing_stop_pct: 'Trailing stop to protect gains as price rises.',
  max_position_size_pct: 'Largest single-position allocation.',
  max_loss_pct: 'Maximum total daily loss before risk-off behavior.',
};

export default function StrategyCustomizationPanel() {
  const [strategyName, setStrategyName] = useState('blowup_stocks');
  const [config, setConfig] = useState<any>(null);
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [backtestSymbol, setBacktestSymbol] = useState('NVDA');
  const [backtestLookbackDays, setBacktestLookbackDays] = useState(252);
  const [backtestError, setBacktestError] = useState('');
  const [regime, setRegime] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activePreset, setActivePreset] = useState<string>('balanced');

  const strategies = ['blowup_stocks', 'covered_calls', 'forex'];
  const backtestSymbolDefaults: Record<string, string> = {
    blowup_stocks: 'NVDA',
    covered_calls: 'SPY',
    forex: 'EURUSD=X',
  };

  useEffect(() => {
    loadStrategies(strategyName);
    setBacktestSymbol(backtestSymbolDefaults[strategyName] || 'SPY');
    setBacktestResult(null);
    setBacktestError('');
  }, [strategyName]);

  const loadStrategies = async (name: string) => {
    setLoading(true);
    try {
      const [configRes, defaultsRes, regimeRes] = await Promise.allSettled([
        strategyApi.getConfig(name),
        strategyApi.getDefaults(),
        marketApi.getRegime(),
      ]);

      if (configRes.status === 'fulfilled') {
        setConfig(configRes.value.data.config);
      }
      if (defaultsRes.status === 'fulfilled') {
        // Defaults endpoint warms API and can be surfaced in future UI versions.
      }
      if (regimeRes.status === 'fulfilled') {
        setRegime(regimeRes.value.data);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = (key: string, value: any) => {
    setConfig({
      ...config,
      [key]: value,
    });
    setSaved(false);
  };

  const parseNumericInput = (raw: string): number | null => {
    if (raw.trim() === '') {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const handleSaveConfig = async () => {
    setLoading(true);
    try {
      await strategyApi.updateConfig(strategyName, config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setLoading(false);
    }
  };

  const applyGuidedPreset = (presetKey: string) => {
    const preset = GUIDED_PRESETS[presetKey];
    if (!preset || !config) return;

    setConfig({
      ...config,
      risk_controls: {
        ...(config.risk_controls || {}),
        ...(preset.updates.risk_controls || {}),
      },
    });
    setActivePreset(presetKey);
    setSaved(false);
  };

  const handleRunBacktest = async () => {
    setLoading(true);
    setBacktestError('');
    try {
      const symbol = backtestSymbol.trim().toUpperCase();
      if (!symbol) {
        setBacktestError('Enter a symbol to backtest.');
        return;
      }

      const res = await backtestApi.run(symbol, strategyName, Math.max(30, Math.min(backtestLookbackDays, 1000)));
      setBacktestResult({
        ...(res.data.result || {}),
        diagnostics: res.data.diagnostics || null,
      });
    } catch (error: any) {
      setBacktestError(error?.response?.data?.error || error?.message || 'Backtest failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="text-teal-300" size={24} />
          Strategy Customization & Risk Management
        </h2>
      </div>

      {/* Strategy Selector */}
      <div className="card space-y-4">
        <h3 className="text-lg font-semibold">Select Strategy</h3>
        <div className="grid grid-cols-3 gap-3">
          {strategies.map((strategy) => (
            <button
              key={strategy}
              onClick={() => setStrategyName(strategy)}
              className={`p-3 rounded-lg border transition ${
                strategyName === strategy
                  ? 'border-teal-400 bg-teal-900/25'
                  : 'border-slate-600 hover:border-slate-400'
              }`}
            >
              <p className="font-semibold capitalize">{strategy.replace(/_/g, ' ')}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Current Market Regime */}
      {regime && (
        <div className="card space-y-3">
          <h3 className="text-lg font-semibold">Current Market Regime</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">VIX: {regime.vix?.toFixed(2)}</p>
              <p className="text-xl font-bold capitalize text-cyan-300">
                {regime.regime}
              </p>
              <p className="text-sm text-slate-400 mt-2">{regime.description}</p>
            </div>
            <div className="text-3xl">
              {regime.regime === 'bull' && '📈'}
              {regime.regime === 'bear' && '📉'}
              {regime.regime === 'range_bound' && '↔️'}
              {regime.regime === 'high_volatility' && '⚡'}
            </div>
          </div>
        </div>
      )}

      {/* Entry/Exit Rules */}
      {config && (
        <div className="card space-y-4">
          <h3 className="text-lg font-semibold">Entry & Exit Rules</h3>

          <div className="rounded-xl border border-slate-600/70 bg-slate-900/25 p-3">
            <p className="text-sm font-semibold text-slate-100 mb-2">Guided Presets (Recommended for non-experts)</p>
            <div className="grid gap-2 md:grid-cols-3">
              {Object.entries(GUIDED_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyGuidedPreset(key)}
                  className={`rounded-lg border p-3 text-left transition ${
                    activePreset === key
                      ? 'border-teal-400 bg-teal-900/20'
                      : 'border-slate-600/70 bg-slate-900/35 hover:border-slate-400'
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-100">{preset.label}</p>
                  <p className="text-xs text-slate-300 mt-1">{preset.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Entry Rules */}
            <div className="space-y-3">
              <h4 className="text-sm uppercase tracking-wide text-slate-300">Entry Rules</h4>
              {config.entry_rules &&
                Object.entries(config.entry_rules).map(([key, value]: [string, any]) => (
                  <div key={key}>
                    <label className="text-xs uppercase text-slate-400 mb-1 block">
                      {FRIENDLY_LABELS[key] || key.replace(/_/g, ' ')}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={value ?? ''}
                      onChange={(e) =>
                        handleConfigChange('entry_rules', {
                          ...config.entry_rules,
                          [key]: parseNumericInput(e.target.value),
                        })
                      }
                      className="input-modern w-full"
                    />
                    {FRIENDLY_HELP[key] && <p className="text-[11px] text-slate-400 mt-1">{FRIENDLY_HELP[key]}</p>}
                  </div>
                ))}
            </div>

            {/* Exit Rules */}
            <div className="space-y-3">
              <h4 className="text-sm uppercase tracking-wide text-slate-300">Exit Rules</h4>
              {config.exit_rules &&
                Object.entries(config.exit_rules).map(([key, value]: [string, any]) => (
                  <div key={key}>
                    <label className="text-xs uppercase text-slate-400 mb-1 block">
                      {FRIENDLY_LABELS[key] || key.replace(/_/g, ' ')}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={value ?? ''}
                      onChange={(e) =>
                        handleConfigChange('exit_rules', {
                          ...config.exit_rules,
                          [key]: parseNumericInput(e.target.value),
                        })
                      }
                      className="input-modern w-full"
                    />
                    {FRIENDLY_HELP[key] && <p className="text-[11px] text-slate-400 mt-1">{FRIENDLY_HELP[key]}</p>}
                  </div>
                ))}
            </div>
          </div>

          {/* Risk Controls */}
          <div className="border-t border-slate-700 pt-4">
            <h4 className="text-sm uppercase tracking-wide text-slate-300 mb-3">Risk Controls</h4>
            <div className="grid md:grid-cols-2 gap-4">
              {config.risk_controls &&
                Object.entries(config.risk_controls).map(([key, value]: [string, any]) => (
                  <div key={key}>
                    <label className="text-xs uppercase text-slate-400 mb-1 block">
                      {FRIENDLY_LABELS[key] || key.replace(/_/g, ' ')}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={value ?? ''}
                      onChange={(e) =>
                        handleConfigChange('risk_controls', {
                          ...config.risk_controls,
                          [key]: parseNumericInput(e.target.value),
                        })
                      }
                      className="input-modern w-full"
                    />
                    {FRIENDLY_HELP[key] && <p className="text-[11px] text-slate-400 mt-1">{FRIENDLY_HELP[key]}</p>}
                  </div>
                ))}
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSaveConfig}
            disabled={loading}
            className="btn-primary w-full disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saved && <CheckCircle2 size={18} />}
            {loading ? 'Saving...' : 'Save Strategy Config'}
          </button>
        </div>
      )}

      {/* Backtest Results */}
      <div className="card space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Backtest Performance</h3>
          <p className="text-sm text-slate-300 mt-1">Choose the ticker and time window you want to validate.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs uppercase text-slate-400 mb-2 block">Backtest Symbol</label>
            <input
              value={backtestSymbol}
              onChange={(e) => setBacktestSymbol(e.target.value.toUpperCase())}
              className="input-modern w-full"
              placeholder="NVDA"
            />
          </div>
          <div>
            <label className="text-xs uppercase text-slate-400 mb-2 block">Lookback Days</label>
            <input
              type="number"
              min={30}
              max={1000}
              step={1}
              value={backtestLookbackDays}
              onChange={(e) => setBacktestLookbackDays(Math.max(30, Number(e.target.value || 252)))}
              className="input-modern w-full"
            />
          </div>
        </div>
        <button
          onClick={handleRunBacktest}
          disabled={loading}
          className="btn-secondary w-full disabled:opacity-50"
        >
          {loading ? 'Running Backtest...' : `Run Backtest on ${backtestSymbol || 'Symbol'}`}
        </button>

        {backtestError && <p className="text-sm text-rose-300">{backtestError}</p>}

        {backtestResult && (
          <div className="space-y-3">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="rounded-lg bg-slate-900/40 p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase">Win Rate</p>
                <p className="text-2xl font-bold text-cyan-300">{backtestResult.win_rate}%</p>
                <p className="text-xs text-slate-400 mt-1">
                  {backtestResult.winning_trades} wins, {backtestResult.losing_trades} losses
                </p>
              </div>
              <div className="rounded-lg bg-slate-900/40 p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase">Sharpe Ratio</p>
                <p className={`text-2xl font-bold ${backtestResult.sharpe_ratio > 1 ? 'text-emerald-300' : 'text-yellow-300'}`}>
                  {backtestResult.sharpe_ratio}
                </p>
                <p className="text-xs text-slate-400 mt-1">Risk-adjusted returns</p>
              </div>
              <div className="rounded-lg bg-slate-900/40 p-3 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase">Total Return</p>
                <p className={`text-2xl font-bold ${backtestResult.total_return > 0 ? 'text-emerald-300' : 'text-loss'}`}>
                  {backtestResult.total_return}%
                </p>
                <p className="text-xs text-slate-400 mt-1">Max DD: {backtestResult.max_drawdown}%</p>
              </div>
            </div>

            {backtestResult?.diagnostics?.status === 'no_trades' && (
              <div className="rounded-lg border border-amber-600/60 bg-amber-900/15 p-3">
                <p className="text-sm font-semibold text-amber-200">Why this backtest looks empty</p>
                <p className="text-xs text-amber-100/90 mt-1">{backtestResult.diagnostics.message}</p>
                {backtestResult.diagnostics.signal_scan && (
                  <p className="text-xs text-amber-100/80 mt-2">
                    Signal scan: strict {backtestResult.diagnostics.signal_scan.strict_signals}, relaxed {backtestResult.diagnostics.signal_scan.relaxed_signals}, bars {backtestResult.diagnostics.signal_scan.bars_evaluated}.
                  </p>
                )}
                {Array.isArray(backtestResult.diagnostics.suggestions) && backtestResult.diagnostics.suggestions.length > 0 && (
                  <ul className="list-disc list-inside text-xs text-amber-100/90 mt-2 space-y-1">
                    {backtestResult.diagnostics.suggestions.map((item: string, idx: number) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {!backtestResult && !backtestError && !loading && (
          <p className="text-xs text-slate-400">Backtests use historical price data only. Results depend on symbol liquidity and how much data Yahoo Finance exposes.</p>
        )}
      </div>
    </div>
  );
}
