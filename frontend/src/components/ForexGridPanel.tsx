'use client';

import { useEffect, useMemo, useState } from 'react';
import { botApi, configApi, statusApi, tradingApi } from '@/lib/api';
import { Activity, RefreshCw, Timer, TrendingUp } from 'lucide-react';

type ForexPairState = {
  pair: string;
  anchor: number | null;
  last_price: number | null;
  open_longs: number;
  open_shorts: number;
  realized_pnl: number;
  next_long_trigger: number | null;
  next_short_trigger: number | null;
  last_updated: string | null;
};

export default function ForexGridPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [botStatus, setBotStatus] = useState<any>(null);
  const [pairStates, setPairStates] = useState<ForexPairState[]>([]);
  const [forexTrades, setForexTrades] = useState<any[]>([]);
  const [forexTickEvents, setForexTickEvents] = useState<any[]>([]);
  const [tickSeconds, setTickSeconds] = useState(1);
  const [saveMessage, setSaveMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);

  const getAge = (iso: string | null | undefined) => {
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

  const loadData = async () => {
    try {
      const healthRes = await statusApi.getHealth();
      if (healthRes.data?.status !== 'healthy') {
        setError('Backend API is offline. Forex Desk will retry automatically when healthy.');
        setLoading(false);
        return;
      }

      const [botRes, logsRes, configRes, botLogsRes] = await Promise.all([
        botApi.getStatus(),
        tradingApi.getLogs({ days: 2, assetType: 'forex', status: 'all' }),
        configApi.getCurrent(),
        botApi.getLogs(120),
      ]);

      const nextStatus = botRes.data || {};
      setBotStatus(nextStatus);
      setPairStates((nextStatus.forex_grid?.pairs || []) as ForexPairState[]);

      const records = (logsRes.data?.logs || []) as any[];
      setForexTrades(
        records
          .filter((r) => String(r.asset_type || '').toLowerCase() === 'forex' || String(r.strategy || '').toLowerCase().includes('forex'))
          .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
          .slice(0, 20)
      );

      const rawBotLogs = (botLogsRes.data?.logs || []) as any[];
      const tickEvents = rawBotLogs
        .filter((row) => {
          const event = String(row?.event || '').toLowerCase();
          if (!event.includes('forex') && !event.includes('grid')) return false;
          const opened = Number(row?.details?.opened || 0);
          const closed = Number(row?.details?.closed || 0);
          return opened > 0 || closed > 0;
        })
        .map((row) => ({
          timestamp: row.timestamp,
          opened: Number(row?.details?.opened || 0),
          closed: Number(row?.details?.closed || 0),
          realized_pnl: Number(row?.details?.realized_pnl || 0),
          allocation_pct: Number(row?.details?.allocation_pct || 0),
          source_event: String(row?.event || 'Forex grid tick executed'),
        }))
        .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
        .slice(0, 20);
      setForexTickEvents(tickEvents);

      const cfgTick = Number(configRes.data?.forex?.tick_seconds ?? 1);
      setTickSeconds(Math.max(1, Math.min(5, Number.isFinite(cfgTick) ? cfgTick : 1)));
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to load forex grid data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    const interval = setInterval(() => {
      void loadData();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveTickSpeed = async () => {
    setSaving(true);
    setSaveMessage('');
    try {
      const cfgRes = await configApi.getCurrent();
      const currentConfig = cfgRes.data || {};
      const nextConfig = {
        ...currentConfig,
        forex: {
          ...(currentConfig.forex || {}),
          tick_seconds: Math.max(1, Math.min(5, tickSeconds)),
        },
      };
      await configApi.update(nextConfig);
      setSaveMessage('Forex grid tick speed saved. Restart bot to apply immediately.');
    } catch (e: any) {
      setSaveMessage(e?.response?.data?.error || 'Failed to save tick speed');
    } finally {
      setSaving(false);
    }
  };

  const startAutoGrid = async () => {
    setModeBusy(true);
    setSaveMessage('');
    try {
      await botApi.setExecutionSafety(false);
      await botApi.setMode('automatic', true, 60);
      setSaveMessage('Automatic live paper mode started. Forex grid is now executing immediately.');
      await loadData();
    } catch (e: any) {
      setSaveMessage(e?.response?.data?.error || 'Failed to start automatic mode');
    } finally {
      setModeBusy(false);
    }
  };

  const stopBot = async () => {
    setModeBusy(true);
    setSaveMessage('');
    try {
      await botApi.stop();
      await botApi.setMode('manual', false, 60);
      setSaveMessage('Bot stopped and switched to manual mode.');
      await loadData();
    } catch (e: any) {
      setSaveMessage(e?.response?.data?.error || 'Failed to stop bot');
    } finally {
      setModeBusy(false);
    }
  };

  const totals = useMemo(() => {
    const openLongs = pairStates.reduce((sum, p) => sum + Number(p.open_longs || 0), 0);
    const openShorts = pairStates.reduce((sum, p) => sum + Number(p.open_shorts || 0), 0);
    const realized = pairStates.reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0);
    return {
      openLongs,
      openShorts,
      openTotal: openLongs + openShorts,
      realized,
    };
  }, [pairStates]);

  if (loading) {
    return <div className="p-4 text-sm text-slate-300">Loading Forex Desk...</div>;
  }

  const grid = botStatus?.forex_grid || {};
  const audit = botStatus?.strategy_audit || {};
  const pnlClass = totals.realized >= 0 ? 'text-emerald-300' : 'text-rose-300';
  const forexExecution = String(audit?.forex_grid?.execution || 'idle').toLowerCase();
  const liveExecutionActive = Boolean(botStatus?.bot_running) && String(botStatus?.execution_mode || 'manual') === 'automatic' && !Boolean(botStatus?.dry_run);
  const diagnosis = !botStatus?.bot_running
    ? 'Bot runner is stopped. Turn Bot Power ON.'
    : String(botStatus?.execution_mode || 'manual') !== 'automatic'
      ? 'Bot is in manual mode. Turn Bot Power ON for auto execution.'
      : Boolean(botStatus?.dry_run)
        ? 'Bot is running in simulated safety mode. Disable dry-run for live paper execution.'
        : totals.openTotal > 0 && forexTrades.length === 0
          ? 'Auto trading is working. Open legs are active and waiting for take-profit close conditions.'
          : Number(audit?.forex_grid?.opened || 0) === 0 && Number(audit?.forex_grid?.closed || 0) === 0
            ? 'Auto trading is working. No new entry/exit trigger was hit on the latest tick.'
            : 'Auto trading is actively executing forex grid logic.';

  return (
    <div className="space-y-5 p-4">
      <div className="rounded-2xl border border-cyan-700/50 bg-cyan-950/20 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-cyan-100">Forex Desk</h2>
            <p className="text-sm text-slate-300 mt-1">
              Dedicated live view for grid trading state, pair triggers, and recent forex executions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void startAutoGrid()}
              disabled={modeBusy}
              className="rounded-lg border border-emerald-500/70 bg-emerald-900/25 px-3 py-2 text-xs font-semibold text-emerald-100 hover:border-emerald-300 disabled:opacity-60"
            >
              Start Auto Grid
            </button>
            <button
              onClick={() => void stopBot()}
              disabled={modeBusy}
              className="rounded-lg border border-amber-500/70 bg-amber-900/25 px-3 py-2 text-xs font-semibold text-amber-100 hover:border-amber-300 disabled:opacity-60"
            >
              Stop Bot
            </button>
            <button
              onClick={() => void loadData()}
              className="rounded-lg border border-slate-600/70 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-400"
            >
              <span className="inline-flex items-center gap-2"><RefreshCw size={14} /> Refresh</span>
            </button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Grid Tick</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{grid.tick_seconds ?? 1}s</p>
          <p className="text-xs text-slate-400">Last tick {getAge(grid.last_tick)} ago</p>
        </div>
        <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Open Legs</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{totals.openTotal} (L {totals.openLongs} / S {totals.openShorts})</p>
          <p className="text-xs text-slate-400">Across {grid.pairs_configured ?? 0} pairs</p>
        </div>
        <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Realized P&L</p>
          <p className={`mt-1 text-lg font-semibold ${pnlClass}`}>{totals.realized >= 0 ? '+' : ''}{totals.realized.toFixed(2)}</p>
          <p className="text-xs text-slate-400">Grid cycle {getAge(grid.last_cycle)} ago</p>
        </div>
        <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Bot</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{botStatus?.bot_running ? 'Running' : 'Stopped'}</p>
          <p className="text-xs text-slate-400">
            Mode {String(botStatus?.execution_mode || 'manual')} | Full cycle {grid.full_cycle_seconds ?? 60}s
          </p>
        </div>
      </div>

      <div className={`rounded-2xl border p-4 ${liveExecutionActive ? 'border-emerald-700/40 bg-emerald-950/10' : 'border-amber-700/40 bg-amber-950/10'}`}>
        <p className="text-sm font-semibold text-slate-100">Execution Diagnosis</p>
        <p className="mt-1 text-sm text-slate-200">{diagnosis}</p>
        <p className="mt-2 text-xs text-slate-400">
          Forex execution: {forexExecution || 'idle'} | Last tick {getAge(audit?.forex_grid?.last_tick)} ago | Opened {Number(audit?.forex_grid?.opened || 0)} / Closed {Number(audit?.forex_grid?.closed || 0)} this tick
        </p>
      </div>

      <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-100">Grid Tick Speed</p>
            <p className="text-xs text-slate-400">Use 1 second for high-frequency scalping behavior.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-300">Seconds</label>
            <input
              type="number"
              min={1}
              max={5}
              value={tickSeconds}
              onChange={(e) => setTickSeconds(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
              className="input-modern w-24"
            />
            <button
              onClick={() => void handleSaveTickSpeed()}
              disabled={saving}
              className="rounded-lg border border-cyan-500/60 bg-cyan-900/30 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-300 disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2"><Timer size={14} /> {saving ? 'Saving...' : 'Save Speed'}</span>
            </button>
          </div>
        </div>
        {saveMessage && <p className="mt-2 text-xs text-slate-300">{saveMessage}</p>}
      </div>

      <div className="rounded-2xl border border-emerald-700/40 bg-emerald-950/10 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-100">Forex Execution Audit</p>
        </div>
        <div className="grid gap-3 md:grid-cols-1">
          <div className="rounded-xl border border-slate-700/70 bg-slate-900/35 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Forex Grid</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{String(audit?.forex_grid?.execution || 'idle')}</p>
            <p className="text-xs text-slate-300">{String(audit?.forex_grid?.message || 'No data')}</p>
            <p className="text-xs text-slate-400 mt-1">Last tick {getAge(audit?.forex_grid?.last_tick)} ago</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
        <p className="text-sm font-semibold text-slate-100 mb-3 inline-flex items-center gap-2">
          <Activity size={14} /> Pair-by-Pair Grid State
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-300">
                <th className="py-2 pr-3">Pair</th>
                <th className="py-2 pr-3">Spot</th>
                <th className="py-2 pr-3">Anchor</th>
                <th className="py-2 pr-3">Open L</th>
                <th className="py-2 pr-3">Open S</th>
                <th className="py-2 pr-3">Next Long Trigger</th>
                <th className="py-2 pr-3">Next Short Trigger</th>
                <th className="py-2 pr-3">Realized</th>
                <th className="py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {pairStates.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 text-slate-400">No active pair state yet. Start automatic bot mode to build grid state.</td>
                </tr>
              )}
              {pairStates.map((pair) => (
                <tr key={pair.pair} className="border-b border-slate-800/70 text-slate-200">
                  <td className="py-2 pr-3 font-semibold text-cyan-100">{pair.pair}</td>
                  <td className="py-2 pr-3">{pair.last_price ? Number(pair.last_price).toFixed(5) : '-'}</td>
                  <td className="py-2 pr-3">{pair.anchor ? Number(pair.anchor).toFixed(5) : '-'}</td>
                  <td className="py-2 pr-3">{pair.open_longs}</td>
                  <td className="py-2 pr-3">{pair.open_shorts}</td>
                  <td className="py-2 pr-3">{pair.next_long_trigger ? Number(pair.next_long_trigger).toFixed(5) : '-'}</td>
                  <td className="py-2 pr-3">{pair.next_short_trigger ? Number(pair.next_short_trigger).toFixed(5) : '-'}</td>
                  <td className={`py-2 pr-3 ${Number(pair.realized_pnl || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {Number(pair.realized_pnl || 0) >= 0 ? '+' : ''}{Number(pair.realized_pnl || 0).toFixed(2)}
                  </td>
                  <td className="py-2 text-slate-400">{getAge(pair.last_updated)} ago</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
        <p className="text-sm font-semibold text-slate-100 mb-3 inline-flex items-center gap-2">
          <Activity size={14} /> Recent Grid Tick Events (Immediate)
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-300">
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Opened</th>
                <th className="py-2 pr-3">Closed</th>
                <th className="py-2 pr-3">Realized P&L</th>
                <th className="py-2 pr-3">Alloc %</th>
                <th className="py-2">Event</th>
              </tr>
            </thead>
            <tbody>
              {forexTickEvents.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-slate-400">
                    No open/close tick events yet in this session. New leg openings and closes will appear here instantly.
                  </td>
                </tr>
              )}
              {forexTickEvents.map((event, idx) => (
                <tr key={`${event.timestamp}-${idx}`} className="border-b border-slate-800/70 text-slate-200">
                  <td className="py-2 pr-3 text-slate-300">{new Date(event.timestamp || Date.now()).toLocaleString()}</td>
                  <td className="py-2 pr-3 text-emerald-300">{event.opened}</td>
                  <td className="py-2 pr-3 text-cyan-300">{event.closed}</td>
                  <td className={`py-2 pr-3 ${event.realized_pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {event.realized_pnl >= 0 ? '+' : ''}{event.realized_pnl.toFixed(2)}
                  </td>
                  <td className="py-2 pr-3">{event.allocation_pct.toFixed(1)}</td>
                  <td className="py-2 text-slate-300">{event.source_event}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
        <p className="text-sm font-semibold text-slate-100 mb-3 inline-flex items-center gap-2">
          <TrendingUp size={14} /> Recent Forex Trades
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-300">
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Strategy</th>
                <th className="py-2 pr-3">Pair</th>
                <th className="py-2 pr-3">Side</th>
                <th className="py-2 pr-3">Qty</th>
                <th className="py-2 pr-3">Entry</th>
                <th className="py-2 pr-3">Exit</th>
                <th className="py-2">Net P&L</th>
              </tr>
            </thead>
            <tbody>
              {forexTrades.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-slate-400">
                    No closed forex trades yet. Grid is still active with {totals.openTotal} open legs and will print rows here when take-profit closes occur.
                  </td>
                </tr>
              )}
              {forexTrades.map((trade) => {
                const net = Number(trade.net_pnl || 0);
                return (
                  <tr key={trade.trade_id || `${trade.timestamp}-${trade.symbol}`} className="border-b border-slate-800/70 text-slate-200">
                    <td className="py-2 pr-3 text-slate-300">{new Date(trade.timestamp || Date.now()).toLocaleString()}</td>
                    <td className="py-2 pr-3">{trade.strategy || '-'}</td>
                    <td className="py-2 pr-3 font-semibold text-cyan-100">{trade.symbol || '-'}</td>
                    <td className="py-2 pr-3 uppercase">{trade.side || '-'}</td>
                    <td className="py-2 pr-3">{Number(trade.quantity || 0).toLocaleString()}</td>
                    <td className="py-2 pr-3">{Number(trade.entry_price || 0).toFixed(5)}</td>
                    <td className="py-2 pr-3">{Number(trade.exit_price || 0).toFixed(5)}</td>
                    <td className={`py-2 ${net >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {net >= 0 ? '+' : ''}{net.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
