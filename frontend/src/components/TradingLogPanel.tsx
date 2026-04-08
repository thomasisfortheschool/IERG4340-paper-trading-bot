'use client';

import { useEffect, useMemo, useState } from 'react';
import { tradingApi } from '@/lib/api';
import { useTradingStore } from '@/store';
import { Beaker, Building2, ClipboardList, Download, Filter, ShieldCheck } from 'lucide-react';
import * as XLSX from 'xlsx';

type TradeLog = {
  trade_id: string;
  timestamp: string;
  strategy: string;
  asset_type: 'stock' | 'option' | 'forex';
  symbol: string;
  underlying: string;
  side: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  fees: number;
  gross_pnl: number;
  net_pnl: number;
  status: 'open' | 'closed';
  execution_origin?: 'simulated' | 'live_paper' | 'broker' | string;
  is_simulated?: boolean;
  notes: string;
};

const money = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);

export default function TradingLogPanel() {
  const { selectedBroker } = useTradingStore();
  const [logs, setLogs] = useState<TradeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [simulateMessage, setSimulateMessage] = useState('');
  const [tryMode, setTryMode] = useState<'simulated' | 'live_paper'>('simulated');
  const [source, setSource] = useState('demo');
  const [assetType, setAssetType] = useState('all');
  const [status, setStatus] = useState('all');
  const [executionFilter, setExecutionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const tryRounds = 8;
  const tryQuantity = tryMode === 'live_paper' ? 1000 : 2000;
  const perRoundWorstCase = tryMode === 'live_paper' ? 3.5 : 2.0;
  const maxExpectedLoss = Math.round(tryRounds * perRoundWorstCase * 100) / 100;
  const inferMarket = (symbol: string) => {
    const s = String(symbol || '').toUpperCase();
    if (s.endsWith('.HK')) return 'HK';
    if (s.endsWith('.T')) return 'JP';
    if (s.endsWith('.KS')) return 'KR';
    if (s.includes('EURUSD') || s.includes('GBPUSD') || s.includes('AUDUSD') || s.includes('USDJPY') || s.includes('NZDUSD')) return 'FX';
    return 'US';
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await tradingApi.getLogs({ assetType, status, days: 60 });
      setLogs(res.data.logs || []);
      setSource(String(res.data?.meta?.source || 'demo').toLowerCase());
    } catch (error) {
      console.error('Failed to load trading logs:', error);
      setLogs([]);
      setSource('unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [assetType, status]);

  const handleTryBuySell = async () => {
    if (tryMode === 'live_paper' && selectedBroker !== 'ibkr') {
      setSimulateMessage('Live paper mode requires IBKR paper source. Switch broker to IBKR first.');
      return;
    }

    let approved = true;
    if (tryMode === 'live_paper') {
      approved = window.confirm(
        'Run Tiny Live Paper mode? This will place tiny real paper forex BUY/SELL round-trip orders via IBKR.'
      );
      if (!approved) {
        return;
      }
    }

    setSimulating(true);
    setSimulateMessage(
      tryMode === 'live_paper'
        ? 'Running tiny live paper forex buy/sell burst...'
        : 'Running quick forex buy/sell simulation...'
    );
    try {
      const res = await tradingApi.tryBuySell(tryRounds, tryQuantity, tryMode, approved);
      const created = Number(res.data?.created || 0);
      const attempts = Number(res.data?.attempts || created);
      const submitted = Number(res.data?.submitted || created);
      const failed = Number(res.data?.failed || 0);
      const net = Number(res.data?.total_net_pnl || 0);
      const modeLabel = tryMode === 'live_paper' ? 'tiny live paper' : 'simulated';
      setSimulateMessage(
        `Created ${created} ${modeLabel} forex records. Attempts: ${attempts}, submitted: ${submitted}, failed: ${failed}. Combined net P&L: ${net >= 0 ? '+' : ''}${money(net)}.`
      );
      await fetchLogs();
    } catch (error: any) {
      const msg = error?.response?.data?.error || 'Failed to create simulated trades';
      setSimulateMessage(msg);
    } finally {
      setSimulating(false);
    }
  };

  const filteredLogs = useMemo(() => {
    const getExecutionType = (row: TradeLog) => {
      if (row.execution_origin === 'simulated' || row.is_simulated === true || row.strategy === 'try_buy_sell') return 'simulated';
      if (row.execution_origin === 'live_paper' || row.strategy === 'try_buy_sell_live') return 'live_paper';
      return 'broker';
    };

    const q = search.trim().toLowerCase();
    return logs.filter((row) => {
      const executionType = getExecutionType(row);
      const matchesExecution = executionFilter === 'all' || executionType === executionFilter;
      const matchesSearch = !q || (
        row.trade_id.toLowerCase().includes(q) ||
        row.symbol.toLowerCase().includes(q) ||
        row.underlying.toLowerCase().includes(q) ||
        row.strategy.toLowerCase().includes(q)
      );
      return matchesExecution && matchesSearch;
    });
  }, [logs, search, executionFilter]);

  const exportCsv = () => {
    if (filteredLogs.length === 0) return;

    const headers = [
      'trade_id',
      'timestamp',
      'strategy',
      'asset_type',
      'symbol',
      'underlying',
      'side',
      'quantity',
      'entry_price',
      'exit_price',
      'fees',
      'gross_pnl',
      'net_pnl',
      'status',
      'notes',
    ];

    const escapeCsv = (value: string | number | null) => {
      if (value === null || value === undefined) return '';
      const text = String(value);
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    const lines = [
      headers.join(','),
      ...filteredLogs.map((row) =>
        headers
          .map((key) => escapeCsv((row as unknown as Record<string, string | number | null>)[key]))
          .join(',')
      ),
    ];

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `trading-log-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  };

  const exportXlsx = () => {
    if (filteredLogs.length === 0) return;

    const rows = filteredLogs.map((row) => ({
      trade_id: row.trade_id,
      timestamp: row.timestamp,
      strategy: row.strategy,
      asset_type: row.asset_type,
      symbol: row.symbol,
      underlying: row.underlying,
      side: row.side,
      quantity: row.quantity,
      entry_price: row.entry_price,
      exit_price: row.exit_price,
      fees: row.fees,
      gross_pnl: row.gross_pnl,
      net_pnl: row.net_pnl,
      status: row.status,
      notes: row.notes,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'TradingLog');
    XLSX.writeFile(workbook, `trading-log-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 mb-2 text-slate-300">
              <ClipboardList size={18} />
              <span className="text-sm uppercase tracking-wide">Execution Ledger</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Trading Log</h2>
            <p className="text-slate-300 text-sm mt-1">Spreadsheet view of executed trades, with focus on options and forex activity.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 w-full md:w-auto md:min-w-[720px]">
            <select
              value={assetType}
              onChange={(e) => setAssetType(e.target.value)}
              className="input-modern"
            >
              <option value="all">All Assets</option>
              <option value="option">Options</option>
              <option value="forex">Forex</option>
              <option value="stock">Stocks</option>
            </select>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="input-modern"
            >
              <option value="all">All Status</option>
              <option value="closed">Closed</option>
              <option value="open">Open</option>
            </select>

            <select
              value={executionFilter}
              onChange={(e) => setExecutionFilter(e.target.value)}
              className="input-modern"
            >
              <option value="all">All Execution</option>
              <option value="simulated">Simulated</option>
              <option value="live_paper">Tiny Live Paper</option>
              <option value="broker">Live Fill</option>
            </select>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search symbol / trade id"
              className="input-modern"
            />
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 bg-slate-900/45">
          <div className="inline-flex items-center gap-2 text-sm text-slate-300">
            <Filter size={14} />
            {loading ? 'Loading records...' : `${filteredLogs.length} records`}
          </div>
          <div className="text-xs text-slate-300">
            Source: <span className="text-slate-100 uppercase">{source}</span>
          </div>
          <div className="inline-flex items-center gap-2">
            <select
              value={tryMode}
              onChange={(e) => setTryMode(e.target.value as 'simulated' | 'live_paper')}
              disabled={simulating || loading}
              className="input-modern w-[180px] h-10"
            >
              <option value="simulated">Try Mode: Simulated</option>
              <option value="live_paper">Try Mode: Tiny Live Paper</option>
            </select>
            <div className="hidden lg:block rounded-lg border border-slate-600/70 bg-slate-900/35 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Risk Envelope</p>
              <p className="text-xs font-semibold text-amber-200">
                Max expected loss: {money(maxExpectedLoss)}
              </p>
              <p className="text-[11px] text-slate-400">
                Formula: {tryRounds} rounds x {money(perRoundWorstCase)} worst-case/round
              </p>
            </div>
            <button
              onClick={handleTryBuySell}
              disabled={loading || simulating}
              className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
            >
              {simulating ? 'Trying...' : tryMode === 'live_paper' ? 'Try Buy/Sell (Live)' : 'Try Buy/Sell'}
            </button>
            <button
              onClick={exportCsv}
              disabled={loading || filteredLogs.length === 0}
              className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Download size={14} />
              CSV
            </button>
            <button
              onClick={exportXlsx}
              disabled={loading || filteredLogs.length === 0}
              className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Download size={14} />
              Excel
            </button>
          </div>
        </div>

        {simulateMessage && (
          <div className="px-4 py-2 border-b border-slate-700/60 bg-slate-900/25 text-xs text-slate-200">
            {simulateMessage}
          </div>
        )}

        <div className="lg:hidden px-4 py-2 border-b border-slate-700/60 bg-slate-900/20 text-xs text-amber-200">
          Risk Envelope: Max expected loss {money(maxExpectedLoss)} for {tryMode === 'live_paper' ? 'tiny live paper' : 'simulated'} mode.
          <span className="block text-slate-300 mt-1">Formula: {tryRounds} rounds x {money(perRoundWorstCase)} worst-case/round.</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1260px] text-sm">
            <thead>
              <tr className="bg-slate-900/45 text-slate-300">
                <th className="px-3 py-3 text-left font-semibold">Time</th>
                <th className="px-3 py-3 text-left font-semibold">Trade ID</th>
                <th className="px-3 py-3 text-left font-semibold">Execution</th>
                <th className="px-3 py-3 text-left font-semibold">Type</th>
                <th className="px-3 py-3 text-left font-semibold">Symbol</th>
                <th className="px-3 py-3 text-left font-semibold">Side</th>
                <th className="px-3 py-3 text-right font-semibold">Qty</th>
                <th className="px-3 py-3 text-right font-semibold">Entry</th>
                <th className="px-3 py-3 text-right font-semibold">Exit</th>
                <th className="px-3 py-3 text-right font-semibold">Fees</th>
                <th className="px-3 py-3 text-right font-semibold">Net P&L</th>
                <th className="px-3 py-3 text-left font-semibold">Strategy</th>
                <th className="px-3 py-3 text-left font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-8 text-center text-slate-300">
                    {source === 'demo'
                      ? 'No trade logs found for current filters.'
                      : `No ${source.toUpperCase()} fills found for current filters yet. Place a small paper trade to verify live logging.`}
                  </td>
                </tr>
              )}

              {filteredLogs.map((row) => {
                const executionType = row.execution_origin === 'simulated' || row.is_simulated === true || row.strategy === 'try_buy_sell'
                  ? 'simulated'
                  : row.execution_origin === 'live_paper' || row.strategy === 'try_buy_sell_live'
                    ? 'live_paper'
                    : 'broker';
                const executionClass = executionType === 'simulated'
                  ? 'bg-slate-800 border-slate-500/50 text-slate-200'
                  : executionType === 'live_paper'
                    ? 'bg-emerald-900/30 border-emerald-500/50 text-emerald-200'
                    : 'bg-cyan-900/30 border-cyan-500/50 text-cyan-200';
                const executionLabel = executionType === 'simulated'
                  ? 'SIMULATED'
                  : executionType === 'live_paper'
                    ? 'LIVE PAPER'
                    : 'LIVE FILL';
                const executionIcon = executionType === 'simulated'
                  ? <Beaker size={12} />
                  : executionType === 'live_paper'
                    ? <ShieldCheck size={12} />
                    : <Building2 size={12} />;

                return (
                <tr key={row.trade_id} className="border-t border-slate-700/55 hover:bg-slate-900/25">
                  <td className="px-3 py-3 text-slate-200">{new Date(row.timestamp).toLocaleString()}</td>
                  <td className="px-3 py-3 text-slate-200 font-medium">{row.trade_id}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border font-semibold ${executionClass}`}>
                      {executionIcon}
                      {executionLabel}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs border ${
                      row.asset_type === 'option'
                        ? 'bg-violet-900/35 border-violet-500/40 text-violet-200'
                        : row.asset_type === 'forex'
                          ? 'bg-cyan-900/35 border-cyan-500/40 text-cyan-200'
                          : 'bg-slate-800 border-slate-500/40 text-slate-200'
                    }`}>
                      {row.asset_type.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-100 font-medium">
                    <span className="inline-flex items-center gap-2">
                      <span>{row.symbol}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] border border-sky-700/60 bg-sky-900/35 text-sky-200">
                        {inferMarket(row.symbol)}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-200">{row.side}</td>
                  <td className="px-3 py-3 text-right text-slate-200">{row.quantity.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right text-slate-200">{money(row.entry_price)}</td>
                  <td className="px-3 py-3 text-right text-slate-200">{row.exit_price == null ? '-' : money(row.exit_price)}</td>
                  <td className="px-3 py-3 text-right text-slate-300">{money(row.fees)}</td>
                  <td className={`px-3 py-3 text-right font-semibold ${row.net_pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                    {row.net_pnl >= 0 ? '+' : ''}{money(row.net_pnl)}
                  </td>
                  <td className="px-3 py-3 text-slate-200">{row.strategy}</td>
                  <td className="px-3 py-3 text-slate-300">{row.notes}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs text-slate-300">Tip: Use filters for option-only or forex-only review. Swipe table horizontally on mobile.</div>
    </div>
  );
}
