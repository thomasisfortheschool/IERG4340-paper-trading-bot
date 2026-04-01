import { create } from 'zustand';

interface TradingStore {
  account: any;
  positions: any[];
  currentMode: string;
  config: any;
  setAccount: (account: any) => void;
  setPositions: (positions: any[]) => void;
  setCurrentMode: (mode: string) => void;
  setConfig: (config: any) => void;
}

export const useTradingStore = create<TradingStore>((set) => ({
  account: null,
  positions: [],
  currentMode: 'balanced',
  config: null,
  setAccount: (account) => set({ account }),
  setPositions: (positions) => set({ positions }),
  setCurrentMode: (currentMode) => set({ currentMode }),
  setConfig: (config) => set({ config }),
}));
