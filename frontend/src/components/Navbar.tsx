'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '@/store';
import { statusApi } from '@/lib/api';
import { Wallet, TrendingUp, DollarSign, Activity } from 'lucide-react';

export default function Navbar() {
  const { account } = useTradingStore();
  const [brokerName, setBrokerName] = useState('DEMO');
  const [brokerConnected, setBrokerConnected] = useState(false);

  useEffect(() => {
    const fetchBrokerStatus = async () => {
      try {
        const res = await statusApi.getBrokerStatus();
        setBrokerName((res.data.broker || 'DEMO').toUpperCase());
        setBrokerConnected(Boolean(res.data.connected));
      } catch {
        setBrokerName('DEMO');
        setBrokerConnected(false);
      }
    };

    fetchBrokerStatus();
    const interval = setInterval(fetchBrokerStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  if (!account) return null;

  const pnlColor = account.total_pnl >= 0 ? 'text-profit' : 'text-loss';
  const todayColor = account.daily_pnl >= 0 ? 'text-profit' : 'text-loss';

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
          </div>

          <div className="scroll-row md:grid md:grid-cols-3 md:gap-3 w-full lg:w-auto">
            <div className="rounded-xl border border-slate-600/50 bg-slate-900/35 px-4 py-3 min-w-[180px] md:min-w-0 shrink-0">
              <div className="flex items-center gap-2 text-slate-300 text-xs uppercase tracking-wide mb-1">
                <DollarSign size={14} /> Total Value
              </div>
              <div>
                <p className="metric-value">${account.total_value.toLocaleString()}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-600/50 bg-slate-900/35 px-4 py-3 min-w-[220px] md:min-w-0 shrink-0">
              <div className="flex items-center gap-2 text-slate-300 text-xs uppercase tracking-wide mb-1">
                <TrendingUp size={14} className={pnlColor} /> Total P&L
              </div>
              <div>
                <p className={`metric-value ${pnlColor}`}>
                  ${account.total_pnl.toLocaleString()} ({account.total_pnl_pct.toFixed(2)}%)
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-600/50 bg-slate-900/35 px-4 py-3 min-w-[180px] md:min-w-0 shrink-0">
              <div className="flex items-center gap-2 text-slate-300 text-xs uppercase tracking-wide mb-1">
                <Wallet size={14} /> Today
              </div>
              <div>
                <p className={`metric-value ${todayColor}`}>
                  ${account.daily_pnl.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
