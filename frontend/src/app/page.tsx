'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '@/store';
import { accountApi, configApi, statusApi } from '@/lib/api';
import Dashboard from '@/components/Dashboard';
import Navbar from '@/components/Navbar';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const { setAccount, setCurrentMode, setSelectedBroker } = useTradingStore();

  useEffect(() => {
    const fetchInitialData = async () => {
      setSelectedBroker('ibkr');

      const [accountRes, configRes, brokerRes] = await Promise.allSettled([
        accountApi.getSnapshot(),
        configApi.getCurrent(),
        statusApi.getBrokerStatus(),
      ]);

      if (accountRes.status === 'fulfilled') {
        setAccount(accountRes.value.data);
      }

      if (configRes.status === 'fulfilled') {
        setCurrentMode(configRes.value.data?.mode || 'balanced');
      }

      if (brokerRes.status === 'fulfilled') {
        const brokerName = String(brokerRes.value.data?.broker || 'ibkr').toLowerCase();
        const normalized = brokerName.includes('ibkr') ? 'ibkr' : brokerName.includes('alpaca') ? 'alpaca' : 'ibkr';
        setSelectedBroker(normalized);
      }

      setLoading(false);
    };

    void fetchInitialData().finally(() => setLoading(false));
  }, [setAccount, setCurrentMode, setSelectedBroker]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="card max-w-md w-full text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-teal-300" />
          <p className="text-lg font-semibold">Preparing your trading workspace</p>
          <p className="text-sm text-slate-300 mt-1">Syncing account, positions, and strategy settings...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen">
      <Navbar />
      <Dashboard />
    </main>
  );
}
