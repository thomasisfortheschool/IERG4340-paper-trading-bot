import { create } from 'zustand';

interface TradingStore {
  account: any;
  positions: any[];
  currentMode: string;
  config: any;
  selectedBroker: 'ibkr' | 'alpaca';
  activeTab: string;
  forexAuditFocus: 'all' | 'blowup' | 'covered_call' | 'forex_grid';
  refreshToken: number;
  setAccount: (account: any) => void;
  setPositions: (positions: any[]) => void;
  setCurrentMode: (mode: string) => void;
  setConfig: (config: any) => void;
  setSelectedBroker: (broker: 'ibkr' | 'alpaca') => void;
  setActiveTab: (tab: string) => void;
  setForexAuditFocus: (focus: 'all' | 'blowup' | 'covered_call' | 'forex_grid') => void;
  bumpRefreshToken: () => void;
}

export const useTradingStore = create<TradingStore>((set) => ({
  account: null,
  positions: [],
  currentMode: 'balanced',
  config: null,
  selectedBroker: 'ibkr',
  activeTab: 'home',
  forexAuditFocus: 'all',
  refreshToken: 0,
  setAccount: (account) => set({ account }),
  setPositions: (positions) => set({ positions }),
  setCurrentMode: (currentMode) => set({ currentMode }),
  setConfig: (config) => set({ config }),
  setSelectedBroker: (selectedBroker) => set({ selectedBroker }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setForexAuditFocus: (forexAuditFocus) => set({ forexAuditFocus }),
  bumpRefreshToken: () => set((state) => ({ refreshToken: state.refreshToken + 1 })),
}));
