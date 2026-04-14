'use client';

import { useEffect, useMemo, useState } from 'react';
import { tradingApi } from '@/lib/api';
import { Building2, ClipboardList, Download, Filter } from 'lucide-react';
import * as XLSX from 'xlsx';

type TradeLog = {
  trade_id: string;
  timestamp: string;
  strategy: string;
  asset_type: 'stock' | 'option' | 'forex' | 'crypto' | string;
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

const hktTimeFormatter = new Intl.DateTimeFormat('en-HK', {
  timeZone: 'Asia/Hong_Kong',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const formatHkt = (iso: string) => {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    return iso;
  }
  return `${hktTimeFormatter.format(dt)} HKT`;
};

export default function TradingLogPanel() {
  const [logs, setLogs] = useState<TradeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState('bot_ledger');
  const [assetType, setAssetType] = useState('all');
  const [status, setStatus] = useState('all');
  const [executionFilter, setExecutionFilter] = useState('all');
  const [search, setSearch] = useState('');
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
      setSource(String(res.data?.meta?.source || 'bot_ledger').toLowerCase());
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

  const filteredLogs = useMemo(() => {
    const getExecutionType = (row: TradeLog) => {
      if (row.strategy === 'try_buy_sell' || row.strategy === 'try_buy_sell_live') return 'testing';
      if (row.execution_origin === 'simulated' || row.is_simulated === true) return 'simulated';
      if (row.execution_origin === 'live_paper') return 'live_paper';
      return 'broker';
    };

    const q = search.trim().toLowerCase();
    return logs.filter((row) => {
      const executionType = getExecutionType(row);
      if (executionType === 'testing') return false;
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
              <option value="live_paper">Bot Ledger</option>
              <option value="broker">Broker Fill Feed</option>
              <option value="simulated">Simulated</option>
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
            Source: <span className="text-slate-100 uppercase">{source === 'bot_ledger' ? 'BOT LEDGER' : source === 'combined' ? 'COMBINED (LEDGER + BROKER)' : source}</span>
          </div>
          <div className="inline-flex items-center gap-2">
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

        <div className="px-4 py-2 border-b border-slate-700/60 bg-slate-900/30 text-xs text-slate-300">
          This is all paper mode. Bot Ledger = records written by this bot. Broker Fill Feed = executions reported by IB fill feed.
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1260px] text-sm">
            <thead>
              <tr className="bg-slate-900/45 text-slate-300">
                <th className="px-3 py-3 text-left font-semibold">Time (HKT)</th>
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
                    {`No ${source.toUpperCase()} fills found for current filters yet. Place a small paper trade to verify live logging.`}
                  </td>
                </tr>
              )}

              {filteredLogs.map((row) => {
                const executionType = row.execution_origin === 'live_paper'
                  ? 'live_paper'
                  : row.execution_origin === 'simulated' || row.is_simulated === true
                    ? 'simulated'
                    : 'broker';
                const executionClass = executionType === 'live_paper'
                  ? 'bg-emerald-900/30 border-emerald-500/50 text-emerald-200'
                  : executionType === 'simulated'
                    ? 'bg-slate-800 border-slate-500/50 text-slate-200'
                    : 'bg-cyan-900/30 border-cyan-500/50 text-cyan-200';
                const executionLabel = executionType === 'live_paper'
                  ? 'BOT LEDGER'
                  : executionType === 'simulated'
                    ? 'SIMULATED'
                    : 'BROKER FILL';

                return (
                  <tr key={row.trade_id} className="border-t border-slate-700/55 hover:bg-slate-900/25">
                    <td className="px-3 py-3 text-slate-200">{formatHkt(row.timestamp)}</td>
                    <td className="px-3 py-3 text-slate-200 font-medium">{row.trade_id}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border font-semibold ${executionClass}`}>
                        <Building2 size={12} />
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
                    <td className="px-3 py-3 text-slate-200">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${String(row.side).toLowerCase() === 'buy' ? 'border-emerald-500/50 bg-emerald-900/30 text-emerald-200' : String(row.side).toLowerCase() === 'sell' ? 'border-rose-500/50 bg-rose-900/25 text-rose-200' : 'border-indigo-500/50 bg-indigo-900/25 text-indigo-200'}`}>
                        {String(row.side).toLowerCase() === 'buy' ? 'BUY' : String(row.side).toLowerCase() === 'sell' ? 'SELL' : 'MARK'}
                      </span>
                    </td>
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
