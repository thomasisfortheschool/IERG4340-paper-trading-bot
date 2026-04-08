'use client';

import { useState, useEffect } from 'react';
import { marketApi } from '@/lib/api';
import { CheckCircle2, AlertCircle, TrendingUp, BarChart3 } from 'lucide-react';

export default function SignalConfidencePanel() {
  const [performanceByRegime, setPerformanceByRegime] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPerformanceData();
  }, []);

  const loadPerformanceData = async () => {
    try {
      const res = await marketApi.getPerformanceByRegime('blowup_stocks');
      setPerformanceByRegime(res.data);
    } finally {
      setLoading(false);
    }
  };

  const getConfidenceColor = (winRate: number) => {
    if (winRate > 70) return 'text-emerald-300';
    if (winRate > 55) return 'text-cyan-300';
    if (winRate > 45) return 'text-yellow-300';
    return 'text-loss';
  };

  const getRegimeIcon = (regime: string) => {
    switch (regime) {
      case 'bull':
        return '📈';
      case 'bear':
        return '📉';
      case 'range_bound':
        return '↔️';
      case 'high_volatility':
        return '⚡';
      default:
        return '•';
    }
  };

  // Example signal for display
  const exampleSignal = {
    symbol: 'NVDA',
    signalType: 'buy',
    confidence: 'high',
    winRate: 72,
    expectedReturn: 6.5,
    maxDrawdownRisk: 2.3,
    dataSources: ['relative_volume', 'earnings_surprise', 'analyst_upgrade'],
    reason: 'High volume breakout with analyst upgrade and positive earnings surprise',
    recommendedEntry: 875.5,
    recommendedExit: 930.0,
    recommendedHoldingDays: 14,
    regime: 'bull',
  };

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <CheckCircle2 className="text-teal-300" size={24} />
          Signal Confidence & Trustworthiness
        </h2>
      </div>

      {/* Example Signal with Full Metadata */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Sample Signal: {exampleSignal.symbol}</h3>
          <span
            className={`px-3 py-1 rounded-full text-sm font-bold ${
              exampleSignal.confidence === 'high'
                ? 'bg-emerald-500/20 text-emerald-300'
                : exampleSignal.confidence === 'medium'
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'bg-yellow-500/20 text-yellow-300'
            }`}
          >
            {exampleSignal.confidence.toUpperCase()} CONFIDENCE
          </span>
        </div>

        {/* Signal Type & Direction */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-900/40 border border-slate-700">
          <TrendingUp className="text-emerald-300" size={24} />
          <div>
            <p className="text-sm text-slate-400">Signal</p>
            <p className="text-xl font-bold capitalize text-emerald-300">{exampleSignal.signalType}</p>
          </div>
        </div>

        {/* Reason & Data Sources */}
        <div className="space-y-2">
          <p className="text-sm text-slate-400">REASON</p>
          <p className="text-base text-slate-100">{exampleSignal.reason}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {exampleSignal.dataSources.map((source) => (
              <span
                key={source}
                className="px-2 py-1 rounded-full text-xs bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
              >
                {source.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>

        {/* Confidence Metrics */}
        <div className="grid md:grid-cols-3 gap-3 pt-3 border-t border-slate-700">
          <div className="rounded-lg bg-slate-800/50 p-3">
            <p className="text-xs uppercase text-slate-400">Historical Win Rate</p>
            <p className={`text-2xl font-bold ${getConfidenceColor(exampleSignal.winRate)}`}>
              {exampleSignal.winRate}%
            </p>
            <p className="text-xs text-slate-400 mt-1">Based on 100+ backtested trades</p>
          </div>
          <div className="rounded-lg bg-slate-800/50 p-3">
            <p className="text-xs uppercase text-slate-400">Expected Return</p>
            <p className="text-2xl font-bold text-emerald-300">+{exampleSignal.expectedReturn}%</p>
            <p className="text-xs text-slate-400 mt-1">Average per successful trade</p>
          </div>
          <div className="rounded-lg bg-slate-800/50 p-3">
            <p className="text-xs uppercase text-slate-400">Max Drawdown Risk</p>
            <p className="text-2xl font-bold text-yellow-300">-{exampleSignal.maxDrawdownRisk}%</p>
            <p className="text-xs text-slate-400 mt-1">Worst historical case</p>
          </div>
        </div>

        {/* Buy/Hold/Sell Horizon */}
        <div className="border-t border-slate-700 pt-4 grid md:grid-cols-3 gap-3">
          <div>
            <p className="text-xs uppercase text-slate-400 mb-2">Recommended Entry</p>
            <p className="text-lg font-bold text-cyan-300">${exampleSignal.recommendedEntry}</p>
            <p className="text-xs text-slate-400">Current: $880.00</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400 mb-2">Recommended Exit</p>
            <p className="text-lg font-bold text-emerald-300">${exampleSignal.recommendedExit}</p>
            <p className="text-xs text-slate-400">+6.3% from entry</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400 mb-2">Recommended Hold</p>
            <p className="text-lg font-bold text-orange-300">{exampleSignal.recommendedHoldingDays} days</p>
            <p className="text-xs text-slate-400">Average holding period</p>
          </div>
        </div>

        {/* Regime Context */}
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
          <p className="text-xs uppercase text-slate-400 mb-2">Best In Market Regime</p>
          <p className="text-lg font-bold capitalize">
            {getRegimeIcon(exampleSignal.regime)} {exampleSignal.regime}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Strategy works best when market is {exampleSignal.regime}
          </p>
        </div>
      </div>

      {/* Performance by Market Regime */}
      {performanceByRegime && (
        <div className="card space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <BarChart3 size={20} />
            Strategy Performance by Market Regime
          </h3>

          <div className="space-y-3">
            {Object.entries(performanceByRegime.by_regime).map(([regime, data]: [string, any]) => (
              <div key={regime} className="rounded-lg border border-slate-700 bg-slate-900/40 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold capitalize flex items-center gap-2">
                    {getRegimeIcon(regime)} {regime.replace(/_/g, ' ')}
                  </p>
                  <span className={`text-xs font-bold px-2 py-1 rounded ${data.win_rate > 55 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-yellow-500/20 text-yellow-300'}`}>
                    {data.trades} trades
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-xs text-slate-400">Win Rate</p>
                    <p className={`text-lg font-bold ${getConfidenceColor(data.win_rate)}`}>
                      {data.win_rate}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Avg Return</p>
                    <p className={`text-lg font-bold ${data.avg_return > 0 ? 'text-emerald-300' : 'text-loss'}`}>
                      {data.avg_return}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Sharpe Ratio</p>
                    <p className={`text-lg font-bold ${data.sharpe_ratio > 1 ? 'text-emerald-300' : data.sharpe_ratio > 0 ? 'text-cyan-300' : 'text-loss'}`}>
                      {data.sharpe_ratio}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trustworthiness Score */}
      <div className="card space-y-4">
        <h3 className="text-lg font-semibold">Overall Signal Trustworthiness Score</h3>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="w-full bg-slate-800 rounded-full h-3">
              <div className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-3 rounded-full" style={{width: '78%'}} />
            </div>
          </div>
          <p className="text-3xl font-bold text-emerald-300">78/100</p>
        </div>
        <div className="grid md:grid-cols-4 gap-2 text-xs">
          <div className="flex items-center gap-1">
            <CheckCircle2 size={14} className="text-emerald-300" />
            <span className="text-slate-300">High historical win rate</span>
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle2 size={14} className="text-emerald-300" />
            <span className="text-slate-300">Multi-source confirmation</span>
          </div>
          <div className="flex items-center gap-1">
            <AlertCircle size={14} className="text-yellow-300" />
            <span className="text-slate-300">Lower in bear markets</span>
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle2 size={14} className="text-emerald-300" />
            <span className="text-slate-300">Risk-controlled</span>
          </div>
        </div>
      </div>
    </div>
  );
}
