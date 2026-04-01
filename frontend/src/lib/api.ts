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
  blowupStocks: () => api.get('/screen/blowup-stocks'),
  coveredCalls: () => api.get('/screen/covered-calls'),
  forex: () => api.get('/screen/forex'),
};

export const tradingApi = {
  placeOrder: (symbol: string, side: string, quantity: number) =>
    api.post('/trade/place-order', { symbol, side, quantity }),
  cancelOrder: (orderId: string) => api.post(`/trade/cancel-order/${orderId}`),
};

export const tickerApi = {
  research: (symbol: string) => api.get(`/ticker/research?symbol=${encodeURIComponent(symbol)}`),
};

export const brokerApi = {
  getOptions: () => api.get('/broker/options'),
  switch: (broker: string, config: any = {}) => api.post('/broker/switch', { broker, config }),
};

export const statusApi = {
  getBrokerStatus: () => api.get('/status/broker'),
};
