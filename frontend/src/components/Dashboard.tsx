'use client';

import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store';
import { accountApi } from '@/lib/api';
import PortfolioChart from './PortfolioChart';
import PositionsPanel from './PositionsPanel';
import ScreeningPanel from './ScreeningPanel';
import SettingsPanel from './SettingsPanel';
import StrategyCustomizationPanel from './StrategyCustomizationPanel';
import RiskManagementPanel from './RiskManagementPanel';
import TickerResearchPanel from './TickerResearchPanel';
import TradingLogPanel from './TradingLogPanel';
import BotLogPanel from './BotLogPanel';
import { BarChart3, Bot, Briefcase, ClipboardList, Search, Settings2, Shield, SlidersHorizontal, Sparkles } from 'lucide-react';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('home');
  const [tradeDeskView, setTradeDeskView] = useState<'signals' | 'strategy' | 'risk'>('signals');
  const [operationsView, setOperationsView] = useState<'orders' | 'bot'>('orders');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const { setAccount, setPositions, refreshToken, selectedBroker } = useTradingStore();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [accountRes, historyRes, posRes] = await Promise.allSettled([
          accountApi.getSnapshot(),
          accountApi.getHistory(30),
          accountApi.getPositions(),
        ]);

        if (accountRes.status === 'fulfilled') {
          setAccount(accountRes.value.data);
        }

        if (historyRes.status === 'fulfilled') {
          setHistory(historyRes.value.data.history || []);
        }

        if (posRes.status === 'fulfilled') {
          setPositions(posRes.value.data.positions || []);
        }

        const failed = [accountRes, historyRes, posRes].filter((r) => r.status === 'rejected').length;
        if (failed === 0) {
          setFetchError('');
        } else if (failed < 3) {
          setFetchError('Partial refresh: some dashboard data is temporarily unavailable.');
        } else {
          setFetchError('Dashboard API unreachable. Check backend server on port 5000.');
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
        setFetchError('Dashboard API unreachable. Check backend server on port 5000.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [setAccount, setPositions, refreshToken, selectedBroker]);

  if (loading) return <div className="app-shell py-8 text-center text-slate-300">Loading dashboard data...</div>;

  return (
    <div className="app-shell py-5 md:py-6">
      {/* Tab Navigation */}
      {fetchError && (
        <div className="mb-3 rounded-xl border border-rose-700/50 bg-rose-900/20 px-3 py-2 text-xs text-rose-200">
          {fetchError}
        </div>
      )}
      <div className="mb-3 text-xs text-slate-300">
        Active data source: <span className="text-slate-100 uppercase">{selectedBroker}</span>
      </div>
      <div className="mb-6 rounded-2xl border border-slate-700/70 bg-slate-900/30 p-2">
        <div className="scroll-row md:flex md:flex-wrap md:gap-2">
        {[
          { id: 'home', label: 'Home', icon: BarChart3 },
          { id: 'trade-desk', label: 'Trade Desk', icon: Sparkles },
          { id: 'positions', label: 'Portfolio', icon: Briefcase },
          { id: 'research', label: 'Research', icon: Search },
          { id: 'operations', label: 'Operations', icon: ClipboardList },
          { id: 'settings', label: 'Bot Configuration', icon: Settings2 },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tab-pill ${activeTab === tab.id ? 'tab-pill-active' : ''}`}
          >
            <span className="inline-flex items-center gap-2">
              <tab.icon size={15} />
              {tab.label}
            </span>
          </button>
        ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="min-h-[60vh] pb-8">
        {activeTab === 'home' && <PortfolioChart history={history} source={selectedBroker} />}

        {activeTab === 'trade-desk' && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-700/70 bg-slate-900/30 p-2">
              <div className="scroll-row md:flex md:flex-wrap md:gap-2">
                {[
                  { id: 'signals', label: 'Signals', icon: Sparkles },
                  { id: 'strategy', label: 'Strategy', icon: SlidersHorizontal },
                  { id: 'risk', label: 'Risk', icon: Shield },
                ].map((view) => (
                  <button
                    key={view.id}
                    onClick={() => setTradeDeskView(view.id as 'signals' | 'strategy' | 'risk')}
                    className={`tab-pill ${tradeDeskView === view.id ? 'tab-pill-active' : ''}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <view.icon size={14} />
                      {view.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {tradeDeskView === 'signals' && <ScreeningPanel />}
            {tradeDeskView === 'strategy' && <StrategyCustomizationPanel />}
            {tradeDeskView === 'risk' && <RiskManagementPanel />}
          </div>
        )}

        {activeTab === 'positions' && <PositionsPanel />}
        {activeTab === 'research' && <TickerResearchPanel />}

        {activeTab === 'operations' && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-700/70 bg-slate-900/30 p-2">
              <div className="scroll-row md:flex md:flex-wrap md:gap-2">
                {[
                  { id: 'orders', label: 'Trading Log', icon: ClipboardList },
                  { id: 'bot', label: 'Bot Activity', icon: Bot },
                ].map((view) => (
                  <button
                    key={view.id}
                    onClick={() => setOperationsView(view.id as 'orders' | 'bot')}
                    className={`tab-pill ${operationsView === view.id ? 'tab-pill-active' : ''}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <view.icon size={14} />
                      {view.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {operationsView === 'orders' && <TradingLogPanel />}
            {operationsView === 'bot' && <BotLogPanel />}
          </div>
        )}

        {activeTab === 'settings' && <SettingsPanel />}
      </div>
    </div>
  );
}
