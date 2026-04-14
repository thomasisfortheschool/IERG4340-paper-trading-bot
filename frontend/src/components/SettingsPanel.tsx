'use client';

import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store';
import { accountApi, botApi, brokerApi, configApi, statusApi } from '@/lib/api';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Activity, AlertTriangle, Bot, SlidersHorizontal, Sparkles, Wallet } from 'lucide-react';

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
  const [brokerCapabilities, setBrokerCapabilities] = useState<any>(null);
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
  const [positionsSnapshot, setPositionsSnapshot] = useState<any[]>([]);
  const [accountTotalValue, setAccountTotalValue] = useState(0);
  const [settingsConfig, setSettingsConfig] = useState<any>(null);
  const [cryptoEnabled, setCryptoEnabled] = useState(false);
  const [cryptoSymbolsInput, setCryptoSymbolsInput] = useState('BTC-USD, ETH-USD');
  const [cryptoRiskAck, setCryptoRiskAck] = useState(false);
  const [cryptoAdvancedAck, setCryptoAdvancedAck] = useState(false);

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
      const [currentResult, presetsResult, brokerResult, capabilitiesResult, botResult, healthResult] = await Promise.allSettled([
        configApi.getCurrent(),
        configApi.getPresets(),
        brokerApi.getOptions(),
        brokerApi.getCapabilities(),
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
        setSelectedBroker((brokerData.current || 'ibkr') as 'ibkr' | 'alpaca');
        setBrokerRuntimeConfig(brokerData.active_config || {});
        setBrokerCapabilities(brokerData.capabilities || null);
        setBrokerStatus(
          brokerData.connected ? `Connected to ${String(brokerData.current || 'ibkr').toUpperCase()}` : 'Broker disconnected'
        );
      }

      if (capabilitiesResult.status === 'fulfilled') {
        setBrokerCapabilities(capabilitiesResult.value.data || null);
      }

      if (botResult.status === 'fulfilled') {
        const botData = botResult.value.data || {};
        setExecutionMode(botData.execution_mode ?? 'manual');
        setBotRunning(Boolean(botData.bot_running));
        setBotCycleCount(Number(botData.bot_cycle_count ?? 0));
        setBotLastRun(botData.bot_last_run ?? null);
        setBotLastError(botData.bot_last_error ?? null);
      }

      setBackendOnline(healthResult.status === 'fulfilled' && healthResult.value?.data?.status === 'healthy');
    };

    void loadSettings();

    return () => {
      mounted = false;
    };
  }, [setConfig, setCurrentMode]);

  useEffect(() => {
    let mounted = true;

    const syncRuntimeStatus = async () => {
      const [botResult, healthResult, positionsResult, accountResult] = await Promise.allSettled([
        botApi.getStatus(),
        statusApi.getHealth(),
        accountApi.getPositions(),
        accountApi.getSnapshot(),
      ]);

      if (!mounted) return;

      if (botResult.status === 'fulfilled') {
        const botData = botResult.value.data || {};
        setExecutionMode(botData.execution_mode ?? 'manual');
        setBotRunning(Boolean(botData.bot_running));
        setBotCycleCount(Number(botData.bot_cycle_count ?? 0));
        setBotLastRun(botData.bot_last_run ?? null);
        setBotLastError(botData.bot_last_error ?? null);
      }

      if (positionsResult.status === 'fulfilled') {
        setPositionsSnapshot(positionsResult.value.data?.positions || []);
      }

      if (accountResult.status === 'fulfilled') {
        setAccountTotalValue(Number(accountResult.value.data?.total_value || 0));
      }

      setBackendOnline(healthResult.status === 'fulfilled' && healthResult.value?.data?.status === 'healthy');
    };

    void syncRuntimeStatus();
    const interval = setInterval(() => {
      void syncRuntimeStatus();
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const nextCrypto = (settingsConfig ?? config)?.crypto ?? {};
    setCryptoEnabled(Boolean(nextCrypto.enabled));
    setCryptoSymbolsInput(Array.isArray(nextCrypto.symbols) && nextCrypto.symbols.length > 0 ? nextCrypto.symbols.join(', ') : 'BTC-USD, ETH-USD');
    setCryptoRiskAck(Boolean(nextCrypto.risk_acknowledged));
    setCryptoAdvancedAck(Boolean(nextCrypto.advanced_user_confirmed));
  }, [settingsConfig, config]);

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

  const normalizeCryptoSymbols = (input: string) =>
    input
      .split(',')
      .map((token) => token.trim().toUpperCase())
      .filter((token) => token.length > 0)
      .map((token) => (token.includes('-') ? token : `${token}-USD`));

  const handleCryptoSettingsSave = async () => {
    const normalizedSymbols = normalizeCryptoSymbols(cryptoSymbolsInput);
    if (cryptoEnabled && normalizedSymbols.length === 0) {
      setBotStatusMessage('Add at least one crypto symbol before enabling 24/7 crypto mode.');
      return;
    }
    if (cryptoEnabled && (!cryptoRiskAck || !cryptoAdvancedAck)) {
      setBotStatusMessage('Enable confirmations first: this mode is only for aggressive and advanced users.');
      return;
    }

    const existingCrypto = currentSettings?.crypto || {};

    try {
      await saveConfig(
        {
          ...currentSettings,
          crypto: {
            ...existingCrypto,
            enabled: cryptoEnabled,
            symbols: normalizedSymbols,
            risk_acknowledged: cryptoRiskAck,
            advanced_user_confirmed: cryptoAdvancedAck,
          },
        },
        cryptoEnabled
          ? `24/7 crypto mode enabled for ${normalizedSymbols.join(', ')}`
          : '24/7 crypto mode disabled.'
      );
    } catch (error: any) {
      setBotStatusMessage(error?.response?.data?.error || error?.message || 'Failed to save crypto settings');
    }
  };

  const handleBrokerSwitch = async () => {
    setBrokerLoading(true);
    try {
      const response = await brokerApi.switch(selectedBroker, selectedBroker === 'ibkr' ? brokerRuntimeConfig : {});
      const capabilityResponse = await brokerApi.getCapabilities();
      const nextBroker = response.data?.broker || selectedBroker;
      setSelectedBroker((nextBroker || 'ibkr') as 'ibkr' | 'alpaca');
      setBrokerRuntimeConfig(response.data?.config || {});
      setBrokerCapabilities(capabilityResponse.data || null);
      setBrokerStatus(`Switched to ${String(nextBroker).toUpperCase()} paper trading`);
      setBackendOnline(true);
    } catch (error: any) {
      setBrokerStatus(error?.response?.data?.error || error?.message || 'Broker switch failed');
    } finally {
      setBrokerLoading(false);
    }
  };

  const handleBotPowerToggle = async () => {
    setBotLoading(true);
    try {
      const isCurrentlyOn = executionMode === 'automatic' && botRunning;

      if (isCurrentlyOn) {
        await botApi.stop();
        await botApi.setMode('manual', false, botIntervalSeconds);
        setExecutionMode('manual');
        setBotRunning(false);
        setBotStatusMessage('Bot turned off. Automatic execution stopped.');
      } else {
        await botApi.setExecutionSafety(false);
        await botApi.setMode('automatic', true, botIntervalSeconds);
        setBotStatusMessage('Bot turned on. Live paper execution started immediately.');
      }

      const latest = await botApi.getStatus().catch(() => null);
      if (latest?.data) {
        setExecutionMode(latest.data.execution_mode ?? 'manual');
        setBotRunning(Boolean(latest.data.bot_running));
        setBotCycleCount(Number(latest.data.bot_cycle_count ?? 0));
        setBotLastRun(latest.data.bot_last_run ?? null);
        setBotLastError(latest.data.bot_last_error ?? null);
      }
      setBackendOnline(true);
    } catch (error: any) {
      setBotStatusMessage(error?.response?.data?.error || error?.message || 'Failed to toggle bot power');
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

  const sleeveStats = positionsSnapshot.reduce(
    (acc, pos) => {
      const asset = String(pos?.asset_type || 'stock').toLowerCase();
      const notional = Math.abs(Number(pos?.current_price || 0) * Number(pos?.quantity || 0));
      if (asset === 'option') {
        acc.options.count += 1;
        acc.options.notional += notional;
      } else if (asset === 'forex') {
        acc.forex.count += 1;
        acc.forex.notional += notional;
      } else if (asset === 'crypto') {
        acc.crypto.count += 1;
        acc.crypto.notional += notional;
      } else {
        acc.stocks.count += 1;
        acc.stocks.notional += notional;
      }
      return acc;
    },
    {
      stocks: { count: 0, notional: 0 },
      options: { count: 0, notional: 0 },
      forex: { count: 0, notional: 0 },
      crypto: { count: 0, notional: 0 },
    }
  );

  const targetStocksPct = Math.max(0, Number(customAllocation.blowup_stocks_pct || 0));
  const targetOptionsPct = Math.max(0, Number(customAllocation.covered_calls_pct || 0));
  const targetForexPct = Math.max(0, Number(customAllocation.forex_pct || 0)) * (cryptoEnabled ? 0.7 : 1.0);
  const targetCryptoPct = cryptoEnabled ? Math.max(0, Number(customAllocation.forex_pct || 0)) * 0.3 : 0;

  const effectiveDenominator =
    accountTotalValue > 0
      ? accountTotalValue
      : sleeveStats.stocks.notional + sleeveStats.options.notional + sleeveStats.forex.notional + sleeveStats.crypto.notional;

  const actualStocksPct = effectiveDenominator > 0 ? (sleeveStats.stocks.notional / effectiveDenominator) * 100 : 0;
  const actualOptionsPct = effectiveDenominator > 0 ? (sleeveStats.options.notional / effectiveDenominator) * 100 : 0;
  const actualForexPct = effectiveDenominator > 0 ? (sleeveStats.forex.notional / effectiveDenominator) * 100 : 0;
  const actualCryptoPct = effectiveDenominator > 0 ? (sleeveStats.crypto.notional / effectiveDenominator) * 100 : 0;

  const complianceRows = [
    { name: 'Stocks', target: targetStocksPct, actual: actualStocksPct },
    { name: 'Options', target: targetOptionsPct, actual: actualOptionsPct },
    { name: 'Forex', target: targetForexPct, actual: actualForexPct },
    { name: 'Crypto', target: targetCryptoPct, actual: actualCryptoPct },
  ];

  const allocationPieData = [
    { name: 'Stocks', value: Math.max(0, Number(customAllocation.blowup_stocks_pct || 0)), color: '#22d3ee' },
    { name: 'Options', value: Math.max(0, Number(customAllocation.covered_calls_pct || 0)), color: '#fbbf24' },
    {
      name: 'Forex',
      value: Math.max(0, Number(customAllocation.forex_pct || 0)) * (cryptoEnabled ? 0.7 : 1.0),
      color: '#34d399',
    },
    {
      name: 'Crypto',
      value: cryptoEnabled ? Math.max(0, Number(customAllocation.forex_pct || 0)) * 0.3 : 0,
      color: '#fb7185',
    },
  ].filter((row) => row.value > 0);

  return (
    <>
        <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
          <div className="space-y-5 self-start">
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

              <div className="grid gap-4 md:grid-cols-2 mb-4">
                <div className="rounded-xl border border-slate-600/60 bg-slate-900/35 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-300 mb-2">Allocation Pie (Configured)</p>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={allocationPieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                          {allocationPieData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: any) => `${Number(value).toFixed(1)}%`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-slate-400">Crypto allocation is carved from the Forex sleeve when 24/7 crypto is enabled.</p>
                </div>

                <div className="rounded-xl border border-slate-600/60 bg-slate-900/35 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-300 mb-2">Live Sleeve Exposure</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between"><span>Stocks</span><span className="text-slate-100">{sleeveStats.stocks.count > 0 ? `${sleeveStats.stocks.count} positions` : 'No positions'}</span></div>
                    <div className="flex items-center justify-between"><span>Options</span><span className="text-slate-100">{sleeveStats.options.count > 0 ? `${sleeveStats.options.count} positions` : 'No positions'}</span></div>
                    <div className="flex items-center justify-between"><span>Forex</span><span className="text-slate-100">{sleeveStats.forex.count > 0 ? `${sleeveStats.forex.count} positions` : 'No positions'}</span></div>
                    <div className="flex items-center justify-between"><span>Crypto</span><span className="text-slate-100">{sleeveStats.crypto.count > 0 ? `${sleeveStats.crypto.count} positions` : 'No positions'}</span></div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-700/60">
                    <p className="text-xs uppercase tracking-wide text-slate-300 mb-2">Allocation Compliance</p>
                    <div className="space-y-1.5 text-xs">
                      {complianceRows.map((row) => {
                        const drift = row.actual - row.target;
                        const within = Math.abs(drift) <= 5;
                        return (
                          <div key={row.name} className="flex items-center justify-between">
                            <span>{row.name}</span>
                            <span className="text-slate-200">
                              target {row.target.toFixed(1)}% / actual {row.actual.toFixed(1)}%
                              <span className={`ml-2 ${within ? 'text-emerald-300' : 'text-rose-300'}`}>
                                ({drift >= 0 ? '+' : ''}{drift.toFixed(1)}%)
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Actual percentages use current marked notional over account total value.
                    </p>
                  </div>
                </div>
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

          <div className="space-y-5 self-start">
            <section className="card space-y-4">
              <div className="flex items-center gap-3 mb-2.5">
                <Activity className="text-teal-300" size={20} />
                <h3 className="text-xl font-bold">Broker</h3>
              </div>
              <div className="space-y-2">
                <select
                  value={selectedBroker}
                  onChange={(e) => setSelectedBroker(e.target.value as 'ibkr' | 'alpaca')}
                  className="input-modern"
                >
                  <option value="ibkr">IBKR Paper Trading</option>
                  <option value="alpaca">Alpaca Paper Trading</option>
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

                {brokerCapabilities && (
                  <div className="rounded-xl border border-slate-600/70 bg-slate-900/35 p-2.5 text-xs text-slate-300 space-y-1">
                    <p className="font-semibold text-slate-100">Broker Capabilities</p>
                    <p>
                      Equities: <span className={brokerCapabilities?.supports?.equities ? 'text-emerald-300' : 'text-rose-300'}>{brokerCapabilities?.supports?.equities ? 'Yes' : 'No'}</span>
                      {' | '}Forex: <span className={brokerCapabilities?.supports?.forex ? 'text-emerald-300' : 'text-rose-300'}>{brokerCapabilities?.supports?.forex ? 'Yes' : 'No'}</span>
                      {' | '}Crypto: <span className={brokerCapabilities?.supports?.crypto ? 'text-emerald-300' : 'text-rose-300'}>{brokerCapabilities?.supports?.crypto ? 'Yes' : 'No'}</span>
                    </p>
                    <p className="text-slate-400">{brokerCapabilities?.crypto?.reason || 'No crypto capability details available.'}</p>
                  </div>
                )}

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
                <h3 className="text-xl font-bold">Bot Power</h3>
              </div>

              <div className="mb-2 rounded-xl border border-slate-600/70 bg-slate-900/35 p-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">Bot Power</p>
                    <p className="text-xs text-slate-300">Toggle ON to start automatic live execution immediately</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-semibold shrink-0 ${executionMode === 'automatic' && botRunning ? 'text-slate-400' : 'text-teal-100'}`}>Off</span>
                    <button
                      onClick={handleBotPowerToggle}
                      role="switch"
                      aria-checked={executionMode === 'automatic' && botRunning}
                      disabled={botLoading || !backendOnline}
                      className={`relative h-8 w-16 shrink-0 rounded-full border transition-all duration-300 ease-out ${
                        executionMode === 'automatic' && botRunning
                          ? 'border-emerald-400/70 bg-emerald-500/30'
                          : 'border-slate-500/70 bg-slate-700/50'
                      } ${botLoading || !backendOnline ? 'opacity-70 cursor-not-allowed' : 'hover:brightness-110'}`}
                    >
                      <span
                        className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${
                          executionMode === 'automatic' && botRunning ? 'translate-x-8' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className={`text-xs font-semibold shrink-0 ${executionMode === 'automatic' && botRunning ? 'text-teal-100' : 'text-slate-400'}`}>On</span>
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

              <p className="text-xs text-slate-300 mt-1">
                Turning ON sets automatic mode and live paper execution together.
              </p>

              <div className="mt-2 text-xs text-slate-300 space-y-1 leading-snug">
                <p>Backend: <span className={backendOnline ? 'text-profit' : 'text-loss'}>{backendOnline ? 'Online' : 'Offline'}</span></p>
                <p>Power State: <span className="text-slate-100 uppercase">{executionMode === 'automatic' && botRunning ? 'ON' : 'OFF (manual data mode)'}</span></p>
                <p>Runner: <span className={botRunning ? 'text-profit' : 'text-loss'}>{botRunning ? 'Running' : 'Stopped'}</span></p>
                <p>Cycles: <span className="text-slate-100">{botCycleCount}</span></p>
                <p>Last Run: <span className="text-slate-100">{botLastRun ? new Date(botLastRun).toLocaleString() : 'N/A'}</span></p>
                <p>Heartbeat Age: <span className="text-slate-100">{getHeartbeatAge(botLastRun)}</span></p>
                {botLastError && <p>Last Error: <span className="text-loss">{botLastError}</span></p>}
              </div>

              {botStatusMessage && <p className="text-sm text-slate-100 mt-2">{botStatusMessage}</p>}
              <p className="text-xs text-slate-300 mt-2">Bot OFF keeps data and screening available. Bot ON runs automatic live-paper cycles.</p>
            </section>

            <section className="card space-y-4 border border-red-500/40 bg-gradient-to-br from-red-950/40 via-slate-900/60 to-slate-950/70">
              <div className="flex items-center gap-3 mb-1">
                <AlertTriangle className="text-red-300" size={20} />
                <h3 className="text-xl font-bold">24/7 Crypto (Advanced)</h3>
              </div>

              <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100 leading-relaxed">
                <p className="font-semibold uppercase tracking-wide text-red-200 text-xs mb-1">High Volatility Warning</p>
                <p>
                  Real crypto trading is for aggressive and advanced users only. Crypto can move violently at any hour, including while you are asleep,
                  and losses can compound quickly under automated execution.
                </p>
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wide text-slate-300 mb-2">Crypto Symbols (comma separated)</label>
                <input
                  type="text"
                  value={cryptoSymbolsInput}
                  onChange={(e) => setCryptoSymbolsInput(e.target.value)}
                  className="input-modern"
                  placeholder="BTC-USD, ETH-USD"
                />
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-slate-600/70 bg-slate-900/35 p-3 text-sm text-slate-100">
                <input
                  type="checkbox"
                  checked={cryptoRiskAck}
                  onChange={(e) => setCryptoRiskAck(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-red-400"
                />
                <span>I understand crypto is highly volatile and I can take rapid losses.</span>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-600/70 bg-slate-900/35 p-3 text-sm text-slate-100">
                <input
                  type="checkbox"
                  checked={cryptoAdvancedAck}
                  onChange={(e) => setCryptoAdvancedAck(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-red-400"
                />
                <span>I confirm I am an advanced user and I accept aggressive 24/7 automation risk.</span>
              </label>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setCryptoEnabled((prev) => !prev)}
                  className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    cryptoEnabled
                      ? 'bg-red-500/80 text-white hover:bg-red-500'
                      : 'bg-emerald-500/80 text-white hover:bg-emerald-500'
                  }`}
                >
                  {cryptoEnabled ? 'Disable 24/7 Crypto Mode' : 'Enable 24/7 Crypto Mode'}
                </button>
                <button onClick={handleCryptoSettingsSave} className="btn-primary w-full">Save Crypto Settings</button>
              </div>
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
