'use client';

import { useEffect, useMemo, useState } from 'react';
import { botApi } from '@/lib/api';
import { Activity, RefreshCw, RadioTower, Search } from 'lucide-react';

type BotLogRow = {
  id: number;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | string;
  event: string;
  details?: Record<string, any>;
};

export default function BotLogPanel() {
  const [rows, setRows] = useState<BotLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [executionMode, setExecutionMode] = useState<'manual' | 'automatic' | string>('manual');

  const fetchLogs = async () => {
    try {
      const res = await botApi.getLogs(160);
      setRows(res.data?.logs || []);
      setRunning(Boolean(res.data?.meta?.bot_running));
      setExecutionMode(res.data?.meta?.execution_mode || 'manual');
      setError('');
    } catch (e) {
      console.error('Failed to fetch bot logs:', e);
      setError('Failed to load bot logs. Make sure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const timer = setInterval(fetchLogs, 5000);
    return () => clearInterval(timer);
  }, []);

  const latest = rows.length ? rows[rows.length - 1] : null;
  const statusLabel = useMemo(() => {
    if (!running) return 'Stopped';
    return executionMode === 'automatic' ? 'Running' : 'Ready';
  }, [running, executionMode]);

  const levelClass = (level: string) => {
    if (level === 'error') return 'border-rose-600/60 bg-rose-900/20 text-rose-200';
    if (level === 'warning') return 'border-amber-500/60 bg-amber-900/20 text-amber-200';
    return 'border-teal-500/50 bg-teal-900/15 text-teal-100';
  };

  if (loading) {
    return <div className="card text-center text-slate-300">Loading bot logs...</div>;
  }

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-600/70 px-3 py-1 text-xs text-slate-200">
              <Activity size={14} />
              Bot Status: <span className={running ? 'text-teal-200' : 'text-slate-300'}>{statusLabel}</span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-600/70 px-3 py-1 text-xs text-slate-200">
              <RadioTower size={14} />
              Mode: <span className="uppercase text-slate-100">{executionMode}</span>
              <span className="text-slate-400">|</span>
              Safety: <span className="text-amber-200">Live Orders</span>
            </div>
          </div>
          <button onClick={fetchLogs} className="btn-secondary inline-flex items-center gap-2">
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {latest && (
          <div className="mt-4 rounded-xl border border-slate-600/60 bg-slate-900/35 p-3 text-sm text-slate-200">
            <p className="text-xs text-slate-400 mb-1">Latest Event</p>
            <p className="font-semibold text-slate-100">{latest.event}</p>
            <p className="text-xs text-slate-400 mt-1">{new Date(latest.timestamp).toLocaleString()}</p>
          </div>
        )}
      </div>

      {error && <div className="card border border-rose-700/50 bg-rose-900/20 text-rose-200 text-sm">{error}</div>}

      <div className="card">
        <div className="mb-3 flex items-center gap-2 text-slate-100">
          <Search size={16} className="text-teal-300" />
          <h3 className="text-lg font-bold">Bot Activity Feed</h3>
        </div>

        {!rows.length ? (
          <p className="text-sm text-slate-300">No bot events yet. Start automatic mode to see scan and opportunity logs.</p>
        ) : (
          <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
            {rows
              .slice()
              .reverse()
              .map((row) => (
                <div key={row.id} className={`rounded-xl border p-3 ${levelClass(row.level)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{row.event}</p>
                    <p className="text-xs opacity-80">{new Date(row.timestamp).toLocaleString()}</p>
                  </div>
                  {row.details && Object.keys(row.details).length > 0 && (
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs opacity-90">
                      {JSON.stringify(row.details, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
