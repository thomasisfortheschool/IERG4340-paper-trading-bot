'use client';

import { useTradingStore } from '@/store';
import { Percent, TrendingUp, Wallet2 } from 'lucide-react';

export default function PositionsPanel() {
  const { positions } = useTradingStore();

  if (!positions || positions.length === 0) {
    return (
      <div className="card text-center">
        <p className="text-slate-300">No open positions.</p>
      </div>
    );
  }

  const totals = positions.reduce(
    (acc, pos) => {
      const marketValue = Number(pos.current_price || 0) * Number(pos.quantity || 0);
      acc.marketValue += marketValue;
      acc.unrealized += Number(pos.pnl || 0);
      return acc;
    },
    { marketValue: 0, unrealized: 0 }
  );

  const totalPct = totals.marketValue > 0 ? (totals.unrealized / totals.marketValue) * 100 : 0;

  const money = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(value);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Portfolio Positions</h2>
        <p className="text-sm text-slate-300">{positions.length} open holdings</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-600/60 bg-slate-900/35 p-4">
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-300 mb-1">
            <Wallet2 size={13} /> Market Value
          </div>
          <p className="text-lg font-semibold">{money(totals.marketValue)}</p>
        </div>
        <div className="rounded-xl border border-slate-600/60 bg-slate-900/35 p-4">
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-300 mb-1">
            <TrendingUp size={13} /> Unrealized P&L
          </div>
          <p className={`text-lg font-semibold ${totals.unrealized >= 0 ? 'text-profit' : 'text-loss'}`}>
            {totals.unrealized >= 0 ? '+' : ''}{money(totals.unrealized)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-600/60 bg-slate-900/35 p-4">
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-300 mb-1">
            <Percent size={13} /> Unrealized Return
          </div>
          <p className={`text-lg font-semibold ${totalPct >= 0 ? 'text-profit' : 'text-loss'}`}>
            {totalPct >= 0 ? '+' : ''}{totalPct.toFixed(2)}%
          </p>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="bg-slate-900/50 text-slate-300">
                <th className="text-left px-4 py-3 font-semibold">Symbol</th>
                <th className="text-right px-4 py-3 font-semibold">Qty</th>
                <th className="text-right px-4 py-3 font-semibold">Avg Price</th>
                <th className="text-right px-4 py-3 font-semibold">Last Price</th>
                <th className="text-right px-4 py-3 font-semibold">Market Value</th>
                <th className="text-right px-4 py-3 font-semibold">Unrealized P&L</th>
                <th className="text-right px-4 py-3 font-semibold">Return</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos, idx) => {
                const qty = Number(pos.quantity || 0);
                const avg = Number(pos.avg_price || 0);
                const current = Number(pos.current_price || 0);
                const marketValue = qty * current;
                const pnl = Number(pos.pnl || 0);
                const pnlPct = Number(pos.pnl_pct || 0);

                return (
                  <tr key={idx} className="border-t border-slate-700/60 hover:bg-slate-900/30 transition">
                    <td className="px-4 py-3 font-semibold text-slate-100">{pos.symbol}</td>
                    <td className="px-4 py-3 text-right text-slate-200">{qty.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-slate-200">{money(avg)}</td>
                    <td className="px-4 py-3 text-right text-slate-100">{money(current)}</td>
                    <td className="px-4 py-3 text-right text-slate-100">{money(marketValue)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {pnl >= 0 ? '+' : ''}{money(pnl)}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${pnlPct >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-xs text-slate-300 px-1">Swipe horizontally on mobile to view all columns.</div>
    </div>
  );
}
