'use client';

import { useState, useEffect } from 'react';
import { riskApi, marketApi } from '@/lib/api';
import { AlertTriangle, Shield, Clock, Activity, Gauge } from 'lucide-react';

export default function RiskManagementPanel() {
  const [positions, setPositions] = useState<any[]>([]);
  const [regime, setRegime] = useState<any>(null);
  const [aggregate, setAggregate] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [posRes, regimeRes] = await Promise.allSettled([
        riskApi.getPositionRisks(),
        marketApi.getRegime(),
      ]);

      if (posRes.status === 'fulfilled') {
        setPositions(posRes.value.data.positions || []);
        setAggregate(posRes.value.data.aggregate || null);
      }
      if (regimeRes.status === 'fulfilled') {
        setRegime(regimeRes.value.data);
      }
    } finally {
      setLoading(false);
    }
  };

  const getRiskLevel = (pos: any) => {
    if (pos.risk_level) return pos.risk_level;
    const unrealizedPnl = pos.pnl_pct || 0;
    const daysHeld = pos.days_held || 0;
    const maxLoss = pos.max_loss_pct || 2.0;
    const concentration = pos.concentration_pct || 0;

    if (unrealizedPnl <= -maxLoss) return 'critical';
    if (unrealizedPnl <= -maxLoss * 0.5 || concentration >= 20) return 'high';
    if (daysHeld > (pos.max_holding_days || 30) * 0.8) return 'expiring';
    return 'normal';
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'critical':
        return 'text-loss';
      case 'high':
        return 'text-yellow-400';
      case 'expiring':
        return 'text-orange-400';
      default:
        return 'text-emerald-300';
    }
  };

  const riskScore = Number(aggregate?.risk_score ?? 0);
  const riskLevel = String(aggregate?.risk_level || 'unknown');
  const riskMessage = aggregate?.headline || 'Portfolio risk summary unavailable.';

  const portfolioRiskClass =
    riskLevel === 'critical'
      ? 'border-rose-500/50 bg-rose-500/10 text-rose-100'
      : riskLevel === 'high'
        ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-50'
        : riskLevel === 'moderate'
          ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-50'
          : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-50';

  const summaryCards = [
    { label: 'Risk Score', value: `${riskScore.toFixed(1)}/100`, accent: riskScore >= 80 ? 'text-emerald-300' : riskScore >= 60 ? 'text-cyan-300' : riskScore >= 35 ? 'text-yellow-300' : 'text-loss' },
    { label: 'Largest Position', value: `${Number(aggregate?.largest_position_pct ?? 0).toFixed(1)}%`, accent: 'text-teal-200' },
    { label: 'Unrealized P&L', value: `${Number(aggregate?.unrealized_pnl ?? 0) >= 0 ? '+' : ''}${Number(aggregate?.unrealized_pnl ?? 0).toFixed(2)}`, accent: Number(aggregate?.unrealized_pnl ?? 0) >= 0 ? 'text-profit' : 'text-loss' },
    { label: 'Flags', value: `${Number(aggregate?.critical_positions ?? 0)} critical / ${Number(aggregate?.high_positions ?? 0)} high`, accent: 'text-slate-100' },
  ];

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <Shield className="text-teal-300" size={24} />
              Portfolio Risk Dashboard
            </h2>
            <p className="text-sm text-slate-300 mt-1">This view focuses on portfolio health, concentration, and exit pressure.</p>
          </div>
          <div className="rounded-full border border-slate-600/70 bg-slate-900/35 px-3 py-1 text-xs text-slate-200 inline-flex items-center gap-2">
            <Gauge size={13} />
            Risk score {riskScore.toFixed(1)}/100
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${portfolioRiskClass}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm opacity-80">Portfolio Health</p>
              <p className="text-xl font-bold mt-1 capitalize">{riskLevel}</p>
              <p className="text-sm mt-2 opacity-90">{riskMessage}</p>
            </div>
            <Activity size={28} className="opacity-80" />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-600/60 bg-slate-900/35 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-300">{card.label}</p>
              <p className={`text-2xl font-bold mt-1 ${card.accent}`}>{card.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Market Regime Alert */}
      {regime && (
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Current Market Regime</p>
              <p className={`text-lg font-bold capitalize ${getRiskColor(regime.regime)}`}>
                {regime.regime.replace(/_/g, ' ')}
              </p>
              <p className="text-xs text-slate-400 mt-1">VIX: {regime.vix?.toFixed(2)}</p>
            </div>
            <AlertTriangle
              className={getRiskColor(regime.regime === 'high_volatility' ? 'high' : 'normal')}
              size={32}
            />
          </div>
        </div>
      )}

      {/* Open Positions with Risk Metrics */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Open Positions Risk Profile</h3>
          <p className="text-xs text-slate-300">Flags use P&L, concentration, and holding time</p>
        </div>

        {loading ? (
          <p className="text-slate-400">Loading positions...</p>
        ) : positions.length === 0 ? (
          <p className="text-slate-400 text-center py-4">No open positions</p>
        ) : (
          <div className="space-y-3">
            {positions.map((pos, idx) => {
              const riskLevel = getRiskLevel(pos);
              const unrealizedPct = pos.pnl_pct || 0;
              const daysHeld = pos.days_held || 0;
              const maxHoldingDays = pos.max_holding_days || 30;

              return (
                <div
                  key={idx}
                  className={`rounded-lg border p-3 transition ${
                    riskLevel === 'critical'
                      ? 'border-loss/50 bg-loss/5'
                      : riskLevel === 'high'
                        ? 'border-yellow-500/50 bg-yellow-500/5'
                        : 'border-slate-600/70 bg-slate-900/40'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-lg">{pos.symbol}</p>
                        <span className="rounded-full border border-slate-600/70 bg-slate-900/35 px-2 py-0.5 text-[11px] text-slate-200">
                          {Number(pos.concentration_pct || 0).toFixed(1)}% of portfolio
                        </span>
                      </div>
                      <p className="text-sm text-slate-400">
                        {pos.quantity} shares @ ${pos.avg_price?.toFixed(2) || 'N/A'} | Market value ${Number(pos.market_value || 0).toFixed(2)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${unrealizedPct >= 0 ? 'text-profit' : 'text-loss'}`}>
                        {unrealizedPct > 0 ? '+' : ''}{unrealizedPct.toFixed(2)}%
                      </p>
                      <p className="text-xs text-slate-400">${pos.pnl?.toFixed(2) || 'N/A'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-700/50">
                    <div>
                      <p className="text-xs text-slate-400">Stop Loss</p>
                      <p className="text-sm font-semibold">{unrealizedPct > -pos.max_loss_pct ? <span className="text-emerald-300">Safe</span> : <span className="text-loss">Triggered</span>}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Profit Target</p>
                      <p className="text-sm font-semibold">
                        {unrealizedPct > pos.target_profit_pct ? (
                          <span className="text-emerald-300">Reached</span>
                        ) : (
                          <span className="text-slate-300">{(pos.target_profit_pct - unrealizedPct).toFixed(1)}% left</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock size={12} />
                        Days Held
                      </p>
                      <p className={`text-sm font-semibold ${daysHeld >= maxHoldingDays * 0.8 ? 'text-orange-400' : 'text-slate-300'}`}>
                        {daysHeld}/{maxHoldingDays}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Concentration</p>
                      <p className={`text-sm font-semibold ${Number(pos.concentration_pct || 0) >= 20 ? 'text-yellow-300' : 'text-slate-300'}`}>
                        {Number(pos.concentration_pct || 0).toFixed(1)}%
                      </p>
                    </div>
                  </div>

                  {/* Risk Level Badge */}
                  <div className="mt-3 flex gap-2">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        riskLevel === 'critical'
                          ? 'bg-loss/20 text-loss'
                          : riskLevel === 'high'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : riskLevel === 'expiring'
                              ? 'bg-orange-500/20 text-orange-400'
                              : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {riskLevel === 'critical' && '🚨 Critical'}
                      {riskLevel === 'high' && '⚠️ High Risk'}
                      {riskLevel === 'expiring' && '⏳ Expiring Soon'}
                      {riskLevel === 'normal' && '✓ Normal'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Position Sizing Rules */}
      <div className="card space-y-4">
        <h3 className="text-lg font-semibold">Position Sizing & Leverage Rules</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg bg-slate-900/40 p-3 border border-slate-600">
            <p className="text-xs uppercase text-slate-400">Max Position Size</p>
            <p className="text-2xl font-bold text-cyan-300">5.0%</p>
            <p className="text-xs text-slate-400 mt-1">Of total portfolio per position</p>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-3 border border-slate-600">
            <p className="text-xs uppercase text-slate-400">Max Daily Loss</p>
            <p className="text-2xl font-bold text-yellow-300">1.0%</p>
            <p className="text-xs text-slate-400 mt-1">Aggregate portfolio drawdown</p>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-3 border border-slate-600">
            <p className="text-xs uppercase text-slate-400">Max Correlation</p>
            <p className="text-2xl font-bold text-emerald-300">0.7</p>
            <p className="text-xs text-slate-400 mt-1">Between open positions</p>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-3 border border-slate-600">
            <p className="text-xs uppercase text-slate-400">Regime-Based Reduction</p>
            <p className="text-2xl font-bold">
              {regime?.regime === 'bear' || regime?.regime === 'high_volatility' ? (
                <span className="text-orange-300">50%</span>
              ) : (
                <span className="text-emerald-300">100%</span>
              )}
            </p>
            <p className="text-xs text-slate-400 mt-1">In current market regime</p>
          </div>
        </div>
      </div>
    </div>
  );
}
