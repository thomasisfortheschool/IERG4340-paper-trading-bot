'use client';

import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store';
import { accountApi } from '@/lib/api';
import PortfolioChart from './PortfolioChart';
import PositionsPanel from './PositionsPanel';
import ScreeningPanel from './ScreeningPanel';
import SettingsPanel from './SettingsPanel';
import TickerResearchPanel from './TickerResearchPanel';
import { BarChart3, Briefcase, Search, Settings2, Sparkles } from 'lucide-react';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const { setPositions } = useTradingStore();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [historyRes, posRes] = await Promise.all([
          accountApi.getHistory(30),
          accountApi.getPositions(),
        ]);
        
        setHistory(historyRes.data.history);
        setPositions(posRes.data.positions);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [setPositions]);

  if (loading) return <div className="app-shell py-8 text-center text-slate-300">Loading dashboard data...</div>;

  return (
    <div className="app-shell py-5 md:py-6">
      {/* Tab Navigation */}
      <div className="mb-6 rounded-2xl border border-slate-700/70 bg-slate-900/30 p-2">
        <div className="scroll-row md:flex md:flex-wrap md:gap-2">
        {[
          { id: 'overview', label: 'Overview', icon: BarChart3 },
          { id: 'positions', label: 'Portfolio', icon: Briefcase },
          { id: 'screening', label: 'Signals', icon: Sparkles },
          { id: 'research', label: 'Research', icon: Search },
          { id: 'settings', label: 'Settings', icon: Settings2 },
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
        {activeTab === 'overview' && <PortfolioChart history={history} />}
        {activeTab === 'positions' && <PositionsPanel />}
        {activeTab === 'screening' && <ScreeningPanel />}
        {activeTab === 'research' && <TickerResearchPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
      </div>
    </div>
  );
}
