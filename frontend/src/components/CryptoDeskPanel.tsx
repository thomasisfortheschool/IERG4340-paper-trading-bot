'use client';

import { useEffect, useMemo, useState } from 'react';
import { botApi, brokerApi, configApi, statusApi, tradingApi } from '@/lib/api';
import { AlertTriangle, Coins, RefreshCw, ShieldAlert, TrendingUp } from 'lucide-react';

type CryptoSymbolState = {
  symbol: string;
  last_price: number | null;
  anchor: number | null;
  open_longs: number;
  open_shorts: number;
  realized_pnl: number;
  exposure_notional: number | null;
  exposure_cap: number | null;
  next_long_trigger: number | null;
  next_short_trigger: number | null;
  risk_blocked: string | null;
  last_updated: string | null;
};

export default function CryptoDeskPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [botStatus, setBotStatus] = useState<any>(null);
  const [symbols, setSymbols] = useState<CryptoSymbolState[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState<any>(null);
  const [configuredSymbols, setConfiguredSymbols] = useState<string[]>([]);

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
        setError('Backend API is offline. Crypto Desk will retry automatically when healthy.');
        setLoading(false);
        return;
      }

      const [botRes, logsRes, capRes, cfgRes] = await Promise.all([
        botApi.getStatus(),
        tradingApi.getLogs({ days: 2, assetType: 'crypto', status: 'all' }),
        brokerApi.getCapabilities(),
        configApi.getCurrent(),
      ]);

      const nextStatus = botRes.data || {};
      const nextCryptoGrid = nextStatus.crypto_grid || {};

      setBotStatus(nextStatus);
      setSymbols((nextCryptoGrid.symbols || []) as CryptoSymbolState[]);

      const rawRecords = (logsRes.data?.logs || logsRes.data?.records || []) as any[];
      setTrades(
        rawRecords
          .filter((row) => String(row.asset_type || '').toLowerCase() === 'crypto')
          .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
          .slice(0, 25)
      );

      setCapabilities(capRes.data || null);
      const symbolConfig = cfgRes.data?.crypto?.symbols;
      setConfiguredSymbols(Array.isArray(symbolConfig) ? symbolConfig : []);
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load crypto desk data');
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

  const totals = useMemo(() => {
    const openLongs = symbols.reduce((sum, s) => sum + Number(s.open_longs || 0), 0);
    const openShorts = symbols.reduce((sum, s) => sum + Number(s.open_shorts || 0), 0);
    const realized = symbols.reduce((sum, s) => sum + Number(s.realized_pnl || 0), 0);
    const exposure = symbols.reduce((sum, s) => sum + Number(s.exposure_notional || 0), 0);
    const cap = symbols.reduce((sum, s) => sum + Number(s.exposure_cap || 0), 0);
    return {
      openLongs,
      openShorts,
      openTotal: openLongs + openShorts,
      realized,
      exposure,
      cap,
    };
  }, [symbols]);

  if (loading) {
    return <div className="p-4 text-sm text-slate-300">Loading Crypto Desk...</div>;
  }

  const cryptoGrid = botStatus?.crypto_grid || {};
  const dailyLossCurrent = Number(cryptoGrid.daily_loss_current || 0);
  const dailyLossLimit = Math.max(1, Number(cryptoGrid.daily_loss_limit || 750));
  const lossUsedPct = Math.min(100, Math.max(0, (-Math.min(0, dailyLossCurrent) / dailyLossLimit) * 100));
  const pnlClass = Number(cryptoGrid.total_pnl || totals.realized) >= 0 ? 'text-emerald-300' : 'text-rose-300';

  return (
    <div className="space-y-5 p-4">
      <div className="rounded-2xl border border-red-700/40 bg-red-950/20 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-red-100">Crypto Desk</h2>
            <p className="text-sm text-slate-300 mt-1">
              Real-time 24/7 crypto execution monitor with exposure and circuit-breaker risk telemetry.
            </p>
          </div>
          <button
            onClick={() => void loadData()}
            className="rounded-lg border border-slate-600/70 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-400"
          >
            <span className="inline-flex items-center gap-2"><RefreshCw size={14} /> Refresh</span>
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Configured Symbols</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{configuredSymbols.length}</p>
          <p className="text-xs text-slate-400">{configuredSymbols.join(', ') || 'None configured'}</p>
        </div>
        <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Open Legs</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{totals.openTotal} (L {totals.openLongs} / S {totals.openShorts})</p>
          <p className="text-xs text-slate-400">Across {cryptoGrid.symbols_configured ?? symbols.length} symbols</p>
        </div>
        <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">P&L (R + U)</p>
          <p className={`mt-1 text-lg font-semibold ${pnlClass}`}>{Number(cryptoGrid.total_pnl || totals.realized) >= 0 ? '+' : ''}{Number(cryptoGrid.total_pnl || totals.realized).toFixed(2)}</p>
          <p className="text-xs text-slate-400">R {Number(cryptoGrid.realized_pnl || totals.realized).toFixed(2)} / U {Number(cryptoGrid.unrealized_pnl || 0).toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Broker Crypto Capability</p>
          <p className={`mt-1 text-lg font-semibold ${capabilities?.supports?.crypto ? 'text-emerald-300' : 'text-rose-300'}`}>
            {capabilities?.supports?.crypto ? 'Supported' : 'Unavailable'}
          </p>
          <p className="text-xs text-slate-400">{capabilities?.crypto?.reason || 'No capability details available'}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-red-700/40 bg-slate-900/35 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-100 inline-flex items-center gap-2">
            <ShieldAlert size={14} /> Daily Loss Circuit Breaker
          </p>
          <p className={`text-xs font-semibold ${cryptoGrid.daily_loss_halted ? 'text-rose-300' : 'text-emerald-300'}`}>
            {cryptoGrid.daily_loss_halted ? 'HALTED: New crypto entries blocked' : 'Active'}
          </p>
        </div>
        <div className="h-3 overflow-hidden rounded-full border border-slate-700 bg-slate-950/60">
          <div
            className={`h-full transition-all ${lossUsedPct >= 85 ? 'bg-rose-500' : lossUsedPct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${lossUsedPct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-300">
          Daily realized: {dailyLossCurrent.toFixed(2)} / Limit: -{dailyLossLimit.toFixed(2)} ({lossUsedPct.toFixed(1)}% used)
        </p>
      </div>

      <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
        <p className="text-sm font-semibold text-slate-100 mb-3 inline-flex items-center gap-2">
          <Coins size={14} /> Symbol Risk Meters
        </p>
        <div className="space-y-3">
          {symbols.length === 0 && <p className="text-sm text-slate-400">No active crypto symbol state yet.</p>}
          {symbols.map((row) => {
            const exposure = Number(row.exposure_notional || 0);
            const cap = Math.max(1, Number(row.exposure_cap || 0));
            const ratio = Math.min(100, (exposure / cap) * 100);
            return (
              <div key={row.symbol} className="rounded-xl border border-slate-700/70 bg-slate-900/35 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-red-100">{row.symbol}</p>
                  <p className="text-xs text-slate-300">Updated {getAge(row.last_updated)} ago</p>
                </div>
                <div className="h-2 overflow-hidden rounded-full border border-slate-700 bg-slate-950/60">
                  <div
                    className={`h-full ${ratio >= 90 ? 'bg-rose-500' : ratio >= 70 ? 'bg-amber-500' : 'bg-cyan-500'}`}
                    style={{ width: `${ratio}%` }}
                  />
                </div>
                <div className="mt-2 grid gap-2 text-xs text-slate-300 md:grid-cols-3">
                  <p>Exposure: {exposure.toFixed(2)} / Cap: {cap.toFixed(2)}</p>
                  <p>Open legs: {Number(row.open_longs || 0) + Number(row.open_shorts || 0)} (L {row.open_longs} / S {row.open_shorts})</p>
                  <p className={row.risk_blocked ? 'text-rose-300' : 'text-slate-300'}>
                    {row.risk_blocked ? `Blocked: ${row.risk_blocked}` : 'No block'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
        <p className="text-sm font-semibold text-slate-100 mb-3 inline-flex items-center gap-2">
          <TrendingUp size={14} /> Recent Crypto Trades
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-300">
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Strategy</th>
                <th className="py-2 pr-3">Symbol</th>
                <th className="py-2 pr-3">Side</th>
                <th className="py-2 pr-3">Qty</th>
                <th className="py-2 pr-3">Entry</th>
                <th className="py-2 pr-3">Exit</th>
                <th className="py-2">Net P&L</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-slate-400">No crypto trades in recent history yet.</td>
                </tr>
              )}
              {trades.map((trade) => {
                const net = Number(trade.net_pnl || 0);
                return (
                  <tr key={trade.trade_id || `${trade.timestamp}-${trade.symbol}`} className="border-b border-slate-800/70 text-slate-200">
                    <td className="py-2 pr-3 text-slate-300">{new Date(trade.timestamp || Date.now()).toLocaleString()}</td>
                    <td className="py-2 pr-3">{trade.strategy || '-'}</td>
                    <td className="py-2 pr-3 font-semibold text-red-100">{trade.symbol || '-'}</td>
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

      <div className="rounded-2xl border border-amber-700/50 bg-amber-950/20 p-4 text-sm text-amber-100">
        <p className="inline-flex items-center gap-2 font-semibold uppercase tracking-wide text-xs mb-2">
          <AlertTriangle size={14} /> Aggressive Risk Reminder
        </p>
        <p>
          Crypto runs 24/7 and can gap sharply in low-liquidity windows. Keep exposure caps conservative and stop automation if the
          circuit-breaker starts triggering repeatedly.
        </p>
      </div>
    </div>
  );
}
