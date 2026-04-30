'use client';

import { useState, useEffect, useRef } from 'react';
import { useTradingStore } from '@/store';
import { accountApi } from '@/lib/api';
import PortfolioChart from './PortfolioChart';
import PositionsPanel from './PositionsPanel';
import ScreeningPanel from './ScreeningPanel';
import SettingsPanel from './SettingsPanel';
import StrategyCustomizationPanel from './StrategyCustomizationPanel';
import RiskManagementPanel from './RiskManagementPanel';
import TickerResearchPanel from './TickerResearchPanel';

// ...other imports

const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
};

export default function Dashboard() {
  // ...all hooks and state declarations

  useEffect(() => {
    let canceled = false;

    const fetchData = async () => {
      try {
        const t0 = performance.now();
        const [accountRes, historyRes, posRes] = await Promise.allSettled([
          (async () => {
            const t1 = performance.now();
            const res = await withTimeout(accountApi.getSnapshot(), 15000);
            const t2 = performance.now();
            console.log(`[Timing] accountApi.getSnapshot: ${(t2 - t1).toFixed(1)}ms`);
            return res;
          })(),
          (async () => {
            const t1 = performance.now();
            const res = await withTimeout(accountApi.getHistory(30), 15000);
            const t2 = performance.now();
            console.log(`[Timing] accountApi.getHistory: ${(t2 - t1).toFixed(1)}ms`);
            return res;
          })(),
          (async () => {
            const t1 = performance.now();
            const res = await withTimeout(accountApi.getPositions(), 15000);
            const t2 = performance.now();
            console.log(`[Timing] accountApi.getPositions: ${(t2 - t1).toFixed(1)}ms`);
            return res;
          })(),
        ]);
        const t3 = performance.now();
        console.log(`[Timing] Total dashboard fetch: ${(t3 - t0).toFixed(1)}ms`);

        if (canceled) {
          return;
        }

        if (accountRes.status === 'fulfilled') {
          setAccount(accountRes.value.data);
        }

        if (historyRes.status === 'fulfilled') {
          setHistory(historyRes.value.data.history || []);
          setHistorySource(String(historyRes.value.data?.data_source || 'unknown'));
          setHistorySnapshotTimestamp(historyRes.value.data?.snapshot_timestamp || null);
        }

        if (posRes.status === 'fulfilled') {
          setPositions(posRes.value.data.positions || []);
        }

        const failed = [accountRes, historyRes, posRes].filter((r) => r.status === 'rejected').length;
        if (failed === 0) {
          fullFailureStreakRef.current = 0;
          partialFailureStreakRef.current = 0;
          setFetchError('');
        } else if (failed < 3) {
          fullFailureStreakRef.current = 0;
          partialFailureStreakRef.current += 1;
          if (partialFailureStreakRef.current >= 2) {
            setFetchError('Partial refresh: some dashboard data is temporarily unavailable.');
          }
        } else {
          fullFailureStreakRef.current += 1;
          partialFailureStreakRef.current = 0;
          setFetchError(
            fullFailureStreakRef.current >= 2
              ? 'Live broker data is delayed. Dashboard is retrying with fallback data.'
              : 'Connecting to dashboard APIs...'
          );
        }
      } catch {
        if (canceled) {
          return;
        }
        fullFailureStreakRef.current += 1;
        partialFailureStreakRef.current = 0;
        setFetchError(
          fullFailureStreakRef.current >= 2
            ? 'Live broker data is delayed. Dashboard is retrying with fallback data.'
            : 'Connecting to dashboard APIs...'
        );
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => {
      canceled = true;
      clearInterval(interval);
    };
  }, [setAccount, setPositions, refreshToken, selectedBroker]);

  // Pass undefined for history while loading to trigger skeleton in PortfolioChart
  if (loading) {
    return (
      <div className="app-shell py-8 text-center text-slate-300">
        <PortfolioChart history={undefined as any} />
      </div>
    );
  }

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
      {isFallbackData && (
        <div className="mb-3 rounded-xl border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-100">
          Live broker response is delayed. Dashboard is showing cached snapshot/fallback values.
        </div>
      )}
      <div className="mb-6 rounded-2xl border border-slate-700/70 bg-slate-900/30 p-2">
        <div className="scroll-row md:flex md:flex-wrap md:gap-2">
        {[...
          { id: 'home', label: 'Home', icon: BarChart3 },
          { id: 'trade-desk', label: 'Trade Desk', icon: Sparkles },
          { id: 'positions', label: 'Portfolio', icon: Briefcase },
          { id: 'watchlists', label: 'Watchlists', icon: Bookmark },
          { id: 'sim-portfolios', label: 'Sim Portfolios', icon: Briefcase },
          { id: 'strategies', label: 'Strategies', icon: TrendingUp },
          { id: 'tools', label: 'Tools', icon: Zap },
          { id: 'forex', label: 'Forex Desk', icon: CandlestickChart },
          { id: 'crypto', label: 'Crypto Desk', icon: Coins },
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
        {activeTab === 'home' && (
          <div className="space-y-6">
            <MarketOverviewPanel />
            <PortfolioChart
              history={history}
              source={historySource || selectedBroker}
              snapshotTimestamp={historySnapshotTimestamp}
            />
          </div>
        )}

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
        {activeTab === 'watchlists' && <WatchlistSandboxPanel view="watchlists" />}
        {activeTab === 'sim-portfolios' && <WatchlistSandboxPanel view="portfolio" />}
        {activeTab === 'strategies' && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-700/70 bg-slate-900/30 p-2">
              <div className="scroll-row md:flex md:flex-wrap md:gap-2">
                {[
                  { id: 'performance', label: 'Performance', icon: TrendingUp },
                  { id: 'configuration', label: 'Configuration', icon: Settings2 },
                ].map((view) => (
                  <button
                    key={view.id}
                    onClick={() => setStrategiesView(view.id as 'performance' | 'configuration')}
                    className={`tab-pill ${strategiesView === view.id ? 'tab-pill-active' : ''}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <view.icon size={14} />
                      {view.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {strategiesView === 'performance' && <StrategyPerformancePanel />}
            {strategiesView === 'configuration' && <StrategyConfigurationPanel />}
          </div>
        )}
        {activeTab === 'tools' && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-700/70 bg-slate-900/30 p-2 overflow-x-auto">
              <div className="flex gap-2">
                {[
                  { id: 'summary', label: 'Overnight Summary', icon: Moon },
                  { id: 'backtest', label: 'Backtest', icon: Zap },
                ].map((view) => (
                  <button
                    key={view.id}
                    onClick={() => setToolsView(view.id as 'backtest' | 'summary')}
                    className={`tab-pill whitespace-nowrap ${toolsView === view.id ? 'tab-pill-active' : ''}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <view.icon size={14} />
                      {view.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {toolsView === 'summary' && <OvernightSummaryPanel />}
            {toolsView === 'backtest' && <BacktestPanel />}
          </div>
        )}
        {activeTab === 'forex' && <ForexGridPanel />}
        {activeTab === 'crypto' && <CryptoDeskPanel />}
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
