'use client';

import { useState, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useTradingStore } from '@/store';
import { screeningApi, statusApi } from '@/lib/api';
import { TrendingUp, Zap } from 'lucide-react';

type StockFilters = {
  market: 'us' | 'hk' | 'jp' | 'kr';
  relative_volume_threshold: number;
  pe_ratio_max: number;
  forward_pe_ratio_max: number;
  price_min: number;
  price_max: number;
  market_cap_min_millions: number;
  top_n: number;
};

type SavedScannerProfile = {
  id: string;
  name: string;
  filters: StockFilters;
  refinements: {
    minScore: number;
    minRelVol: number;
    minAnalysts: number;
    dcfOnly: boolean;
  };
  createdAt: string;
};

const SAVED_SCANNER_KEY = 'ierg4340.savedScannerProfiles.v1';

const STOCK_PRESETS: Record<string, StockFilters> = {
  relaxed: {
    market: 'us',
    relative_volume_threshold: 1.2,
    pe_ratio_max: 80,
    forward_pe_ratio_max: 80,
    price_min: 2,
    price_max: 2000,
    market_cap_min_millions: 50,
    top_n: 12,
  },
  momentum: {
    market: 'us',
    relative_volume_threshold: 1.8,
    pe_ratio_max: 60,
    forward_pe_ratio_max: 60,
    price_min: 5,
    price_max: 800,
    market_cap_min_millions: 300,
    top_n: 10,
  },
  value: {
    market: 'us',
    relative_volume_threshold: 1.1,
    pe_ratio_max: 20,
    forward_pe_ratio_max: 18,
    price_min: 5,
    price_max: 500,
    market_cap_min_millions: 500,
    top_n: 10,
  },
  breakout_smallcap: {
    market: 'us',
    relative_volume_threshold: 2.2,
    pe_ratio_max: 120,
    forward_pe_ratio_max: 120,
    price_min: 1,
    price_max: 80,
    market_cap_min_millions: 50,
    top_n: 15,
  },
};

const SCANNER_CHIPS: Record<
  string,
  {
    label: string;
    description: string;
    filters: Partial<StockFilters>;
    refinements?: {
      minScore?: number;
      minRelVol?: number;
      minAnalysts?: number;
      dcfOnly?: boolean;
    };
  }
> = {
  breakout: {
    label: 'Breakout Movers',
    description: 'High relative volume and momentum names.',
    filters: {
      relative_volume_threshold: 2.2,
      pe_ratio_max: 100,
      forward_pe_ratio_max: 100,
      price_min: 3,
      market_cap_min_millions: 100,
      top_n: 20,
    },
    refinements: { minScore: 55, minRelVol: 2.0, minAnalysts: 0, dcfOnly: false },
  },
  value: {
    label: 'Value Setups',
    description: 'Lower valuation candidates with decent liquidity.',
    filters: {
      relative_volume_threshold: 1.1,
      pe_ratio_max: 20,
      forward_pe_ratio_max: 18,
      price_min: 5,
      market_cap_min_millions: 500,
      top_n: 20,
    },
    refinements: { minScore: 45, minRelVol: 1.0, minAnalysts: 3, dcfOnly: false },
  },
  largecap: {
    label: 'Large-Cap Quality',
    description: 'Bigger companies with analyst coverage and stable screens.',
    filters: {
      relative_volume_threshold: 1.0,
      pe_ratio_max: 45,
      forward_pe_ratio_max: 40,
      price_min: 10,
      market_cap_min_millions: 10000,
      top_n: 20,
    },
    refinements: { minScore: 50, minRelVol: 1.0, minAnalysts: 8, dcfOnly: false },
  },
  analyst: {
    label: 'Analyst Favorites',
    description: 'Names with stronger analyst participation.',
    filters: {
      relative_volume_threshold: 1.0,
      pe_ratio_max: 80,
      forward_pe_ratio_max: 80,
      price_min: 5,
      market_cap_min_millions: 200,
      top_n: 20,
    },
    refinements: { minScore: 50, minRelVol: 1.0, minAnalysts: 12, dcfOnly: false },
  },
  dcf: {
    label: 'DCF Upside',
    description: 'Candidates where valuation model is available.',
    filters: {
      relative_volume_threshold: 1.0,
      pe_ratio_max: 120,
      forward_pe_ratio_max: 120,
      price_min: 2,
      market_cap_min_millions: 50,
      top_n: 20,
    },
    refinements: { minScore: 40, minRelVol: 1.0, minAnalysts: 0, dcfOnly: true },
  },
};

export default function ScreeningPanel() {
  const { selectedBroker, refreshToken } = useTradingStore();
  const [blowupStocks, setBlowupStocks] = useState<any[]>([]);
  const [coveredCalls, setCoveredCalls] = useState<any[]>([]);
  const [forex, setForex] = useState<any[]>([]);
  const [stocksSource, setStocksSource] = useState('');
  const [callsSource, setCallsSource] = useState('');
  const [forexSource, setForexSource] = useState('');
  const [fetchError, setFetchError] = useState('');
  const [backendOnline, setBackendOnline] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [preset, setPreset] = useState('relaxed');
  const [draftFilters, setDraftFilters] = useState<StockFilters>(STOCK_PRESETS.relaxed);
  const [appliedFilters, setAppliedFilters] = useState<StockFilters>(STOCK_PRESETS.relaxed);
  const [expandedStocks, setExpandedStocks] = useState<Record<string, boolean>>({});
  const [expandedCalls, setExpandedCalls] = useState<Record<string, boolean>>({});
  const [expandedForex, setExpandedForex] = useState<Record<string, boolean>>({});
  const [stockSortMode, setStockSortMode] = useState<'score' | 'dcf_upside'>('score');
  const [stockSearch, setStockSearch] = useState('');
  const [stockMinScore, setStockMinScore] = useState(0);
  const [stockMinRelativeVolume, setStockMinRelativeVolume] = useState(0);
  const [stockMinAnalysts, setStockMinAnalysts] = useState(0);
  const [stockOnlyWithDcf, setStockOnlyWithDcf] = useState(false);
  const [visibleStockCount, setVisibleStockCount] = useState(12);
  const [activeScannerChip, setActiveScannerChip] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<SavedScannerProfile[]>([]);
  const [newProfileName, setNewProfileName] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_SCANNER_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setSavedProfiles(parsed.filter((row) => row && typeof row === 'object'));
      }
    } catch {
      setSavedProfiles([]);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_SCANNER_KEY, JSON.stringify(savedProfiles));
    } catch {
      // Ignore storage errors silently.
    }
  }, [savedProfiles]);

  useEffect(() => {
    const fetchScreeningResults = async () => {
      setLoading(true);
      setFetchError('');
      try {
        const healthRes = await statusApi.getHealth();
        setBackendOnline(healthRes.data?.status === 'healthy');

        const [stocksRes, callsRes, forexRes] = await Promise.allSettled([
          screeningApi.blowupStocks(appliedFilters),
          screeningApi.coveredCalls(),
          screeningApi.forex(),
        ]);

        if (stocksRes.status === 'fulfilled') {
          setBlowupStocks(stocksRes.value.data.candidates || []);
          setStocksSource(String(stocksRes.value.data?.meta?.source || 'unknown'));
        } else {
          setBlowupStocks([]);
          setStocksSource('unavailable');
        }

        if (callsRes.status === 'fulfilled') {
          setCoveredCalls(callsRes.value.data.opportunities || []);
          setCallsSource(String(callsRes.value.data?.meta?.source || 'unknown'));
        } else {
          setCoveredCalls([]);
          setCallsSource('unavailable');
        }

        if (forexRes.status === 'fulfilled') {
          setForex(forexRes.value.data.opportunities || []);
          setForexSource(String(forexRes.value.data?.meta?.source || 'unknown'));
        } else {
          setForex([]);
          setForexSource('unavailable');
        }

        if (stocksRes.status === 'rejected' && callsRes.status === 'rejected' && forexRes.status === 'rejected') {
          setFetchError('Signals API is unreachable right now. Check backend server on port 5000 and try again.');
        }
      } catch (error) {
        console.error('Failed to fetch screening results:', error);
        setBackendOnline(false);
        setFetchError('Signals API is unreachable right now. Check backend server on port 5000 and try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchScreeningResults();
  }, [selectedBroker, refreshToken, retryTick, appliedFilters]);

  const applyPreset = (nextPreset: string) => {
    setPreset(nextPreset);
    const nextFilters = STOCK_PRESETS[nextPreset] || STOCK_PRESETS.relaxed;
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
  };

  const applyCustomFilters = () => {
    setPreset('custom');
    setAppliedFilters({ ...draftFilters });
    setVisibleStockCount(12);
    setActiveScannerChip('');
  };

  const resetRefinements = () => {
    setStockSearch('');
    setStockMinScore(0);
    setStockMinRelativeVolume(0);
    setStockMinAnalysts(0);
    setStockOnlyWithDcf(false);
    setVisibleStockCount(12);
  };

  const runBroadScan = () => {
    const broadFilters: StockFilters = {
      ...draftFilters,
      relative_volume_threshold: 1.0,
      pe_ratio_max: 120,
      forward_pe_ratio_max: 120,
      market_cap_min_millions: 20,
      top_n: Math.max(20, Number(draftFilters.top_n || 20)),
    };
    setPreset('custom');
    setDraftFilters(broadFilters);
    setAppliedFilters(broadFilters);
    resetRefinements();
    setActiveScannerChip('');
  };

  const saveCurrentProfile = () => {
    const name = newProfileName.trim();
    if (!name) {
      setProfileMessage('Enter a preset name first.');
      return;
    }

    const profile: SavedScannerProfile = {
      id: `profile-${Date.now()}`,
      name,
      filters: { ...draftFilters },
      refinements: {
        minScore: stockMinScore,
        minRelVol: stockMinRelativeVolume,
        minAnalysts: stockMinAnalysts,
        dcfOnly: stockOnlyWithDcf,
      },
      createdAt: new Date().toISOString(),
    };

    setSavedProfiles((prev) => {
      const filtered = prev.filter((row) => row.name.toLowerCase() !== name.toLowerCase());
      return [profile, ...filtered].slice(0, 12);
    });
    setNewProfileName('');
    setProfileMessage(`Saved preset: ${name}`);
  };

  const applySavedProfile = (profile: SavedScannerProfile) => {
    setPreset('custom');
    setDraftFilters(profile.filters);
    setAppliedFilters(profile.filters);
    setStockMinScore(Number(profile.refinements?.minScore ?? 0));
    setStockMinRelativeVolume(Number(profile.refinements?.minRelVol ?? 0));
    setStockMinAnalysts(Number(profile.refinements?.minAnalysts ?? 0));
    setStockOnlyWithDcf(Boolean(profile.refinements?.dcfOnly));
    setActiveScannerChip('');
    setVisibleStockCount(12);
    setProfileMessage(`Applied preset: ${profile.name}`);
  };

  const deleteSavedProfile = (profileId: string) => {
    setSavedProfiles((prev) => prev.filter((row) => row.id !== profileId));
    setProfileMessage('Preset deleted.');
  };

  const applyScannerChip = (chipKey: string) => {
    const chip = SCANNER_CHIPS[chipKey];
    if (!chip) return;

    const nextFilters = { ...draftFilters, ...chip.filters };
    setPreset('custom');
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setStockMinScore(chip.refinements?.minScore ?? 0);
    setStockMinRelativeVolume(chip.refinements?.minRelVol ?? 0);
    setStockMinAnalysts(chip.refinements?.minAnalysts ?? 0);
    setStockOnlyWithDcf(Boolean(chip.refinements?.dcfOnly));
    setVisibleStockCount(12);
    setStockSearch('');
    setActiveScannerChip(chipKey);
  };

  const toggleExpanded = (
    key: string,
    setter: Dispatch<SetStateAction<Record<string, boolean>>>
  ) => {
    setter((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const inferMarketFromSymbol = (symbol: string) => {
    const s = String(symbol || '').toUpperCase();
    if (s.endsWith('.HK')) return 'HK';
    if (s.endsWith('.T')) return 'JP';
    if (s.endsWith('.KS')) return 'KR';
    return 'US';
  };

  const sortedStocks = useMemo(() => {
    const rows = [...blowupStocks];
    if (stockSortMode === 'dcf_upside') {
      rows.sort((a, b) => {
        const av = a?.dcf_available ? Number(a?.dcf_upside_pct ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
        const bv = b?.dcf_available ? Number(b?.dcf_upside_pct ?? Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
        return bv - av;
      });
      return rows;
    }

    rows.sort((a, b) => Number(b?.score ?? 0) - Number(a?.score ?? 0));
    return rows;
  }, [blowupStocks, stockSortMode]);

  const filteredStocks = useMemo(() => {
    return sortedStocks.filter((row) => {
      const symbol = String(row?.symbol || '').toUpperCase();
      const score = Number(row?.score ?? 0);
      const relVol = Number(row?.relative_volume ?? 0);
      const analysts = Number(row?.analyst_ratings ?? 0);
      if (stockSearch.trim() && !symbol.includes(stockSearch.trim().toUpperCase())) return false;
      if (score < stockMinScore) return false;
      if (relVol < stockMinRelativeVolume) return false;
      if (analysts < stockMinAnalysts) return false;
      if (stockOnlyWithDcf && !row?.dcf_available) return false;
      return true;
    });
  }, [sortedStocks, stockSearch, stockMinScore, stockMinRelativeVolume, stockMinAnalysts, stockOnlyWithDcf]);

  if (loading) return <div className="card text-center text-slate-300">Scanning markets for opportunities...</div>;

  return (
    <div className="space-y-6">
      <div className="card py-3">
        <p className="text-sm text-slate-300">
          Backend: <span className={backendOnline ? 'text-profit' : 'text-loss'}>{backendOnline ? 'Connected' : 'Disconnected'}</span>
        </p>
      </div>

      {fetchError && (
        <div className="card border border-rose-700/50 bg-rose-900/20 text-rose-200 text-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{fetchError}</span>
            <button
              onClick={() => setRetryTick((n) => n + 1)}
              disabled={loading}
              className="btn-secondary disabled:opacity-50"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Blowup Stocks */}
      <div>
        <h3 className="text-xl md:text-2xl font-bold mb-4 flex items-center space-x-2">
          <TrendingUp size={24} className="text-teal-300" />
          <span>High-Growth Stock Candidates</span>
        </h3>
        <p className="text-xs text-slate-300 mb-3">Source: <span className="text-slate-100 uppercase">{stocksSource}</span></p>

        <div className="card mb-4 space-y-4">
          <div className="rounded-xl border border-slate-600/70 bg-slate-900/30 p-3 space-y-3">
            <p className="text-sm font-semibold text-slate-100">My Scanner Presets</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-300 mb-1">Preset Name</label>
                <input
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="My Momentum Setup"
                  className="input-modern"
                />
              </div>
              <div className="md:col-span-2 flex items-end justify-end gap-2">
                <button className="btn-secondary" onClick={saveCurrentProfile}>Save Current Setup</button>
              </div>
            </div>

            {savedProfiles.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {savedProfiles.map((profile) => (
                  <div key={profile.id} className="rounded-lg border border-slate-600/70 bg-slate-900/35 p-2">
                    <p className="text-xs font-semibold text-slate-100">{profile.name}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Min score {profile.refinements.minScore}, rel vol {profile.refinements.minRelVol.toFixed(1)}, top {profile.filters.top_n}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button className="btn-secondary" onClick={() => applySavedProfile(profile)}>Apply</button>
                      <button className="btn-secondary" onClick={() => deleteSavedProfile(profile.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No saved presets yet. Save your current setup to reuse it later.</p>
            )}

            {profileMessage && <p className="text-xs text-cyan-200">{profileMessage}</p>}
          </div>

          <div className="rounded-xl border border-slate-600/70 bg-slate-900/30 p-3 space-y-3">
            <p className="text-sm font-semibold text-slate-100">Quick Scanner Chips</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
              {Object.entries(SCANNER_CHIPS).map(([chipKey, chip]) => (
                <button
                  key={chipKey}
                  onClick={() => applyScannerChip(chipKey)}
                  className={`rounded-lg border p-3 text-left transition ${
                    activeScannerChip === chipKey
                      ? 'border-teal-400 bg-teal-900/20'
                      : 'border-slate-600/70 bg-slate-900/35 hover:border-slate-400'
                  }`}
                >
                  <p className="text-xs font-semibold text-slate-100">{chip.label}</p>
                  <p className="text-[11px] text-slate-300 mt-1">{chip.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="block text-xs text-slate-300 mb-1">Preset Filter</label>
              <select
                value={preset}
                onChange={(e) => applyPreset(e.target.value)}
                className="input-modern"
              >
                <option value="relaxed">Relaxed Scanner</option>
                <option value="momentum">Momentum Leaders</option>
                <option value="value">Value Focus</option>
                <option value="breakout_smallcap">Breakout Small Cap</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Stock Market</label>
              <select
                value={draftFilters.market}
                onChange={(e) => setDraftFilters((p) => ({ ...p, market: e.target.value as 'us' | 'hk' | 'jp' | 'kr' }))}
                className="input-modern"
              >
                <option value="us">US</option>
                <option value="hk">Hong Kong</option>
                <option value="jp">Japan</option>
                <option value="kr">Korea</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Min Relative Volume</label>
              <input
                type="number"
                step={0.1}
                value={draftFilters.relative_volume_threshold}
                onChange={(e) => setDraftFilters((p) => ({ ...p, relative_volume_threshold: Number(e.target.value || 0) }))}
                className="input-modern"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Max P/E</label>
              <input
                type="number"
                value={draftFilters.pe_ratio_max}
                onChange={(e) => setDraftFilters((p) => ({ ...p, pe_ratio_max: Number(e.target.value || 0) }))}
                className="input-modern"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">Top Results</label>
              <input
                type="number"
                min={1}
                max={30}
                value={draftFilters.top_n}
                onChange={(e) => setDraftFilters((p) => ({ ...p, top_n: Number(e.target.value || 10) }))}
                className="input-modern"
              />
            </div>
          </div>

          <details className="rounded-xl border border-slate-600/70 bg-slate-900/30 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">Advanced Filter Controls</summary>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Max Forward P/E</label>
                <input
                  type="number"
                  value={draftFilters.forward_pe_ratio_max}
                  onChange={(e) => setDraftFilters((p) => ({ ...p, forward_pe_ratio_max: Number(e.target.value || 0) }))}
                  className="input-modern"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Min Price</label>
                <input
                  type="number"
                  value={draftFilters.price_min}
                  onChange={(e) => setDraftFilters((p) => ({ ...p, price_min: Number(e.target.value || 0) }))}
                  className="input-modern"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Max Price</label>
                <input
                  type="number"
                  value={draftFilters.price_max}
                  onChange={(e) => setDraftFilters((p) => ({ ...p, price_max: Number(e.target.value || 0) }))}
                  className="input-modern"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Min Market Cap (M)</label>
                <input
                  type="number"
                  value={draftFilters.market_cap_min_millions}
                  onChange={(e) => setDraftFilters((p) => ({ ...p, market_cap_min_millions: Number(e.target.value || 0) }))}
                  className="input-modern"
                />
              </div>
            </div>
          </details>

          <div className="rounded-xl border border-slate-600/70 bg-slate-900/30 p-3 space-y-3">
            <p className="text-sm font-semibold text-slate-100">Scanner Refinement (Finviz-style)</p>
            <p className="text-xs text-slate-300">
              Refinement is a second-stage filter after the backend scan. It does not fetch new tickers; it only narrows returned candidates.
            </p>
            <p className="text-[11px] text-slate-400">
              Symbol search is a contains filter on candidate symbols (for example, searching AAPL only works if AAPL is already in scanner candidates).
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Symbol Search</label>
                <input
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value.toUpperCase())}
                  placeholder="AAPL"
                  className="input-modern"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Min Score</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={stockMinScore}
                  onChange={(e) => setStockMinScore(Math.max(0, Number(e.target.value || 0)))}
                  className="input-modern"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Min Rel Vol</label>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={stockMinRelativeVolume}
                  onChange={(e) => setStockMinRelativeVolume(Math.max(0, Number(e.target.value || 0)))}
                  className="input-modern"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Min Analysts</label>
                <input
                  type="number"
                  min={0}
                  value={stockMinAnalysts}
                  onChange={(e) => setStockMinAnalysts(Math.max(0, Number(e.target.value || 0)))}
                  className="input-modern"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={stockOnlyWithDcf}
                    onChange={(e) => setStockOnlyWithDcf(e.target.checked)}
                  />
                  DCF only
                </label>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-300">
                Backend matches: <span className="text-slate-100 font-semibold">{blowupStocks.length}</span> | After refinement: <span className="text-slate-100 font-semibold">{filteredStocks.length}</span>
              </p>
              <button className="btn-secondary" onClick={resetRefinements}>
                Reset Refinement
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <button className="btn-primary disabled:opacity-50" disabled={loading} onClick={applyCustomFilters}>
              {loading ? 'Applying...' : 'Apply Filters'}
            </button>
          </div>
        </div>

        {filteredStocks.length === 0 && (
          <div className="card text-sm text-slate-300 mb-3">
            {blowupStocks.length === 0 ? (
              <div className="space-y-2">
                <p>No stocks passed the primary scanner filters in this run.</p>
                <p className="text-xs text-slate-400">This often happens when relative-volume and valuation conditions are too strict for current market data.</p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary" onClick={runBroadScan}>Run Broad Scan</button>
                  <button className="btn-secondary" onClick={() => applyPreset('relaxed')}>Use Relaxed Preset</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p>Scanner found candidates, but refinement removed all of them.</p>
                <p className="text-xs text-slate-400">Try clearing symbol search, lowering min score/min rel vol, or disabling DCF-only.</p>
                <button className="btn-secondary" onClick={resetRefinements}>Reset Refinement</button>
              </div>
            )}
          </div>
        )}

        {filteredStocks.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-300">
              Showing {Math.min(visibleStockCount, filteredStocks.length)} of {filteredStocks.length} matched candidates.
            </p>
            <div className="flex items-center gap-2">
            <label className="text-xs text-slate-300">Sort Stocks By</label>
            <select
              value={stockSortMode}
              onChange={(e) => setStockSortMode(e.target.value as 'score' | 'dcf_upside')}
              className="input-modern w-[220px]"
            >
              <option value="score">Composite Score (default)</option>
              <option value="dcf_upside">DCF Upside (valuation-first)</option>
            </select>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {filteredStocks.slice(0, visibleStockCount).map((stock, idx) => {
            const holdDays = Number(stock.recommended_holding_days || 0);
            const targetPrice = Number(stock.recommended_exit_price || 0);
            const stopPrice = Number(stock.recommended_stop_loss_price || 0);

            return (
              <div
                key={idx}
                className="card cursor-pointer"
                onClick={() => toggleExpanded(stock.symbol || String(idx), setExpandedStocks)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-1">
                      <span className="text-lg font-bold">{stock.symbol}</span>
                      <span className="text-xs px-2 py-1 rounded-full border border-sky-700/60 bg-sky-900/35 text-sky-200">
                        {inferMarketFromSymbol(stock.symbol)}
                      </span>
                      {stock.dcf_available && (
                        <span className={`text-xs px-2 py-1 rounded-full border ${Number(stock.dcf_upside_pct || 0) >= 0 ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/60' : 'bg-rose-900/40 text-rose-200 border-rose-700/60'}`}>
                          DCF {Number(stock.dcf_upside_pct || 0) >= 0 ? '+' : ''}{Number(stock.dcf_upside_pct || 0).toFixed(1)}%
                        </span>
                      )}
                      <span className={`text-xs px-2 py-1 rounded-full border ${stock.score > 70 ? 'bg-emerald-900/50 text-emerald-200 border-emerald-700/60' : 'bg-slate-800/60 text-slate-300 border-slate-600/60'}`}>
                        Score: {stock.score}
                      </span>
                      {holdDays > 0 && (
                        <span className="text-xs px-2 py-1 rounded-full border border-cyan-700/60 bg-cyan-900/35 text-cyan-200">
                          Hold: {holdDays}d
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-300">{stock.reason}</p>
                    {holdDays > 0 && targetPrice > 0 && stopPrice > 0 && (
                      <p className="text-xs text-cyan-200 mt-2">
                        Plan: buy near ${Number(stock.recommended_entry_price || stock.price).toFixed(2)}, hold up to {holdDays} days, target ${targetPrice.toFixed(2)}, stop ${stopPrice.toFixed(2)}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${stock.price.toFixed(2)}</p>
                    <p className="text-sm text-slate-300">Vol: {(stock.relative_volume).toFixed(1)}x</p>
                  </div>
                </div>
                {expandedStocks[stock.symbol || String(idx)] && (
                  <div className="mt-3 border-t border-slate-700/60 pt-3 text-xs text-slate-300 grid grid-cols-2 md:grid-cols-4 gap-2">
                    <p>Forward P/E: <span className="text-slate-100">{stock.forward_pe ?? 'N/A'}</span></p>
                    <p>Trailing P/E: <span className="text-slate-100">{stock.pe_ratio ?? 'N/A'}</span></p>
                    <p>Mkt Cap (M): <span className="text-slate-100">{stock.market_cap_millions ?? 'N/A'}</span></p>
                    <p>Analysts: <span className="text-slate-100">{stock.analyst_ratings ?? 0}</span></p>
                    <p>Current Vol: <span className="text-slate-100">{(stock.current_volume ?? 0).toLocaleString?.() ?? stock.current_volume}</span></p>
                    <p>20D Avg Vol: <span className="text-slate-100">{(stock.volume_avg_20d ?? 0).toLocaleString?.() ?? stock.volume_avg_20d}</span></p>
                    <p>DCF Fair Value: <span className="text-slate-100">{stock.dcf_available ? `$${Number(stock.dcf_fair_value || 0).toFixed(2)}` : 'N/A'}</span></p>
                    <p>DCF Upside: <span className={`${Number(stock.dcf_upside_pct || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{stock.dcf_available ? `${Number(stock.dcf_upside_pct || 0) >= 0 ? '+' : ''}${Number(stock.dcf_upside_pct || 0).toFixed(2)}%` : 'N/A'}</span></p>
                    <p>Passed Filters: <span className="text-slate-100">{stock.passed_filters ? 'Yes' : 'No'}</span></p>
                    <p>Entry Plan: <span className="text-slate-100">{stock.recommended_entry_price ? `$${Number(stock.recommended_entry_price).toFixed(2)}` : 'N/A'}</span></p>
                    <p>Target Exit: <span className="text-emerald-300">{stock.recommended_exit_price ? `$${Number(stock.recommended_exit_price).toFixed(2)}` : 'N/A'}</span></p>
                    <p>Stop Loss: <span className="text-rose-300">{stock.recommended_stop_loss_price ? `$${Number(stock.recommended_stop_loss_price).toFixed(2)}` : 'N/A'}</span></p>
                    <p>Hold Horizon: <span className="text-cyan-200">{stock.recommended_holding_days ? `${stock.recommended_holding_days} days` : 'N/A'}</span></p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filteredStocks.length > visibleStockCount && (
          <div className="mt-3 flex justify-center">
            <button
              className="btn-secondary"
              onClick={() => setVisibleStockCount((n) => Math.min(n + 10, filteredStocks.length))}
            >
              Show More Candidates
            </button>
          </div>
        )}
      </div>

      {/* Covered Calls */}
      <div>
        <h3 className="text-xl md:text-2xl font-bold mb-4 flex items-center space-x-2">
          <Zap size={24} className="text-amber-300" />
          <span>0DTE Covered Call Opportunities</span>
        </h3>
        <p className="text-xs text-slate-300 mb-3">Source: <span className="text-slate-100 uppercase">{callsSource}</span></p>
        <div className="space-y-3">
          {coveredCalls.map((call, idx) => (
            <div
              key={idx}
              className="card cursor-pointer"
              onClick={() => toggleExpanded(`${call.symbol}-${idx}`, setExpandedCalls)}
            >
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
              {expandedCalls[`${call.symbol}-${idx}`] && (
                <div className="mt-3 border-t border-slate-700/60 pt-3 text-xs text-slate-300 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <p>Stock Price: <span className="text-slate-100">${call.stock_price?.toFixed?.(2) ?? call.stock_price}</span></p>
                  <p>Strike: <span className="text-slate-100">${call.call_strike?.toFixed?.(2) ?? call.call_strike}</span></p>
                  <p>Expiry: <span className="text-slate-100">{call.expiry}</span></p>
                  <p>Score: <span className="text-slate-100">{call.score}</span></p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Forex */}
      <div>
        <h3 className="text-xl md:text-2xl font-bold mb-4">Forex Trading Opportunities</h3>
        <p className="text-xs text-slate-300 mb-3">Source: <span className="text-slate-100 uppercase">{forexSource}</span></p>
        <div className="space-y-3">
          {forex.map((opp, idx) => (
            <div
              key={idx}
              className="card cursor-pointer"
              onClick={() => toggleExpanded(`${opp.symbol}-${idx}`, setExpandedForex)}
            >
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
              {expandedForex[`${opp.symbol}-${idx}`] && (
                <div className="mt-3 border-t border-slate-700/60 pt-3 text-xs text-slate-300 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <p>Pair: <span className="text-slate-100">{opp.symbol}</span></p>
                  <p>Signal: <span className="text-slate-100 uppercase">{opp.signal}</span></p>
                  <p>Price: <span className="text-slate-100">{opp.price}</span></p>
                  <p>Score: <span className="text-slate-100">{opp.score}</span></p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
