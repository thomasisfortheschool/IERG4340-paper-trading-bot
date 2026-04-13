'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '@/store';
import { accountApi, configApi, statusApi } from '@/lib/api';
import Dashboard from '@/components/Dashboard';
import Navbar from '@/components/Navbar';

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const { setAccount, setCurrentMode, setSelectedBroker } = useTradingStore();

  const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('request timeout')), ms);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  };

  useEffect(() => {
    let canceled = false;

    const fetchInitialData = async () => {
      setStartupError('');
      setSelectedBroker('ibkr');

      const [accountRes, configRes, brokerRes] = await Promise.allSettled([
        withTimeout(accountApi.getSnapshot(), 8000),
        withTimeout(configApi.getCurrent(), 8000),
        withTimeout(statusApi.getBrokerStatus(), 8000),
      ]);

      if (canceled) return;

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

      const failed = [accountRes, configRes, brokerRes].filter((res) => res.status === 'rejected').length;
      if (failed === 3) {
        setStartupError('Cannot reach backend startup APIs. Confirm your phone can access backend port 5000 on this PC, then retry.');
      }

      setLoading(false);
    };

    void fetchInitialData().finally(() => {
      if (!canceled) {
        setLoading(false);
      }
    });

    return () => {
      canceled = true;
    };
  }, [setAccount, setCurrentMode, setSelectedBroker, retryToken]);

  if (loading || startupError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="card max-w-md w-full text-center">
          {loading ? (
            <>
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-teal-300" />
              <p className="text-lg font-semibold">Preparing your trading workspace</p>
              <p className="text-sm text-slate-300 mt-1">Syncing account, positions, and strategy settings...</p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-rose-200">Startup Connection Failed</p>
              <p className="text-sm text-slate-300 mt-1">{startupError}</p>
              <button
                onClick={() => {
                  setStartupError('');
                  setLoading(true);
                  setRetryToken((v) => v + 1);
                }}
                className="btn-primary mt-4"
              >
                Retry Startup
              </button>
            </>
          )}
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
