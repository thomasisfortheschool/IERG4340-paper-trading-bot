'use client';

import { useState, useEffect } from 'react';
import { screeningApi } from '@/lib/api';
import { TrendingUp, Zap } from 'lucide-react';

export default function ScreeningPanel() {
  const [blowupStocks, setBlowupStocks] = useState<any[]>([]);
  const [coveredCalls, setCoveredCalls] = useState<any[]>([]);
  const [forex, setForex] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScreeningResults = async () => {
      try {
        const [stocksRes, callsRes, forexRes] = await Promise.all([
          screeningApi.blowupStocks(),
          screeningApi.coveredCalls(),
          screeningApi.forex(),
        ]);

        setBlowupStocks(stocksRes.data.candidates || []);
        setCoveredCalls(callsRes.data.opportunities || []);
        setForex(forexRes.data.opportunities || []);
      } catch (error) {
        console.error('Failed to fetch screening results:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchScreeningResults();
  }, []);

  if (loading) return <div className="card text-center text-slate-300">Scanning markets for opportunities...</div>;

  return (
    <div className="space-y-6">
      {/* Blowup Stocks */}
      <div>
        <h3 className="text-xl md:text-2xl font-bold mb-4 flex items-center space-x-2">
          <TrendingUp size={24} className="text-teal-300" />
          <span>High-Growth Stock Candidates</span>
        </h3>
        <div className="space-y-3">
          {blowupStocks.slice(0, 5).map((stock, idx) => (
            <div key={idx} className="card">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-1">
                    <span className="text-lg font-bold">{stock.symbol}</span>
                    <span className={`text-xs px-2 py-1 rounded-full border ${stock.score > 70 ? 'bg-emerald-900/50 text-emerald-200 border-emerald-700/60' : 'bg-slate-800/60 text-slate-300 border-slate-600/60'}`}>
                      Score: {stock.score}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300">{stock.reason}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">${stock.price.toFixed(2)}</p>
                  <p className="text-sm text-slate-300">Vol: {(stock.relative_volume).toFixed(1)}x</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Covered Calls */}
      <div>
        <h3 className="text-xl md:text-2xl font-bold mb-4 flex items-center space-x-2">
          <Zap size={24} className="text-amber-300" />
          <span>0DTE Covered Call Opportunities</span>
        </h3>
        <div className="space-y-3">
          {coveredCalls.map((call, idx) => (
            <div key={idx} className="card">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-1">
                    <span className="text-lg font-bold">{call.symbol}</span>
                    <span className="text-xs bg-emerald-900/50 text-emerald-200 border border-emerald-700/60 px-2 py-1 rounded-full">
                      Premium: {(call.premium_pct).toFixed(2)}%
                    </span>
                  </div>
                  <p className="text-sm text-slate-300">{call.reason}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">${call.call_premium.toFixed(3)}</p>
                  <p className="text-sm text-slate-300">Δ: {call.delta.toFixed(2)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Forex */}
      <div>
        <h3 className="text-xl md:text-2xl font-bold mb-4">Forex Trading Opportunities</h3>
        <div className="space-y-3">
          {forex.map((opp, idx) => (
            <div key={idx} className="card">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-1">
                    <span className="text-lg font-bold">{opp.symbol}</span>
                    <span className={`text-xs px-2 py-1 rounded-full border ${
                      opp.signal === 'buy' ? 'bg-emerald-900/50 text-emerald-200 border-emerald-700/60' : 'bg-rose-900/40 text-rose-200 border-rose-700/60'
                    }`}>
                      {opp.signal.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300">{opp.reason}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{opp.price.toFixed(4)}</p>
                  <p className="text-sm text-slate-300">Score: {opp.score}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
