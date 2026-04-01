'use client';

import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store';
import { brokerApi, configApi } from '@/lib/api';
import { Activity, SlidersHorizontal, Sparkles, Wallet } from 'lucide-react';

export default function SettingsPanel() {
  const { config, currentMode, setConfig, setCurrentMode } = useTradingStore();
  const [presets, setPresets] = useState<any>({});
  const [customAllocation, setCustomAllocation] = useState({
    blowup_stocks_pct: 33.33,
    covered_calls_pct: 33.33,
    forex_pct: 33.34,
  });
  const [selectedBroker, setSelectedBroker] = useState('demo');
  const [brokerStatus, setBrokerStatus] = useState('');
  const [brokerLoading, setBrokerLoading] = useState(false);

  useEffect(() => {
    const fetchPresets = async () => {
      try {
        const [presetRes, brokerRes] = await Promise.all([
          configApi.getPresets(),
          brokerApi.getOptions(),
        ]);
        setPresets(presetRes.data.presets);
        setSelectedBroker((brokerRes.data.current || 'demo').toLowerCase());
      } catch (error) {
        console.error('Failed to fetch settings data:', error);
      }
    };

    fetchPresets();
  }, []);

  const handleModeChange = async (mode: string) => {
    try {
      await configApi.setMode(mode);
      setCurrentMode(mode);
      
      // Update allocation to preset
      if (presets[mode]) {
        setCustomAllocation(presets[mode].allocation);
      }
    } catch (error) {
      console.error('Failed to change mode:', error);
    }
  };

  const handleAllocationChange = async () => {
    try {
      const updatedConfig = {
        ...config,
        allocation: customAllocation,
        mode: 'custom',
      };
      await configApi.update(updatedConfig);
      setConfig(updatedConfig);
      setCurrentMode('custom');
    } catch (error) {
      console.error('Failed to update allocation:', error);
    }
  };

  const handleBrokerSwitch = async () => {
    setBrokerLoading(true);
    setBrokerStatus('');
    try {
      await brokerApi.switch(selectedBroker);
      setBrokerStatus(`Switched to ${selectedBroker.toUpperCase()} successfully.`);
    } catch (error: any) {
      const message = error?.response?.data?.error || 'Failed to switch broker';
      setBrokerStatus(message);
    } finally {
      setBrokerLoading(false);
    }
  };

  const allocationTotal =
    customAllocation.blowup_stocks_pct +
    customAllocation.covered_calls_pct +
    customAllocation.forex_pct;

  const filterFields = (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-semibold mb-1">Min Relative Volume</label>
        <input type="number" defaultValue={2.0} step={0.1} className="input-modern" />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-1">Max P/E</label>
        <input type="number" defaultValue={30} className="input-modern" />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-1">Min Call Premium %</label>
        <input type="number" defaultValue={0.5} step={0.1} className="input-modern" />
      </div>
      <div>
        <label className="block text-sm font-semibold mb-1">Target Delta</label>
        <input type="number" defaultValue={0.25} step={0.05} min={0} max={1} className="input-modern" />
      </div>

      <button className="btn-secondary w-full mt-2">Save Filter Settings</button>
    </div>
  );

  return (
    <div className="space-y-6 pb-24 md:pb-6">
      <div className="grid gap-6 xl:grid-cols-12">
        <section className="card xl:col-span-8">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="text-teal-300" size={20} />
            <h3 className="text-xl md:text-2xl font-bold">Trading Mode</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { id: 'balanced', label: 'Balanced', desc: '33/33/34' },
              { id: 'aggressive', label: 'Aggressive', desc: '50/30/20' },
              { id: 'conservative', label: 'Conservative', desc: '20/50/30' },
              { id: 'options_focused', label: 'Options', desc: '10/80/10' },
              { id: 'forex_focused', label: 'Forex', desc: '20/20/60' },
              { id: 'custom', label: 'Custom', desc: 'User Defined' },
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => handleModeChange(mode.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  currentMode === mode.id
                    ? 'border-teal-300 bg-teal-900/25'
                    : 'border-slate-600/70 hover:border-slate-400 hover:bg-slate-900/35'
                }`}
              >
                <p className="font-semibold text-white">{mode.label}</p>
                <p className="text-xs text-slate-300 mt-1">{mode.desc}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="card xl:col-span-4">
          <div className="flex items-center gap-3 mb-4">
            <Activity className="text-teal-300" size={20} />
            <h3 className="text-xl font-bold">Broker</h3>
          </div>
          <div className="space-y-3">
            <select
              value={selectedBroker}
              onChange={(e) => setSelectedBroker(e.target.value)}
              className="input-modern"
            >
              <option value="ibkr">IBKR Paper Trading</option>
              <option value="alpaca">Alpaca Paper Trading</option>
              <option value="demo">Demo / Mock Data</option>
            </select>
            <button
              onClick={handleBrokerSwitch}
              disabled={brokerLoading}
              className="btn-primary w-full disabled:opacity-50"
            >
              {brokerLoading ? 'Switching...' : 'Switch Broker'}
            </button>
            {brokerStatus && <p className="text-sm text-slate-100">{brokerStatus}</p>}
            <p className="text-xs text-slate-300">IBKR uses TWS/Gateway on your configured host/port.</p>
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <section className="card xl:col-span-8">
          <div className="flex items-center gap-3 mb-4">
            <Wallet className="text-teal-300" size={20} />
            <h3 className="text-xl md:text-2xl font-bold">Strategy Allocation</h3>
          </div>

          <div className="mb-5 overflow-hidden rounded-xl border border-slate-600/60 h-4 bg-slate-900/40 flex">
            <div style={{ width: `${customAllocation.blowup_stocks_pct}%` }} className="bg-cyan-400/80" />
            <div style={{ width: `${customAllocation.covered_calls_pct}%` }} className="bg-amber-400/80" />
            <div style={{ width: `${customAllocation.forex_pct}%` }} className="bg-emerald-400/80" />
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold mb-2">
                Blowup Stocks <span className="text-cyan-300">{customAllocation.blowup_stocks_pct.toFixed(1)}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={customAllocation.blowup_stocks_pct}
                onChange={(e) =>
                  setCustomAllocation({
                    ...customAllocation,
                    blowup_stocks_pct: parseFloat(e.target.value),
                  })
                }
                className="range-modern w-full accent-cyan-400"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">
                Covered Calls <span className="text-amber-300">{customAllocation.covered_calls_pct.toFixed(1)}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={customAllocation.covered_calls_pct}
                onChange={(e) =>
                  setCustomAllocation({
                    ...customAllocation,
                    covered_calls_pct: parseFloat(e.target.value),
                  })
                }
                className="range-modern w-full accent-amber-400"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">
                Forex <span className="text-emerald-300">{customAllocation.forex_pct.toFixed(1)}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={customAllocation.forex_pct}
                onChange={(e) =>
                  setCustomAllocation({
                    ...customAllocation,
                    forex_pct: parseFloat(e.target.value),
                  })
                }
                className="range-modern w-full accent-emerald-400"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-700/70 pt-4">
            <p className="text-sm text-slate-200">Total Allocation: {allocationTotal.toFixed(1)}%</p>
            <button onClick={handleAllocationChange} className="btn-primary hidden md:inline-flex">Save Custom Allocation</button>
          </div>
        </section>

        <section className="card xl:col-span-4">
          <div className="flex items-center gap-3 mb-4">
            <SlidersHorizontal className="text-teal-300" size={20} />
            <h3 className="text-xl font-bold">Screening Filters</h3>
          </div>

          <div className="hidden md:block">
            {filterFields}
          </div>

          <details className="md:hidden rounded-xl border border-slate-600/70 bg-slate-900/35 p-3" open={false}>
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">Advanced Filters</summary>
            <div className="mt-3">{filterFields}</div>
          </details>
        </section>
      </div>

      <div className="fixed bottom-3 left-3 right-3 z-30 md:hidden">
        <div className="rounded-2xl border border-slate-600/80 bg-[#0b1d27]/95 backdrop-blur-md px-4 py-3 shadow-2xl shadow-black/40 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-300">Allocation Total</p>
            <p className="text-sm font-semibold text-slate-100">{allocationTotal.toFixed(1)}%</p>
          </div>
          <button onClick={handleAllocationChange} className="btn-primary">Save Allocation</button>
        </div>
      </div>
    </div>
  );
}
