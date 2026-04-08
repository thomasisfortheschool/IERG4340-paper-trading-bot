import { create } from 'zustand';

interface TradingStore {
  account: any;
  positions: any[];
  currentMode: string;
  config: any;
  selectedBroker: 'demo' | 'ibkr' | 'alpaca';
  refreshToken: number;
  setAccount: (account: any) => void;
  setPositions: (positions: any[]) => void;
  setCurrentMode: (mode: string) => void;
  setConfig: (config: any) => void;
  setSelectedBroker: (broker: 'demo' | 'ibkr' | 'alpaca') => void;
  bumpRefreshToken: () => void;
}

export const useTradingStore = create<TradingStore>((set) => ({
  account: null,
  positions: [],
  currentMode: 'balanced',
  config: null,
  selectedBroker: 'ibkr',
  refreshToken: 0,
  setAccount: (account) => set({ account }),
  setPositions: (positions) => set({ positions }),
  setCurrentMode: (currentMode) => set({ currentMode }),
  setConfig: (config) => set({ config }),
  setSelectedBroker: (selectedBroker) => set({ selectedBroker }),
  bumpRefreshToken: () => set((state) => ({ refreshToken: state.refreshToken + 1 })),
}));
