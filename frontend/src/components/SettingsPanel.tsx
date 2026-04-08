'use client';

import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store';
import { botApi, brokerApi, configApi, statusApi } from '@/lib/api';
import { Activity, Bot, SlidersHorizontal, Sparkles, Wallet } from 'lucide-react';

export default function SettingsPanel() {
  const { config, currentMode, setConfig, setCurrentMode } = useTradingStore();
  const [presets, setPresets] = useState<any>({});
  const [customAllocation, setCustomAllocation] = useState({
    blowup_stocks_pct: 33.33,
    covered_calls_pct: 33.33,
    forex_pct: 33.34,
  });
  const [selectedBroker, setSelectedBroker] = useState('ibkr');
  const [brokerRuntimeConfig, setBrokerRuntimeConfig] = useState<any>({});
  const [brokerStatus, setBrokerStatus] = useState('');
  const [brokerLoading, setBrokerLoading] = useState(false);
  const [executionMode, setExecutionMode] = useState<'manual' | 'automatic'>('manual');
  const [backendOnline, setBackendOnline] = useState(false);
  const [botRunning, setBotRunning] = useState(false);
  const [botLoading, setBotLoading] = useState(false);
  const [botIntervalSeconds, setBotIntervalSeconds] = useState(60);
  const [botStatusMessage, setBotStatusMessage] = useState('');
  const [botCycleCount, setBotCycleCount] = useState(0);
  const [botLastRun, setBotLastRun] = useState<string | null>(null);
  const [botLastError, setBotLastError] = useState<string | null>(null);
  const [settingsConfig, setSettingsConfig] = useState<any>(null);

  const getHeartbeatAge = (iso: string | null) => {
    if (!iso) return 'N/A';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return '0s';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${minutes}m ${seconds % 60}s`;
  };

  const currentSettings = settingsConfig ?? config ?? {};
  const allocationTotal =
    customAllocation.blowup_stocks_pct + customAllocation.covered_calls_pct + customAllocation.forex_pct;

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      const [currentResult, presetsResult, brokerResult, botResult, healthResult] = await Promise.allSettled([
        configApi.getCurrent(),
        configApi.getPresets(),
        brokerApi.getOptions(),
        botApi.getStatus(),
        statusApi.getHealth(),
      ]);

      if (!mounted) return;

      if (currentResult.status === 'fulfilled') {
        const nextConfig = currentResult.value.data || {};
        setSettingsConfig(nextConfig);
        setConfig(nextConfig);
        if (nextConfig.mode) {
          setCurrentMode(nextConfig.mode);
        }
        const allocation = nextConfig.allocation || {};
        setCustomAllocation({
          blowup_stocks_pct: Number(allocation.blowup_stocks_pct ?? 33.33),
          covered_calls_pct: Number(allocation.covered_calls_pct ?? 33.33),
          forex_pct: Number(allocation.forex_pct ?? 33.34),
        });
      }

      if (presetsResult.status === 'fulfilled') {
        setPresets(presetsResult.value.data?.presets || {});
      }

      if (brokerResult.status === 'fulfilled') {
        const brokerData = brokerResult.value.data || {};
        setSelectedBroker(brokerData.current || 'demo');
        setBrokerRuntimeConfig(brokerData.active_config || {});
        setBrokerStatus(
          brokerData.connected ? `Connected to ${String(brokerData.current || 'demo').toUpperCase()}` : 'Demo mode active'
        );
      }

      if (botResult.status === 'fulfilled') {
        const botData = botResult.value.data || {};
        setExecutionMode(botData.execution_mode ?? 'manual');
        setBotRunning(Boolean(botData.bot_running));
        setBotCycleCount(Number(botData.bot_cycle_count ?? 0));
        setBotLastRun(botData.bot_last_run ?? null);
        setBotLastError(botData.bot_last_error ?? null);
      }

      setBackendOnline(healthResult.status === 'fulfilled');
    };

    void loadSettings();

    return () => {
      mounted = false;
    };
  }, [setConfig, setCurrentMode]);

  const saveConfig = async (nextConfig: any, message: string) => {
    const response = await configApi.update(nextConfig);
    const updatedConfig = response.data?.config ?? nextConfig;
    setSettingsConfig(updatedConfig);
    setConfig(updatedConfig);
    if (updatedConfig.mode) {
      setCurrentMode(updatedConfig.mode);
    }
    setBotStatusMessage(message);
    return updatedConfig;
  };

  const handleModeChange = async (modeId: string) => {
    setBotStatusMessage('');
    setBrokerStatus('');
    try {
      await configApi.setMode(modeId);
      const refreshed = await configApi.getCurrent();
      const nextConfig = refreshed.data || {};
      setSettingsConfig(nextConfig);
      setConfig(nextConfig);
      setCurrentMode(modeId);
      const allocation = nextConfig.allocation || presets?.[modeId] || {};
      setCustomAllocation({
        blowup_stocks_pct: Number(allocation.blowup_stocks_pct ?? 33.33),
        covered_calls_pct: Number(allocation.covered_calls_pct ?? 33.33),
        forex_pct: Number(allocation.forex_pct ?? 33.34),
      });
      setBotStatusMessage(`Trading mode set to ${modeId.replace(/_/g, ' ')}`);
    } catch (error: any) {
      setBotStatusMessage(error?.response?.data?.error || error?.message || 'Failed to set trading mode');
    }
  };

  const handleAllocationChange = async () => {
    try {
      await saveConfig(
        {
          ...currentSettings,
          allocation: { ...customAllocation },
        },
        'Custom allocation saved.'
      );
    } catch (error: any) {
      setBotStatusMessage(error?.response?.data?.error || error?.message || 'Failed to save allocation');
    }
  };

  const updateFilterSection = async (section: string, key: string, value: any) => {
    try {
      const nextConfig = {
        ...currentSettings,
        [section]: {
          ...(currentSettings?.[section] || {}),
          [key]: value,
        },
      };
      await saveConfig(nextConfig, 'Screening filters updated.');
    } catch (error: any) {
      setBotStatusMessage(error?.response?.data?.error || error?.message || 'Failed to update filters');
    }
  };

  const handleBrokerSwitch = async () => {
    setBrokerLoading(true);
    try {
      const response = await brokerApi.switch(selectedBroker, selectedBroker === 'ibkr' ? brokerRuntimeConfig : {});
      const nextBroker = response.data?.broker || selectedBroker;
      setSelectedBroker(nextBroker);
      setBrokerRuntimeConfig(response.data?.config || {});
      setBrokerStatus(
        nextBroker === 'demo'
          ? 'Switched to demo mode'
          : `Switched to ${String(nextBroker).toUpperCase()} paper trading`
      );
      setBackendOnline(true);
    } catch (error: any) {
      setBrokerStatus(error?.response?.data?.error || error?.message || 'Broker switch failed');
    } finally {
      setBrokerLoading(false);
    }
  };

  const handleExecutionModeChange = async (mode: 'manual' | 'automatic') => {
    setBotLoading(true);
    try {
      const response = await botApi.setMode(mode, mode === 'automatic', botIntervalSeconds);
      setExecutionMode(response.data?.execution_mode || mode);
      setBotRunning(Boolean(response.data?.bot_running));
      setBotStatusMessage(`Execution mode set to ${mode}`);
      setBackendOnline(true);
    } catch (error: any) {
      setBotStatusMessage(error?.response?.data?.error || error?.message || 'Failed to set execution mode');
    } finally {
      setBotLoading(false);
    }
  };

  const handleBotStartStop = async () => {
    setBotLoading(true);
    try {
      if (botRunning) {
        await botApi.stop();
        setBotRunning(false);
        setBotStatusMessage('Bot stopped');
      } else {
        const response = await botApi.start(botIntervalSeconds);
        setBotRunning(Boolean(response.data?.bot_running));
        setBotStatusMessage('Bot started');
      }
    } catch (error: any) {
      setBotStatusMessage(error?.response?.data?.error || error?.message || 'Failed to update bot runner');
    } finally {
      setBotLoading(false);
    }
  };

  const filterFields = (
    <div className="space-y-4">
      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-300 mb-2">Relative Volume</label>
        <input
          type="number"
          step="0.1"
          min="0"
          value={currentSettings?.fundamental_screener?.relative_volume_threshold ?? 2}
          onChange={(e) => updateFilterSection('fundamental_screener', 'relative_volume_threshold', Number(e.target.value))}
          className="input-modern"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-300 mb-2">P/E Max</label>
          <input
            type="number"
            step="1"
            min="0"
            value={currentSettings?.fundamental_screener?.pe_ratio_max ?? 30}
            onChange={(e) => updateFilterSection('fundamental_screener', 'pe_ratio_max', Number(e.target.value))}
            className="input-modern"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-300 mb-2">Forward P/E</label>
          <input
            type="number"
            step="1"
            min="0"
            value={currentSettings?.fundamental_screener?.forward_pe_ratio_max ?? 25}
            onChange={(e) => updateFilterSection('fundamental_screener', 'forward_pe_ratio_max', Number(e.target.value))}
            className="input-modern"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-300 mb-2">Price Min</label>
          <input
            type="number"
            step="0.5"
            min="0"
            value={currentSettings?.fundamental_screener?.price_min ?? 5}
            onChange={(e) => updateFilterSection('fundamental_screener', 'price_min', Number(e.target.value))}
            className="input-modern"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-300 mb-2">Price Max</label>
          <input
            type="number"
            step="1"
            min="0"
            value={currentSettings?.fundamental_screener?.price_max ?? 500}
            onChange={(e) => updateFilterSection('fundamental_screener', 'price_max', Number(e.target.value))}
            className="input-modern"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-300 mb-2">Min Market Cap</label>
          <input
            type="number"
            step="10"
            min="0"
            value={currentSettings?.fundamental_screener?.market_cap_min_millions ?? 100}
            onChange={(e) => updateFilterSection('fundamental_screener', 'market_cap_min_millions', Number(e.target.value))}
            className="input-modern"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-300 mb-2">Target Delta</label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={currentSettings?.option_screener?.target_delta ?? 0.25}
            onChange={(e) => updateFilterSection('option_screener', 'target_delta', Number(e.target.value))}
            className="input-modern"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-300 mb-2">Min Premium %</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={currentSettings?.option_screener?.min_premium_pct ?? 0.5}
            onChange={(e) => updateFilterSection('option_screener', 'min_premium_pct', Number(e.target.value))}
            className="input-modern"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-300 mb-2">Forex Leverage</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={currentSettings?.forex?.leverage ?? 1}
            onChange={(e) => updateFilterSection('forex', 'leverage', Number(e.target.value))}
            className="input-modern"
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-12 xl:items-start">
          <div className="xl:col-span-8 space-y-5 self-start">
            <section className="card">
              <div className="flex items-center gap-3 mb-3">
                <Sparkles className="text-teal-300" size={20} />
                <h3 className="text-xl md:text-2xl font-bold">Trading Mode</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {[
                  { id: 'balanced', label: 'Balanced', desc: '33/33/34' },
                  { id: 'aggressive', label: 'Aggressive', desc: '50/30/20' },
                  { id: 'conservative', label: 'Conservative', desc: '20/50/30' },
                  { id: 'options_focused', label: 'Options', desc: '10/80/10' },
                  { id: 'forex_focused', label: 'Forex', desc: '20/20/60' },
                  { id: 'custom', label: 'Custom', desc: 'User Defined' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => handleModeChange(mode.id)}
                    className={`rounded-xl border p-3 text-left transition ${
                      currentMode === mode.id
                        ? 'border-teal-300 bg-teal-900/25'
                        : 'border-slate-600/70 hover:border-slate-400 hover:bg-slate-900/35'
                    }`}
                  >
                    <p className="font-semibold text-white text-sm">{mode.label}</p>
                    <p className="text-[11px] text-slate-300 mt-0.5">{mode.desc}</p>
                  </button>
                ))}
              </div>
            </section>

            <section className="card">
              <div className="flex items-center gap-3 mb-4">
                <Wallet className="text-teal-300" size={20} />
                <h3 className="text-xl md:text-2xl font-bold">Strategy Allocation</h3>
              </div>

              <div className="mb-5 overflow-hidden rounded-xl border border-slate-600/60 h-4 bg-slate-900/40 flex">
                <div style={{ width: `${customAllocation.blowup_stocks_pct}%` }} className="bg-cyan-400/80" />
                <div style={{ width: `${customAllocation.covered_calls_pct}%` }} className="bg-amber-400/80" />
                <div style={{ width: `${customAllocation.forex_pct}%` }} className="bg-emerald-400/80" />
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold mb-2">
                    Blowup Stocks <span className="text-cyan-300">{customAllocation.blowup_stocks_pct.toFixed(1)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={customAllocation.blowup_stocks_pct}
                    onChange={(e) =>
                      setCustomAllocation({
                        ...customAllocation,
                        blowup_stocks_pct: parseFloat(e.target.value),
                      })
                    }
                    className="range-modern w-full accent-cyan-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2">
                    Covered Calls <span className="text-amber-300">{customAllocation.covered_calls_pct.toFixed(1)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={customAllocation.covered_calls_pct}
                    onChange={(e) =>
                      setCustomAllocation({
                        ...customAllocation,
                        covered_calls_pct: parseFloat(e.target.value),
                      })
                    }
                    className="range-modern w-full accent-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2">
                    Forex <span className="text-emerald-300">{customAllocation.forex_pct.toFixed(1)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={customAllocation.forex_pct}
                    onChange={(e) =>
                      setCustomAllocation({
                        ...customAllocation,
                        forex_pct: parseFloat(e.target.value),
                      })
                    }
                    className="range-modern w-full accent-emerald-400"
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-700/70 pt-4">
                <p className="text-sm text-slate-200">Total Allocation: {allocationTotal.toFixed(1)}%</p>
                <button onClick={handleAllocationChange} className="btn-primary hidden md:inline-flex">Save Custom Allocation</button>
              </div>
            </section>
          </div>

          <div className="xl:col-span-4 space-y-5 self-start">
            <section className="card space-y-4">
              <div className="flex items-center gap-3 mb-2.5">
                <Activity className="text-teal-300" size={20} />
                <h3 className="text-xl font-bold">Broker</h3>
              </div>
              <div className="space-y-2">
                <select
                  value={selectedBroker}
                  onChange={(e) => setSelectedBroker(e.target.value)}
                  className="input-modern"
                >
                  <option value="ibkr">IBKR Paper Trading</option>
                  <option value="alpaca">Alpaca Paper Trading</option>
                  <option value="demo">Demo / Mock Data</option>
                </select>
                <button
                  onClick={handleBrokerSwitch}
                  disabled={brokerLoading}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  {brokerLoading ? 'Switching...' : 'Switch Broker'}
                </button>
                {brokerStatus && <p className="text-sm text-slate-100">{brokerStatus}</p>}
                <p className="text-xs text-slate-300 leading-snug">IBKR uses TWS/Gateway on your configured host/port.</p>

                {selectedBroker === 'ibkr' && (
                  <div className="rounded-xl border border-slate-600/70 bg-slate-900/35 p-2.5 text-xs text-slate-300">
                    <p className="font-semibold text-slate-100 mb-1">IB Runtime</p>
                    <p>
                      Host: <span className="text-slate-100">{brokerRuntimeConfig?.host || '127.0.0.1'}</span>
                    </p>
                    <p>
                      Port: <span className="text-slate-100">{brokerRuntimeConfig?.port ?? 'auto'}</span>
                    </p>
                    <p>
                      Client ID: <span className="text-slate-100">{brokerRuntimeConfig?.client_id ?? 'auto'}</span>
                    </p>
                    {brokerRuntimeConfig?.auto_detected && (
                      <p className="text-teal-200 mt-1">Auto-detected by backend</p>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="card space-y-4">
              <div className="flex items-center gap-3 mb-2.5">
                <Bot className="text-teal-300" size={20} />
                <h3 className="text-xl font-bold">Execution Mode</h3>
              </div>

              <div className="mb-2 rounded-xl border border-slate-600/70 bg-slate-900/35 p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">Manual / Automatic</p>
                    <p className="text-xs text-slate-300">Toggle to switch execution mode</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-semibold shrink-0 ${executionMode === 'manual' ? 'text-teal-100' : 'text-slate-400'}`}>Manual</span>
                    <button
                      onClick={() => handleExecutionModeChange(executionMode === 'manual' ? 'automatic' : 'manual')}
                      role="switch"
                      aria-checked={executionMode === 'automatic'}
                      disabled={botLoading || !backendOnline}
                      className={`relative h-8 w-16 shrink-0 rounded-full border transition-all duration-300 ease-out ${
                        executionMode === 'automatic'
                          ? 'border-emerald-400/70 bg-emerald-500/30'
                          : 'border-slate-500/70 bg-slate-700/50'
                      } ${botLoading || !backendOnline ? 'opacity-70 cursor-not-allowed' : 'hover:brightness-110'}`}
                    >
                      <span
                        className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${
                          executionMode === 'automatic' ? 'translate-x-8' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className={`text-xs font-semibold shrink-0 ${executionMode === 'automatic' ? 'text-teal-100' : 'text-slate-400'}`}>Automatic</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-2">
                <label className="block text-xs uppercase tracking-wide text-slate-300">Bot cycle interval (seconds)</label>
                <input
                  type="number"
                  min={10}
                  step={5}
                  value={botIntervalSeconds}
                  onChange={(e) => setBotIntervalSeconds(Math.max(10, Number(e.target.value || 10)))}
                  className="input-modern"
                />
              </div>

              <button
                onClick={handleBotStartStop}
                disabled={botLoading || executionMode !== 'automatic' || !backendOnline}
                className="btn-primary w-full disabled:opacity-50"
              >
                {botLoading ? 'Working...' : botRunning ? 'Stop Bot' : 'Start Bot'}
              </button>

              <div className="mt-2 text-xs text-slate-300 space-y-1 leading-snug">
                <p>Backend: <span className={backendOnline ? 'text-profit' : 'text-loss'}>{backendOnline ? 'Online' : 'Offline'}</span></p>
                <p>Mode: <span className="text-slate-100 uppercase">{executionMode}</span></p>
                <p>Runner: <span className={botRunning ? 'text-profit' : 'text-loss'}>{botRunning ? 'Running' : 'Stopped'}</span></p>
                <p>Cycles: <span className="text-slate-100">{botCycleCount}</span></p>
                <p>Last Run: <span className="text-slate-100">{botLastRun ? new Date(botLastRun).toLocaleString() : 'N/A'}</span></p>
                <p>Heartbeat Age: <span className="text-slate-100">{getHeartbeatAge(botLastRun)}</span></p>
                {botLastError && <p>Last Error: <span className="text-loss">{botLastError}</span></p>}
              </div>

              {botStatusMessage && <p className="text-sm text-slate-100 mt-2">{botStatusMessage}</p>}
              <p className="text-xs text-slate-300 mt-2">Manual mode only provides data/screening. Automatic mode enables bot cycles and live trading.</p>
            </section>

            <section className="card">
              <div className="flex items-center gap-3 mb-4">
                <SlidersHorizontal className="text-teal-300" size={20} />
                <h3 className="text-xl font-bold">Screening Filters</h3>
              </div>

              <div className="hidden md:block">
                {filterFields}
              </div>

              <details className="md:hidden rounded-xl border border-slate-600/70 bg-slate-900/35 p-3" open={false}>
                <summary className="cursor-pointer text-sm font-semibold text-slate-100">Advanced Filters</summary>
                <div className="mt-3">{filterFields}</div>
              </details>
            </section>
          </div>
        </div>

      <div className="fixed bottom-3 left-3 right-3 z-30 md:hidden">
        <div className="rounded-2xl border border-slate-600/80 bg-[#0b1d27]/95 backdrop-blur-md px-4 py-3 shadow-2xl shadow-black/40 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-300">Allocation Total</p>
            <p className="text-sm font-semibold text-slate-100">{allocationTotal.toFixed(1)}%</p>
          </div>
          <button onClick={handleAllocationChange} className="btn-primary">Save Allocation</button>
        </div>
      </div>
    </>
  );
}
