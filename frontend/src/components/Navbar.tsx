'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '@/store';
import { accountApi, botApi, brokerApi, statusApi } from '@/lib/api';
import { Wallet, TrendingUp, DollarSign, Activity, Bot } from 'lucide-react';

export default function Navbar() {
  const {
    account,
    setAccount,
    setSelectedBroker,
    selectedBroker,
    bumpRefreshToken,
  } = useTradingStore();
  const [brokerName, setBrokerName] = useState('IBKR');
  const [brokerConnected, setBrokerConnected] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);
  const [executionMode, setExecutionMode] = useState<'manual' | 'automatic'>('manual');
  const [botRunning, setBotRunning] = useState(false);
  const [botLastRun, setBotLastRun] = useState<string | null>(null);
  const [botLatestEvent, setBotLatestEvent] = useState('No activity yet');
  const [botLatestEventAt, setBotLatestEventAt] = useState<string | null>(null);
  const [forexGridStats, setForexGridStats] = useState({
    pairs_configured: 0,
    open_longs: 0,
    open_shorts: 0,
    open_total: 0,
    realized_pnl: 0,
    last_cycle: null as string | null,
  });
  const [botLoading, setBotLoading] = useState(false);
  const [switchingBroker, setSwitchingBroker] = useState(false);
  const [brokerSwitchError, setBrokerSwitchError] = useState('');

  const getHeartbeatAge = (iso: string | null) => {
    if (!iso) return 'N/A';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return '0s';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [healthRes, brokerRes, botRes, botLogRes] = await Promise.all([
          statusApi.getHealth(),
          statusApi.getBrokerStatus(),
          botApi.getStatus(),
          botApi.getLogs(1),
        ]);
        setBackendOnline(healthRes.data?.status === 'healthy');
        setBrokerName((brokerRes.data.broker || 'DEMO').toUpperCase());
        setBrokerConnected(Boolean(brokerRes.data.connected));
        const brokerLabel = String(brokerRes.data?.broker || 'demo').toLowerCase();
        const normalized = brokerLabel.includes('ibkr') ? 'ibkr' : brokerLabel.includes('alpaca') ? 'alpaca' : 'demo';
        setSelectedBroker(normalized);
        setExecutionMode((botRes.data.execution_mode || 'manual') as 'manual' | 'automatic');
        setBotRunning(Boolean(botRes.data.bot_running));
        setBotLastRun(botRes.data.bot_last_run || null);
        setForexGridStats({
          pairs_configured: Number(botRes.data?.forex_grid?.pairs_configured ?? 0),
          open_longs: Number(botRes.data?.forex_grid?.open_longs ?? 0),
          open_shorts: Number(botRes.data?.forex_grid?.open_shorts ?? 0),
          open_total: Number(botRes.data?.forex_grid?.open_total ?? 0),
          realized_pnl: Number(botRes.data?.forex_grid?.realized_pnl ?? 0),
          last_cycle: botRes.data?.forex_grid?.last_cycle ?? null,
        });
        const latest = (botLogRes.data?.logs || [])[0];
        if (latest?.event) {
          setBotLatestEvent(String(latest.event));
          setBotLatestEventAt(latest.timestamp || null);
        }
      } catch {
        setBackendOnline(false);
        setBrokerName('DEMO');
        setBrokerConnected(false);
        setExecutionMode('manual');
        setBotRunning(false);
        setBotLastRun(null);
        setForexGridStats({
          pairs_configured: 0,
          open_longs: 0,
          open_shorts: 0,
          open_total: 0,
          realized_pnl: 0,
          last_cycle: null,
        });
        setBotLatestEvent('Bot activity unavailable');
        setBotLatestEventAt(null);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [setSelectedBroker]);

  const handleDataSourceSwitch = async (target: 'demo' | 'ibkr' | 'alpaca') => {
    if (!backendOnline) {
      setBrokerSwitchError('Backend API is offline. Start backend first.');
      return;
    }

    setSwitchingBroker(true);
    setBrokerSwitchError('');

    try {
      const switchRes = await brokerApi.switch(target, {});

      const [accountRes, brokerRes] = await Promise.all([
        accountApi.getSnapshot(),
        statusApi.getBrokerStatus(),
      ]);

      setAccount(accountRes.data);
      setBrokerName((brokerRes.data.broker || target).toUpperCase());
      setBrokerConnected(Boolean(brokerRes.data.connected));
      setSelectedBroker(target);
      if (target === 'ibkr' && switchRes?.data?.config) {
        const cfg = switchRes.data.config;
        setBrokerSwitchError(
          `IBKR connected via ${cfg.host}:${cfg.port} (client ${cfg.client_id})`
        );
      }
      bumpRefreshToken();
    } catch (error: any) {
      const message = error?.response?.data?.error || `Failed to switch to ${target.toUpperCase()}`;
      setBrokerSwitchError(message);
    } finally {
      setSwitchingBroker(false);
    }
  };

  const handleNavQuickModeSwitch = async (mode: 'manual' | 'automatic') => {
    if (!backendOnline) {
      return;
    }

    setBotLoading(true);
    try {
      const autoStart = mode === 'automatic';
      const response = await botApi.setMode(mode, autoStart, 60);
      const statusRes = await botApi.getStatus();
      setExecutionMode((statusRes.data.execution_mode || mode) as 'manual' | 'automatic');
      setBotRunning(Boolean(statusRes.data.bot_running));
      setBotLastRun(statusRes.data.bot_last_run || null);
    } catch {
      // Keep navbar interaction lightweight; status polling will reconcile state.
    } finally {
      setBotLoading(false);
    }
  };

  const handleNavToggle = () => {
    const nextMode = executionMode === 'manual' ? 'automatic' : 'manual';
    void handleNavQuickModeSwitch(nextMode);
  };

  if (!account) return null;

  const pnlColor = account.total_pnl >= 0 ? 'text-profit' : 'text-loss';
  const todayColor = account.daily_pnl >= 0 ? 'text-profit' : 'text-loss';
  const accountCurrency = String(account.currency || 'USD').toUpperCase();
  const currencyPrefix = accountCurrency === 'HKD' ? 'HK$' : '$';
  const activityText = String(botLatestEvent || '').toLowerCase();
  const isScanningEvent = activityText.includes('scanning');
  const isOpportunityEvent = activityText.includes('opportunity') || activityText.includes('submitted');
  const isErrorEvent = activityText.includes('failed') || activityText.includes('error');
  const activityContainerClass = isErrorEvent
    ? 'border-rose-600/70 bg-rose-900/25'
    : isScanningEvent
      ? 'border-teal-400/70 bg-teal-900/25'
      : isOpportunityEvent
        ? 'border-emerald-500/70 bg-emerald-900/20'
        : 'border-slate-600/70 bg-slate-900/45';
  const activityTextClass = isErrorEvent
    ? 'text-rose-200'
    : isScanningEvent
      ? 'text-teal-100'
      : isOpportunityEvent
        ? 'text-emerald-200'
        : 'text-slate-100';
  const gridPnlClass = forexGridStats.realized_pnl >= 0 ? 'text-profit' : 'text-loss';

  return (
    <nav className="sticky top-0 z-20 border-b border-slate-700/50 bg-[#0a1c25]/75 backdrop-blur-md">
      <div className="app-shell py-3 md:py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-teal-400/20 p-2 text-teal-200">
                <TrendingUp size={22} />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight">IERG4340 Trading Bot</h1>
                <p className="hidden sm:block text-sm text-slate-300">Multi-strategy paper trading dashboard</p>
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold border ${
                brokerConnected
                  ? 'text-emerald-200 bg-emerald-900/40 border-emerald-700/60'
                  : 'text-amber-200 bg-amber-900/40 border-amber-700/60'
              }`}
            >
              <Activity size={12} />
              {brokerName} {brokerConnected ? 'Connected' : 'Disconnected'}
            </span>

            <div className="flex flex-wrap gap-2">
              {[
                { id: 'demo', label: 'Demo' },
                { id: 'ibkr', label: 'IBKR' },
                { id: 'alpaca', label: 'Alpaca' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleDataSourceSwitch(item.id as 'demo' | 'ibkr' | 'alpaca')}
                  disabled={switchingBroker || !backendOnline}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    selectedBroker === item.id
                      ? 'border-teal-300 bg-teal-900/25 text-teal-100'
                      : 'border-slate-600/70 bg-slate-900/45 text-slate-300 hover:border-slate-400'
                  } ${switchingBroker || !backendOnline ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {brokerSwitchError && (
              <p className="text-xs text-loss font-semibold">{brokerSwitchError}</p>
            )}

            <div className="inline-flex items-center gap-2 rounded-full border border-slate-600/70 bg-slate-900/45 px-2 py-1">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300 px-1">
                <Bot size={12} /> Bot
              </span>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] font-semibold ${executionMode === 'manual' ? 'text-teal-100' : 'text-slate-400'}`}>
                  M
                </span>
                <button
                  onClick={handleNavToggle}
                  role="switch"
                  aria-checked={executionMode === 'automatic'}
                  disabled={botLoading || !backendOnline}
                  className={`relative h-6 w-11 shrink-0 rounded-full border transition-all duration-300 ease-out ${
                    executionMode === 'automatic'
                      ? 'border-emerald-400/70 bg-emerald-500/30'
                      : 'border-slate-500/70 bg-slate-700/50'
                  } ${botLoading || !backendOnline ? 'opacity-70 cursor-not-allowed' : 'hover:brightness-110'}`}
                >
                  <span
                    className={`absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${
                      executionMode === 'automatic' ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span className={`text-[10px] font-semibold ${executionMode === 'automatic' ? 'text-teal-100' : 'text-slate-400'}`}>
                  A
                </span>
              </div>
              <span className={`text-[11px] font-semibold ${botRunning ? 'text-profit' : 'text-loss'}`}>
                {botRunning ? 'Running' : 'Stopped'}
              </span>
              <span className={`text-[11px] font-semibold ${backendOnline ? 'text-slate-300' : 'text-loss'}`}>
                {backendOnline ? `Heartbeat ${getHeartbeatAge(botLastRun)} ago` : 'API Offline'}
              </span>
            </div>

            <div className={`max-w-full rounded-xl border px-3 py-2 transition-colors ${activityContainerClass}`}>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Bot Activity</p>
              <p className={`text-xs font-semibold truncate ${activityTextClass} ${isScanningEvent && botRunning ? 'animate-pulse' : ''}`}>
                {botRunning ? 'Running: ' : 'Stopped: '}
                {botLatestEvent}
              </p>
              <p className="text-[11px] text-slate-400">
                {botLatestEventAt ? `${getHeartbeatAge(botLatestEventAt)} ago` : 'Waiting for next event'}
                {' | '}
                Live Orders
              </p>
            </div>

            <div className="max-w-full rounded-xl border border-cyan-700/50 bg-cyan-900/15 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Forex Grid</p>
              <p className="text-xs font-semibold text-cyan-100 truncate">
                Open legs {forexGridStats.open_total} (L {forexGridStats.open_longs} / S {forexGridStats.open_shorts})
              </p>
              <p className="text-[11px] text-slate-300">
                Realized: <span className={gridPnlClass}>{forexGridStats.realized_pnl >= 0 ? '+' : ''}{forexGridStats.realized_pnl.toFixed(2)}</span>
                {' | '}
                Pairs: {forexGridStats.pairs_configured}
                {' | '}
                Last cycle {getHeartbeatAge(forexGridStats.last_cycle)} ago
              </p>
            </div>
          </div>

          <div className="scroll-row md:grid md:grid-cols-3 md:gap-3 w-full lg:w-auto">
            <div className="rounded-xl border border-slate-600/50 bg-slate-900/35 px-4 py-3 min-w-[180px] md:min-w-0 shrink-0">
              <div className="flex items-center gap-2 text-slate-300 text-xs uppercase tracking-wide mb-1">
                <DollarSign size={14} /> Total Value
              </div>
              <div>
                <p className="metric-value">{currencyPrefix}{Number(account.total_value || 0).toLocaleString()}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-600/50 bg-slate-900/35 px-4 py-3 min-w-[220px] md:min-w-0 shrink-0">
              <div className="flex items-center gap-2 text-slate-300 text-xs uppercase tracking-wide mb-1">
                <TrendingUp size={14} className={pnlColor} /> Total P&L
              </div>
              <div>
                <p className={`metric-value ${pnlColor}`}>
                  {currencyPrefix}{Number(account.total_pnl || 0).toLocaleString()} ({Number(account.total_pnl_pct || 0).toFixed(2)}%)
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-600/50 bg-slate-900/35 px-4 py-3 min-w-[180px] md:min-w-0 shrink-0">
              <div className="flex items-center gap-2 text-slate-300 text-xs uppercase tracking-wide mb-1">
                <Wallet size={14} /> Today
              </div>
              <div>
                <p className={`metric-value ${todayColor}`}>
                  {currencyPrefix}{Number(account.daily_pnl || 0).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
