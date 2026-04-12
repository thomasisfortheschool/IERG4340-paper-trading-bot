'use client';

import { useEffect, useMemo, useState } from 'react';
import { accountApi, simPortfolioApi, watchlistApi } from '@/lib/api';
import { useTradingStore } from '@/store';
import { Bookmark, Plus, Trash2, Wallet2, LineChart, ShieldAlert } from 'lucide-react';

type Watchlist = {
  id: string;
  name: string;
  category: string;
  symbols: string[];
  notes?: string;
  created_at?: string;
  updated_at?: string;
  symbol_count?: number;
};

type PortfolioHolding = {
  id: string;
  symbol: string;
  shares: number;
  buy_price: number;
  buy_date: string;
  current_price: number;
  cost_basis: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  price_source?: string;
};

type SimPortfolio = {
  id: string;
  name: string;
  cash: number;
  starting_cash: number;
  holdings: PortfolioHolding[];
  holdings_count?: number;
  invested_value?: number;
  market_value?: number;
  total_value?: number;
  unrealized_pnl?: number;
  unrealized_pnl_pct?: number;
  created_at?: string;
  updated_at?: string;
};

const todayString = () => new Date().toISOString().slice(0, 10);

const money = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

export default function WatchlistSandboxPanel({
  view = 'all',
}: {
  view?: 'all' | 'watchlists' | 'portfolio';
}) {
  const { account } = useTradingStore();
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [portfolios, setPortfolios] = useState<SimPortfolio[]>([]);
  const [accountValue, setAccountValue] = useState<number>(0);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [watchlistName, setWatchlistName] = useState('');
  const [watchlistCategory, setWatchlistCategory] = useState('Stocks');
  const [watchlistSymbols, setWatchlistSymbols] = useState('');
  const [watchlistNotes, setWatchlistNotes] = useState('');
  const [portfolioName, setPortfolioName] = useState('Sandbox Portfolio');
  const [portfolioStartingCash, setPortfolioStartingCash] = useState('');
  const [portfolioUseCurrentValue, setPortfolioUseCurrentValue] = useState(true);
  const [holdingSymbol, setHoldingSymbol] = useState('');
  const [holdingShares, setHoldingShares] = useState('100');
  const [holdingBuyPrice, setHoldingBuyPrice] = useState('');
  const [holdingBuyDate, setHoldingBuyDate] = useState(todayString());
  const [watchlistSymbolInput, setWatchlistSymbolInput] = useState<Record<string, string>>({});

  const loadData = async () => {
    try {
      const [watchlistsRes, portfoliosRes, accountRes] = await Promise.all([
        watchlistApi.getAll(),
        simPortfolioApi.getAll(),
        accountApi.getSnapshot(),
      ]);

      setWatchlists(watchlistsRes.data?.watchlists || []);
      setCategories(watchlistsRes.data?.categories || []);
      setPortfolios(portfoliosRes.data?.portfolios || []);
      setAccountValue(Number(portfoliosRes.data?.account_total_value ?? accountRes.data?.total_value ?? 0));
      if (!selectedPortfolioId) {
        const first = (portfoliosRes.data?.portfolios || [])[0];
        if (first?.id) {
          setSelectedPortfolioId(first.id);
        }
      }
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to load watchlists and simulated portfolios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (portfolioUseCurrentValue) {
      setPortfolioStartingCash(accountValue > 0 ? String(Math.round(accountValue * 100) / 100) : '');
    }
  }, [accountValue, portfolioUseCurrentValue]);

  const selectedPortfolio = useMemo(
    () => portfolios.find((portfolio) => portfolio.id === selectedPortfolioId) || portfolios[0] || null,
    [portfolios, selectedPortfolioId]
  );

  useEffect(() => {
    if (!selectedPortfolioId && portfolios[0]?.id) {
      setSelectedPortfolioId(portfolios[0].id);
    }
  }, [portfolios, selectedPortfolioId]);

  const groupedWatchlists = useMemo(() => {
    const filterCategory = categories.length > 0 ? undefined : undefined;
    const selected = filterCategory;
    const items = selected ? watchlists.filter((item) => item.category === selected) : watchlists;
    return items;
  }, [watchlists, categories]);

  const createWatchlist = async () => {
    try {
      const symbols = watchlistSymbols
        .split(',')
        .map((symbol) => symbol.trim())
        .filter(Boolean);
      await watchlistApi.create({
        name: watchlistName,
        category: watchlistCategory || 'General',
        symbols,
        notes: watchlistNotes,
      });
      setWatchlistName('');
      setWatchlistSymbols('');
      setWatchlistNotes('');
      setMessage('Watchlist created.');
      await loadData();
    } catch (e: any) {
      setMessage(e?.response?.data?.error || 'Failed to create watchlist');
    }
  };

  const addSymbolToWatchlist = async (watchlist: Watchlist) => {
    const nextSymbol = String(watchlistSymbolInput[watchlist.id] || '').trim();
    if (!nextSymbol) return;
    try {
      const nextSymbols = Array.from(new Set([...(watchlist.symbols || []), nextSymbol.toUpperCase()]));
      await watchlistApi.update(watchlist.id, {
        name: watchlist.name,
        category: watchlist.category,
        notes: watchlist.notes,
        symbols: nextSymbols,
      });
      setWatchlistSymbolInput((current) => ({ ...current, [watchlist.id]: '' }));
      setMessage(`Added ${nextSymbol.toUpperCase()} to ${watchlist.name}.`);
      await loadData();
    } catch (e: any) {
      setMessage(e?.response?.data?.error || 'Failed to add symbol');
    }
  };

  const removeWatchlist = async (watchlistId: string) => {
    try {
      await watchlistApi.remove(watchlistId);
      setMessage('Watchlist removed.');
      await loadData();
    } catch (e: any) {
      setMessage(e?.response?.data?.error || 'Failed to remove watchlist');
    }
  };

  const createPortfolio = async () => {
    try {
      const initialCash = portfolioUseCurrentValue
        ? undefined
        : Number(portfolioStartingCash || 0);
      await simPortfolioApi.create({
        name: portfolioName,
        initial_cash: Number.isFinite(initialCash as number) ? (initialCash as number) : undefined,
        clone_current_account: portfolioUseCurrentValue,
      });
      setPortfolioName('Sandbox Portfolio');
      setMessage('Simulated portfolio created.');
      await loadData();
    } catch (e: any) {
      setMessage(e?.response?.data?.error || 'Failed to create simulated portfolio');
    }
  };

  const addHolding = async () => {
    if (!selectedPortfolio) return;
    try {
      const shares = Number(holdingShares || 0);
      const payload: any = {
        symbol: holdingSymbol,
        shares,
      };
      const trimmedPrice = String(holdingBuyPrice || '').trim();
      if (trimmedPrice) {
        payload.buy_price = Number(trimmedPrice);
      }
      if (holdingBuyDate) {
        payload.buy_date = holdingBuyDate;
      }
      await simPortfolioApi.addHolding(selectedPortfolio.id, payload);
      setHoldingSymbol('');
      setHoldingShares('100');
      setHoldingBuyPrice('');
      setHoldingBuyDate(todayString());
      setMessage(`Added holding to ${selectedPortfolio.name}.`);
      await loadData();
    } catch (e: any) {
      setMessage(e?.response?.data?.error || 'Failed to add holding');
    }
  };

  const removeHolding = async (holdingId: string) => {
    if (!selectedPortfolio) return;
    try {
      await simPortfolioApi.removeHolding(selectedPortfolio.id, holdingId);
      setMessage(`Sold holding from ${selectedPortfolio.name}.`);
      await loadData();
    } catch (e: any) {
      setMessage(e?.response?.data?.error || 'Failed to remove holding');
    }
  };

  const watchlistCategories = ['All', ...categories];
  const [categoryFilter, setCategoryFilter] = useState('All');
  const visibleWatchlists = categoryFilter === 'All' ? groupedWatchlists : watchlists.filter((item) => item.category === categoryFilter);
  const showWatchlists = view !== 'portfolio';
  const showPortfolio = view !== 'watchlists';

  if (loading) {
    return <div className="p-4 text-sm text-slate-300">Loading watchlists and sandbox portfolios...</div>;
  }

  const currentPortfolio = selectedPortfolio;
  const portfolioPnL = Number(currentPortfolio?.unrealized_pnl || 0);
  const portfolioPnLClass = portfolioPnL >= 0 ? 'text-emerald-300' : 'text-rose-300';
  const currentAccountValue = accountValue || Number(account?.total_value || 0);

  return (
    <div className="space-y-6 p-4">
      <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              {view === 'watchlists' ? 'Watchlists' : view === 'portfolio' ? 'Simulated Portfolios' : 'Watchlists & Simulated Portfolios'}
            </h2>
            <p className="text-sm text-slate-300 mt-1">
              {view === 'watchlists'
                ? 'Track ideas and symbols by category.'
                : view === 'portfolio'
                  ? 'Build and monitor paper portfolios with live marks.'
                  : 'Organize ideas by category and create paper portfolios seeded with your current account value.'}
            </p>
          </div>
          <button onClick={() => void loadData()} className="btn-secondary inline-flex items-center gap-2 self-start md:self-auto">
            <LineChart size={14} /> Refresh
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
        {message && <p className="mt-2 text-sm text-slate-200">{message}</p>}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">Current Account Value</p>
          <p className="mt-1 text-lg font-semibold text-slate-100">{money(currentAccountValue)}</p>
        </div>
        {showWatchlists && (
          <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Watchlists</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{watchlists.length}</p>
          </div>
        )}
        {showPortfolio && (
          <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Sim Portfolios</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">{portfolios.length}</p>
          </div>
        )}
      </div>

      <div className={`grid gap-5 ${showWatchlists && showPortfolio ? 'xl:grid-cols-2' : ''}`}>
        {showWatchlists && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
            <div className="flex items-center gap-2">
              <Bookmark size={16} className="text-teal-300" />
              <h3 className="text-lg font-semibold">Create Watchlist</h3>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input className="input-modern" placeholder="Watchlist name" value={watchlistName} onChange={(e) => setWatchlistName(e.target.value)} />
              <input className="input-modern" placeholder="Category (e.g. Tech, FX, Earnings)" value={watchlistCategory} onChange={(e) => setWatchlistCategory(e.target.value)} />
              <input className="input-modern md:col-span-2" placeholder="Symbols comma-separated" value={watchlistSymbols} onChange={(e) => setWatchlistSymbols(e.target.value)} />
              <textarea className="input-modern md:col-span-2 min-h-[90px]" placeholder="Notes" value={watchlistNotes} onChange={(e) => setWatchlistNotes(e.target.value)} />
            </div>
            <button onClick={() => void createWatchlist()} className="mt-3 btn-primary inline-flex items-center gap-2">
              <Plus size={14} /> Create Watchlist
            </button>
          </div>

          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Saved Watchlists</h3>
              <div className="flex flex-wrap gap-2">
                {watchlistCategories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setCategoryFilter(category)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      categoryFilter === category
                        ? 'border-teal-300 bg-teal-900/25 text-teal-100'
                        : 'border-slate-600/70 bg-slate-900/35 text-slate-300 hover:border-slate-400'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {visibleWatchlists.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-600/70 bg-slate-950/20 p-4 text-sm text-slate-300">
                  No watchlists yet. Create one to start saving categories like Tech, Earnings, FX, or Mean Reversion.
                </div>
              ) : (
                visibleWatchlists.map((watchlist) => (
                  <div key={watchlist.id} className="rounded-xl border border-slate-700/70 bg-slate-950/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-100">{watchlist.name}</p>
                        <p className="text-xs text-slate-400">Category: {watchlist.category} | {watchlist.symbol_count ?? watchlist.symbols.length} symbols</p>
                      </div>
                      <button onClick={() => void removeWatchlist(watchlist.id)} className="text-xs text-rose-300 hover:text-rose-200 inline-flex items-center gap-1">
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>

                    {watchlist.notes && <p className="mt-2 text-xs text-slate-300">{watchlist.notes}</p>}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {watchlist.symbols.length === 0 ? (
                        <span className="text-xs text-slate-400">No symbols yet.</span>
                      ) : (
                        watchlist.symbols.map((symbol) => (
                          <span key={symbol} className="rounded-full border border-slate-600/70 bg-slate-900/35 px-2 py-1 text-xs text-slate-200">
                            {symbol}
                          </span>
                        ))
                      )}
                    </div>

                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input
                        className="input-modern flex-1"
                        placeholder="Add symbol"
                        value={watchlistSymbolInput[watchlist.id] || ''}
                        onChange={(e) => setWatchlistSymbolInput((current) => ({ ...current, [watchlist.id]: e.target.value }))}
                      />
                      <button onClick={() => void addSymbolToWatchlist(watchlist)} className="btn-secondary">
                        Add Symbol
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
        )}

        {showPortfolio && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
            <div className="flex items-center gap-2">
              <Wallet2 size={16} className="text-cyan-300" />
              <h3 className="text-lg font-semibold">Create Simulated Portfolio</h3>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              By default, the sandbox starts with the current account value and uses the current market price/today if you leave buy price/date blank.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input className="input-modern" placeholder="Portfolio name" value={portfolioName} onChange={(e) => setPortfolioName(e.target.value)} />
              <label className="flex items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-950/20 px-3 py-2 text-sm text-slate-200">
                <input type="checkbox" checked={portfolioUseCurrentValue} onChange={(e) => setPortfolioUseCurrentValue(e.target.checked)} />
                Seed with current account value
              </label>
              <input
                className="input-modern md:col-span-2"
                type="number"
                step="0.01"
                placeholder={portfolioUseCurrentValue ? 'Uses current account value' : 'Initial cash'}
                value={portfolioStartingCash}
                onChange={(e) => setPortfolioStartingCash(e.target.value)}
                disabled={portfolioUseCurrentValue}
              />
            </div>
            <button onClick={() => void createPortfolio()} className="mt-3 btn-primary inline-flex items-center gap-2">
              <Plus size={14} /> Create Portfolio
            </button>
          </div>

          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Simulated Portfolios</h3>
              <span className="text-xs text-slate-400">Select one to add holdings</span>
            </div>

            <div className="mt-4 grid gap-3">
              {portfolios.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-600/70 bg-slate-950/20 p-4 text-sm text-slate-300">
                  No simulated portfolios yet. Create one from current account value to start a sandbox.
                </div>
              ) : (
                portfolios.map((portfolio) => (
                  <button
                    key={portfolio.id}
                    onClick={() => setSelectedPortfolioId(portfolio.id)}
                    className={`rounded-xl border p-4 text-left transition ${
                      selectedPortfolioId === portfolio.id
                        ? 'border-cyan-300 bg-cyan-900/20'
                        : 'border-slate-700/70 bg-slate-950/20 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-100">{portfolio.name}</p>
                        <p className="text-xs text-slate-400">Created {portfolio.created_at ? new Date(portfolio.created_at).toLocaleString() : 'recently'}</p>
                      </div>
                      <span className="text-xs text-slate-300">{portfolio.holdings_count || portfolio.holdings.length} holdings</span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3 text-sm">
                      <div>
                        <p className="text-xs text-slate-400">Cash</p>
                        <p className="font-semibold text-slate-100">{money(portfolio.cash || 0)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Total Value</p>
                        <p className="font-semibold text-slate-100">{money(portfolio.total_value || portfolio.starting_cash || 0)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Unrealized</p>
                        <p className={`font-semibold ${Number(portfolio.unrealized_pnl || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {Number(portfolio.unrealized_pnl || 0) >= 0 ? '+' : ''}{money(portfolio.unrealized_pnl || 0)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
            <div className="flex items-center gap-2">
              <ShieldAlert size={16} className="text-amber-300" />
              <h3 className="text-lg font-semibold">Add Simulated Holding</h3>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              Leave buy price blank to use the current market price. Leave buy date as-is to use today.
            </p>
            {!currentPortfolio ? (
              <p className="mt-3 text-sm text-slate-400">Create or select a simulated portfolio first.</p>
            ) : (
              <>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input className="input-modern" placeholder="Symbol" value={holdingSymbol} onChange={(e) => setHoldingSymbol(e.target.value)} />
                  <input className="input-modern" type="number" min="1" step="1" placeholder="Shares" value={holdingShares} onChange={(e) => setHoldingShares(e.target.value)} />
                  <input className="input-modern" type="number" step="0.01" placeholder="Buy price (blank = current price)" value={holdingBuyPrice} onChange={(e) => setHoldingBuyPrice(e.target.value)} />
                  <input className="input-modern" type="date" value={holdingBuyDate} onChange={(e) => setHoldingBuyDate(e.target.value)} />
                </div>
                <button onClick={() => void addHolding()} className="mt-3 btn-primary inline-flex items-center gap-2">
                  <Plus size={14} /> Add Holding to {currentPortfolio.name}
                </button>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/35 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Selected Portfolio Detail</h3>
              {currentPortfolio && (
                <button onClick={() => simPortfolioApi.remove(currentPortfolio.id).then(() => loadData())} className="text-xs text-rose-300 hover:text-rose-200 inline-flex items-center gap-1">
                  <Trash2 size={13} /> Delete Portfolio
                </button>
              )}
            </div>

            {!currentPortfolio ? (
              <p className="mt-3 text-sm text-slate-400">No portfolio selected.</p>
            ) : (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-slate-700/70 bg-slate-950/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Cash</p>
                    <p className="mt-1 font-semibold text-slate-100">{money(currentPortfolio.cash || 0)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-700/70 bg-slate-950/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Total Value</p>
                    <p className="mt-1 font-semibold text-slate-100">{money(currentPortfolio.total_value || 0)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-700/70 bg-slate-950/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Holdings</p>
                    <p className="mt-1 font-semibold text-slate-100">{currentPortfolio.holdings.length}</p>
                  </div>
                  <div className="rounded-xl border border-slate-700/70 bg-slate-950/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">PnL</p>
                    <p className={`mt-1 font-semibold ${portfolioPnLClass}`}>
                      {portfolioPnL >= 0 ? '+' : ''}{money(portfolioPnL)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-700 text-left text-slate-300">
                        <th className="py-2 pr-3">Symbol</th>
                        <th className="py-2 pr-3">Shares</th>
                        <th className="py-2 pr-3">Buy Price</th>
                        <th className="py-2 pr-3">Buy Date</th>
                        <th className="py-2 pr-3">Current</th>
                        <th className="py-2 pr-3">Market Value</th>
                        <th className="py-2 pr-3">P&L</th>
                        <th className="py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentPortfolio.holdings.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-4 text-slate-400">No holdings yet. Add your first lot above.</td>
                        </tr>
                      ) : (
                        currentPortfolio.holdings.map((holding) => (
                          <tr key={holding.id} className="border-b border-slate-800/70 text-slate-200">
                            <td className="py-2 pr-3 font-semibold text-cyan-100">{holding.symbol}</td>
                            <td className="py-2 pr-3">{Number(holding.shares).toLocaleString()}</td>
                            <td className="py-2 pr-3">{money(holding.buy_price)}</td>
                            <td className="py-2 pr-3">{holding.buy_date}</td>
                            <td className="py-2 pr-3">{money(holding.current_price)}</td>
                            <td className="py-2 pr-3">{money(holding.market_value)}</td>
                            <td className={`py-2 pr-3 ${Number(holding.unrealized_pnl || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                              {Number(holding.unrealized_pnl || 0) >= 0 ? '+' : ''}{money(holding.unrealized_pnl || 0)}
                            </td>
                            <td className="py-2">
                              <button onClick={() => void removeHolding(holding.id)} className="inline-flex items-center gap-1 text-xs text-rose-300 hover:text-rose-200">
                                <Trash2 size={13} /> Sell/Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>
        )}
      </div>
    </div>
  );
}
