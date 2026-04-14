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
    setActiveTab,
    setForexAuditFocus,
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
  const [healthCounters, setHealthCounters] = useState<any>(null);
  const [forexGridStats, setForexGridStats] = useState({
    pairs_configured: 0,
    open_longs: 0,
    open_shorts: 0,
    open_total: 0,
    realized_pnl: 0,
    last_cycle: null as string | null,
  });
  const [strategyAudit, setStrategyAudit] = useState<any>({});
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
        const healthRes = await statusApi.getHealth();
        const healthy = healthRes.data?.status === 'healthy';
        setBackendOnline(healthy);

        if (!healthy) {
          setBrokerName('IBKR');
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
          setStrategyAudit({});
          setBotLatestEvent('Backend offline');
          setBotLatestEventAt(null);
          return;
        }

        const [brokerRes, botRes, botLogRes] = await Promise.all([
          statusApi.getBrokerStatus(),
          botApi.getStatus(),
          botApi.getLogs(1),
        ]);
        const countersRes = await statusApi.getHealthCounters().catch(() => null);

        setBrokerName((brokerRes.data.broker || 'IBKR').toUpperCase());
        setBrokerConnected(Boolean(brokerRes.data.connected));
        const brokerLabel = String(brokerRes.data?.broker || 'ibkr').toLowerCase();
        const normalized = brokerLabel.includes('alpaca') ? 'alpaca' : 'ibkr';
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
        setStrategyAudit(botRes.data?.strategy_audit || {});
        const latest = (botLogRes.data?.logs || [])[0];
        if (latest?.event) {
          setBotLatestEvent(String(latest.event));
          setBotLatestEventAt(latest.timestamp || null);
        }
        setHealthCounters(countersRes?.data || null);
      } catch {
        setBackendOnline(false);
        setBrokerName('IBKR');
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
        setStrategyAudit({});
        setBotLatestEvent('Bot activity unavailable');
        setBotLatestEventAt(null);
        setHealthCounters(null);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [setSelectedBroker]);

  const handleDataSourceSwitch = async (target: 'ibkr' | 'alpaca') => {
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
      if (mode === 'automatic') {
        await botApi.setExecutionSafety(false);
      }

      await botApi.setMode(mode, mode === 'automatic', 60);
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
  const realizedColor = Number(account.realized_pnl || 0) >= 0 ? 'text-profit' : 'text-loss';
  const unrealizedColor = Number(account.unrealized_pnl || 0) >= 0 ? 'text-profit' : 'text-loss';
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
  const healthSummary = healthCounters?.summary || {};
  const totalRequests = Number(healthSummary.total_requests ?? 0);
  const totalErrors = Number(healthSummary.total_errors ?? 0);
  const avgLatencyMs = Number(healthSummary.avg_latency_ms ?? 0);
  const maxLatencyMs = Number(healthSummary.max_latency_ms ?? 0);
  const healthBadgeClass = totalErrors > 0
    ? 'border-amber-500/60 bg-amber-900/25 text-amber-100'
    : 'border-emerald-500/60 bg-emerald-900/25 text-emerald-100';
  const blowupExecution = String(strategyAudit?.blowup?.execution || 'idle').toLowerCase();
  const coveredCallExecution = String(strategyAudit?.covered_call?.execution || 'idle').toLowerCase();
  const forexExecution = String(strategyAudit?.forex_grid?.execution || 'idle').toLowerCase();
  const forexHealthy = ['simulated', 'live_paper'].includes(forexExecution);
  const hasEquityFailure = blowupExecution === 'failed' || coveredCallExecution === 'failed';
  const engineState: 'healthy' | 'attention' | 'paused' | 'offline' = !backendOnline
    ? 'offline'
    : !botRunning || executionMode !== 'automatic'
      ? 'paused'
      : forexHealthy && !hasEquityFailure
        ? 'healthy'
        : 'attention';
  const engineBadgeClass = engineState === 'healthy'
    ? 'border-emerald-500/60 bg-emerald-900/25 text-emerald-100'
    : engineState === 'paused'
      ? 'border-amber-500/60 bg-amber-900/25 text-amber-100'
      : engineState === 'offline'
        ? 'border-rose-500/60 bg-rose-900/25 text-rose-100'
        : 'border-orange-500/60 bg-orange-900/25 text-orange-100';
  const engineLabel = engineState === 'healthy'
    ? 'Strategy Engine Healthy'
    : engineState === 'paused'
      ? 'Strategy Engine Paused'
      : engineState === 'offline'
        ? 'Backend Offline'
        : 'Strategy Engine Needs Attention';
  const engineReason = engineState === 'offline'
    ? 'Backend offline'
    : engineState === 'paused'
      ? 'Run bot in automatic mode to execute sleeves'
      : `Blowup ${blowupExecution} | Covered call ${coveredCallExecution} | Forex ${forexExecution}`;
  const focusSleeve: 'all' | 'blowup' | 'covered_call' | 'forex_grid' = !backendOnline || !botRunning || executionMode !== 'automatic'
    ? 'all'
    : !['simulated', 'live_paper'].includes(forexExecution)
      ? 'forex_grid'
      : !['simulated', 'submitted'].includes(blowupExecution)
        ? 'blowup'
        : !['simulated', 'submitted'].includes(coveredCallExecution)
          ? 'covered_call'
          : 'all';

  const handleJumpToEngineIssue = () => {
    setActiveTab('forex');
    setForexAuditFocus(focusSleeve);
  };

  const accountDataSource = String(account?.data_source || '').toLowerCase();
  const snapshotTimestamp = account?.snapshot_timestamp || null;
  const usingFallbackData =
    accountDataSource.includes('snapshot') ||
    accountDataSource.includes('fallback') ||
    accountDataSource.includes('degraded');
  const fallbackChipClass = accountDataSource.includes('degraded')
    ? 'border-amber-500/60 bg-amber-900/25 text-amber-100'
    : 'border-cyan-500/60 bg-cyan-900/25 text-cyan-100';
  const fallbackLabel = accountDataSource.includes('degraded')
    ? 'Degraded fallback data'
    : 'Snapshot fallback data';

  return (
    <nav className="sticky top-0 z-20 border-b border-slate-700/50 bg-[#0a1c25]/80 backdrop-blur-md">
      <div className="app-shell py-2">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="rounded-lg bg-teal-400/20 p-1.5 text-teal-200">
                <TrendingUp size={16} />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-bold tracking-tight truncate">IERG4340 Trading Bot</h1>
                <p className="hidden md:block text-[11px] text-slate-300 truncate">Multi-strategy paper trading dashboard</p>
              </div>
            </div>

            <div className="scroll-row gap-2 w-full xl:w-auto">
              <div className="rounded-lg border border-slate-600/50 bg-slate-900/35 px-3 py-1.5 min-w-[160px]">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Total Value</p>
                <p className="text-lg font-semibold">{currencyPrefix}{Number(account.total_value || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-slate-600/50 bg-slate-900/35 px-3 py-1.5 min-w-[200px]">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Total P&L</p>
                <p className={`text-lg font-semibold ${pnlColor}`}>
                  {currencyPrefix}{Number(account.total_pnl || 0).toLocaleString()} ({Number(account.total_pnl_pct || 0).toFixed(2)}%)
                </p>
              </div>
              <div className="rounded-lg border border-slate-600/50 bg-slate-900/35 px-3 py-1.5 min-w-[190px]">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Realized P&L</p>
                <p className={`text-lg font-semibold ${realizedColor}`}>
                  {currencyPrefix}{Number(account.realized_pnl || 0).toLocaleString()} ({Number(account.realized_pnl_pct || 0).toFixed(2)}%)
                </p>
              </div>
              <div className="rounded-lg border border-slate-600/50 bg-slate-900/35 px-3 py-1.5 min-w-[200px]">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Unrealized P&L</p>
                <p className={`text-lg font-semibold ${unrealizedColor}`}>
                  {currencyPrefix}{Number(account.unrealized_pnl || 0).toLocaleString()} ({Number(account.unrealized_pnl_pct || 0).toFixed(2)}%)
                </p>
              </div>
            </div>
          </div>

          <div className="scroll-row gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold border ${
                brokerConnected
                  ? 'text-emerald-200 bg-emerald-900/40 border-emerald-700/60'
                  : 'text-amber-200 bg-amber-900/40 border-amber-700/60'
              }`}
            >
              <Activity size={12} />
              {brokerName} {brokerConnected ? 'Connected' : 'Disconnected'}
            </span>

            {usingFallbackData && (
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${fallbackChipClass}`}>
                {fallbackLabel}
                <span className="ml-2 text-slate-200/90">{snapshotTimestamp ? `${getHeartbeatAge(snapshotTimestamp)} ago` : 'timestamp unavailable'}</span>
              </span>
            )}

            {[
              { id: 'ibkr', label: 'IBKR' },
              { id: 'alpaca', label: 'Alpaca' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => handleDataSourceSwitch(item.id as 'ibkr' | 'alpaca')}
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

            <div className="inline-flex items-center gap-2 rounded-full border border-slate-600/70 bg-slate-900/45 px-2 py-1">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300 px-1">
                  <Bot size={12} /> Bot Power
              </span>
              <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-semibold ${executionMode === 'automatic' && botRunning ? 'text-slate-400' : 'text-teal-100'}`}>Off</span>
                <button
                  onClick={handleNavToggle}
                  role="switch"
                    aria-checked={executionMode === 'automatic' && botRunning}
                  disabled={botLoading || !backendOnline}
                  className={`relative h-5 w-10 shrink-0 rounded-full border transition-all duration-300 ease-out ${
                      executionMode === 'automatic' && botRunning
                      ? 'border-emerald-400/70 bg-emerald-500/30'
                      : 'border-slate-500/70 bg-slate-700/50'
                  } ${botLoading || !backendOnline ? 'opacity-70 cursor-not-allowed' : 'hover:brightness-110'}`}
                >
                  <span
                    className={`absolute left-[2px] top-[2px] h-3 w-3 rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${
                        executionMode === 'automatic' && botRunning ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                  <span className={`text-[10px] font-semibold ${executionMode === 'automatic' && botRunning ? 'text-teal-100' : 'text-slate-400'}`}>On</span>
              </div>
              <span className={`text-[11px] font-semibold ${botRunning ? 'text-profit' : 'text-loss'}`}>
                {botRunning ? 'Running' : 'Stopped'}
              </span>
            </div>

            <button
              onClick={handleJumpToEngineIssue}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${engineBadgeClass}`}
              title={engineReason}
            >
              {engineLabel}
            </button>

            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${healthBadgeClass}`} title={healthSummary.total_requests ? `Max latency ${maxLatencyMs.toFixed(1)}ms` : 'Health counters unavailable yet'}>
              Ops {totalRequests} req / {totalErrors} err / {avgLatencyMs.toFixed(1)}ms avg
            </span>

            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${activityContainerClass}`}>
              <span className={`font-semibold ${activityTextClass}`}>{botLatestEvent}</span>
              <span className="text-slate-300">{botLatestEventAt ? `${getHeartbeatAge(botLatestEventAt)} ago` : 'Waiting'}</span>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-700/50 bg-cyan-900/15 px-3 py-1 text-xs text-cyan-100">
              <span>Grid {forexGridStats.open_total} legs</span>
              <span className={gridPnlClass}>{forexGridStats.realized_pnl >= 0 ? '+' : ''}{forexGridStats.realized_pnl.toFixed(2)}</span>
              <span className="text-slate-300">{getHeartbeatAge(forexGridStats.last_cycle)} ago</span>
            </div>

            <span className="inline-flex items-center rounded-full border border-slate-600/70 bg-slate-900/45 px-3 py-1 text-xs text-slate-300">
              Max {maxLatencyMs.toFixed(1)}ms | Health {totalErrors === 0 ? 'clean' : 'watch'}
            </span>

            {backendOnline && (
              <span className="inline-flex items-center rounded-full border border-slate-600/70 bg-slate-900/45 px-3 py-1 text-xs text-slate-300">
                Heartbeat {getHeartbeatAge(botLastRun)} ago
              </span>
            )}
          </div>

          {brokerSwitchError && <p className="text-xs text-loss font-semibold">{brokerSwitchError}</p>}
        </div>
      </div>
    </nav>
  );
}
