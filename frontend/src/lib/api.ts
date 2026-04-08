import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const accountApi = {
  getSnapshot: () => api.get('/account'),
  getPositions: () => api.get('/positions'),
  getHistory: (days: number = 30) => api.get(`/portfolio-history?days=${days}`),
};

export const configApi = {
  getCurrent: () => api.get('/config/current'),
  getPresets: () => api.get('/config/presets'),
  update: (config: any) => api.post('/config/update', config),
  setMode: (mode: string) => api.post('/mode/set', { mode }),
};

export const screeningApi = {
  blowupStocks: (params?: Record<string, string | number>) => api.get('/screen/blowup-stocks', { params }),
  coveredCalls: () => api.get('/screen/covered-calls'),
  forex: () => api.get('/screen/forex'),
};

export const tradingApi = {
  placeOrder: (symbol: string, side: string, quantity: number, confirmLive: boolean = false) =>
    api.post('/trade/place-order', { symbol, side, quantity, confirm_live: confirmLive }),
  cancelOrder: (orderId: string) => api.post(`/trade/cancel-order/${orderId}`),
  getLogs: (params?: { days?: number; assetType?: string; status?: string }) => {
    const days = params?.days ?? 30;
    const assetType = params?.assetType ?? 'all';
    const status = params?.status ?? 'all';
    return api.get(
      `/trade/logs?days=${days}&asset_type=${encodeURIComponent(assetType)}&status=${encodeURIComponent(status)}`
    );
  },
  tryBuySell: (
    rounds: number = 6,
    quantity: number = 2000,
    mode: 'simulated' | 'live_paper' = 'simulated',
    confirmLive: boolean = false
  ) => api.post('/trade/try-buy-sell', { rounds, quantity, mode, confirm_live: confirmLive }),
};

export const tickerApi = {
  research: (
    symbol: string,
    market: 'us' | 'hk' | 'jp' | 'kr' = 'us',
    period: '1m' | '3m' | '6m' | '1y' | '5y' = '1y',
    interval: '1d' | '1h' | '30m' | '15m' | '5m' | '1wk' = '1d'
  ) =>
    api.get(
      `/ticker/research?symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(market)}&period=${encodeURIComponent(period)}&interval=${encodeURIComponent(interval)}`
    ),
};

export const brokerApi = {
  getOptions: () => api.get('/broker/options'),
  switch: (broker: string, config: any = {}) => api.post('/broker/switch', { broker, config }),
};

export const statusApi = {
  getBrokerStatus: () => api.get('/status/broker'),
  getHealth: () => api.get('/status/health'),
};

export const botApi = {
  getStatus: () => api.get('/bot/status'),
  getLogs: (limit: number = 120) => api.get(`/bot/logs?limit=${limit}`),
  setExecutionSafety: (dryRun: boolean) => api.post('/bot/execution', { dry_run: dryRun }),
  setMode: (mode: 'manual' | 'automatic', autoStart: boolean = false, intervalSeconds: number = 60) =>
    api.post('/bot/mode', { mode, auto_start: autoStart, interval_seconds: intervalSeconds }),
  start: (intervalSeconds: number = 60) => api.post('/bot/start', { interval_seconds: intervalSeconds }),
  stop: () => api.post('/bot/stop', {}),
};

// Enhanced Features APIs
export const strategyApi = {
  getConfig: (strategyName: string) => api.get(`/strategy/config/${strategyName}`),
  updateConfig: (strategyName: string, config: any) =>
    api.post(`/strategy/config/${strategyName}`, config),
  getDefaults: () => api.get('/strategy/defaults'),
};

export const backtestApi = {
  run: (symbol: string, strategy: string, lookbackDays: number = 252) =>
    api.get(`/backtest/${symbol}/${strategy}?lookback_days=${lookbackDays}`),
};

export const signalApi = {
  createWithMetadata: (
    symbol: string,
    signalType: 'buy' | 'sell' | 'hold',
    metadata: any
  ) =>
    api.post('/signal/metadata', {
      symbol,
      signal_type: signalType,
      ...metadata,
    }),
};

export const marketApi = {
  getRegime: () => api.get('/market-regime'),
  getPerformanceByRegime: (strategy: string = 'blowup_stocks') =>
    api.get(`/performance/by-regime?strategy=${strategy}`),
};

export const riskApi = {
  getPositionRisks: () => api.get('/positions/risks'),
};
