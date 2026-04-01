'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '@/store';
import { accountApi, configApi } from '@/lib/api';
import Dashboard from '@/components/Dashboard';
import Navbar from '@/components/Navbar';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const { setAccount, setCurrentMode } = useTradingStore();

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [accountRes, configRes] = await Promise.all([
          accountApi.getSnapshot(),
          configApi.getCurrent(),
        ]);
        
        setAccount(accountRes.data);
        setCurrentMode(configRes.data.mode || 'balanced');
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [setAccount, setCurrentMode]);

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
