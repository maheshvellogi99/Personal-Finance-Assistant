'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/utils/api';

// ── Types ───────────────────────────────────────────────────────────────
export interface BudgetItem {
  budget_id: string;
  category: string;
  budget_limit: number;
  spent_amount: number;
  percentage_used: number;
  remaining: number;
  period: string;
  status: 'ok' | 'warning' | 'exceeded' | 'on_track';
  start_date: string;
  end_date: string;
  alert_threshold_pct: number;
}

export interface BudgetStatusData {
  month: string;
  total_budget: number;
  total_spent: number;
  total_remaining: number;
  overall_percentage: number;
  budgets: BudgetItem[];
  alerts: string[];
}

// ── Category Config mapping icons and colors ────────────────────────────
interface CategoryStyle {
  label: string;
  icon: React.ReactNode;
  color: string;
}

const CATEGORY_CONFIG: Record<string, CategoryStyle> = {
  food: {
    label: 'Food & Dining',
    color: 'emerald',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
      </svg>
    )
  },
  entertainment: {
    label: 'Entertainment',
    color: 'purple',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
      </svg>
    )
  },
  transportation: {
    label: 'Transportation',
    color: 'blue',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
    )
  },
  utilities: {
    label: 'Utilities & Tech',
    color: 'amber',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    )
  },
  shopping: {
    label: 'Shopping',
    color: 'pink',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
      </svg>
    )
  },
  healthcare: {
    label: 'Healthcare',
    color: 'rose',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    )
  },
  housing: {
    label: 'Housing',
    color: 'indigo',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )
  },
  other: {
    label: 'Other',
    color: 'gray',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
      </svg>
    )
  }
};

const DEFAULT_CONFIG: CategoryStyle = {
  label: 'Unknown Category',
  color: 'gray',
  icon: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
};

interface BudgetProgressCardProps {
  /** If provided, uses this data instead of fetching from the API. */
  data?: BudgetStatusData;
  onEditBudget?: (budget: BudgetItem) => void;
  onAlertsSync?: (alerts: string[]) => void;
}

export default function BudgetProgressCard({ data: externalData, onEditBudget, onAlertsSync }: BudgetProgressCardProps) {
  const [budgetData, setBudgetData] = useState<BudgetStatusData | null>(externalData ?? null);
  const [loading, setLoading] = useState(!externalData);
  const [error, setError] = useState<string | null>(null);

  const fetchBudgetStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/budgets/status');
      if (res.ok) {
        const data = await res.json();
        setBudgetData(data);
      } else {
        // Fallback for demo/development if endpoint does not exist yet
        setBudgetData({
          month: 'Current Month',
          total_budget: 2500,
          total_spent: 1699.2,
          total_remaining: 800.8,
          overall_percentage: 67.9,
          budgets: [
            { budget_id: 'b1', category: 'food', budget_limit: 600, spent_amount: 480, percentage_used: 80, remaining: 120, period: 'monthly', status: 'warning', start_date: '2026-06-01', end_date: '2026-06-30', alert_threshold_pct: 80 },
            { budget_id: 'b2', category: 'housing', budget_limit: 1200, spent_amount: 850, percentage_used: 70.8, remaining: 350, period: 'monthly', status: 'ok', start_date: '2026-06-01', end_date: '2026-06-30', alert_threshold_pct: 80 },
            { budget_id: 'b3', category: 'entertainment', budget_limit: 250, spent_amount: 245.5, percentage_used: 98.2, remaining: 4.5, period: 'monthly', status: 'exceeded', start_date: '2026-06-01', end_date: '2026-06-30', alert_threshold_pct: 80 },
            { budget_id: 'b4', category: 'transportation', budget_limit: 200, spent_amount: 120, percentage_used: 60, remaining: 80, period: 'monthly', status: 'ok', start_date: '2026-06-01', end_date: '2026-06-30', alert_threshold_pct: 80 }
          ],
          alerts: [
            'Entertainment has reached 98.2% of its limit (₹4.50 remaining).',
            'Food & Dining has exceeded 80% threshold.'
          ]
        });
      }
    } catch (err) {
      setError('Network error. Unable to load budget thresholds.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!externalData) {
      fetchBudgetStatus();
    }
  }, [externalData]);

  // Extract alerts for event sync early, safely handling budgetData structure
  const currentAlerts = budgetData?.alerts;

  useEffect(() => {
    if (currentAlerts) {
      if (onAlertsSync) {
        onAlertsSync(currentAlerts);
      } else {
        window.dispatchEvent(new CustomEvent('sync-budget-alerts', { detail: currentAlerts }));
      }
    }
  }, [currentAlerts, onAlertsSync]);

  // Format currency helper
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);
  };

  const getProgressBarColor = (pct: number) => {
    if (pct >= 90) return 'bg-rose-500';
    if (pct >= 75) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  const getStatusBadge = (status: 'ok' | 'warning' | 'exceeded' | 'on_track') => {
    switch (status) {
      case 'exceeded':
        return { label: 'Exceeded', className: 'bg-rose-500/10 text-rose-400 border border-rose-500/20' };
      case 'warning':
        return { label: 'At Risk', className: 'bg-amber-500/10 text-amber-400 border border-amber-500/20' };
      default:
        return { label: 'On Track', className: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' };
    }
  };

  // ── Loading Skeleton ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div id="budget-progress-card-loading" className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 animate-pulse">
        <div className="h-4 bg-white/10 rounded w-1/3 mb-4" />
        <div className="h-10 bg-white/10 rounded w-full mb-6" />
        <div className="space-y-4">
          <div className="h-16 bg-white/10 rounded w-full" />
          <div className="h-16 bg-white/10 rounded w-full" />
        </div>
      </div>
    );
  }

  // ── Error State ───────────────────────────────────────────────────────
  if (error || !budgetData) {
    return (
      <div id="budget-progress-card-error" className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-6">
        <h2 className="text-sm font-bold text-rose-400 uppercase tracking-wider mb-1.5">System Notification</h2>
        <p className="text-xs text-rose-300">
          {error ?? 'Unable to load budget data.'}
        </p>
      </div>
    );
  }

  const { budgets = [], alerts = [], overall_percentage = 0, total_budget = 0, total_spent = 0, total_remaining = 0, month } = budgetData || {};

  // Count statuses
  const exceededCount = budgets.filter((b) => b.status === 'exceeded').length;
  const warningCount = budgets.filter((b) => b.status === 'warning').length;

  return (
    <div id="budget-progress-card" className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] hover:border-white/20 transition-all rounded-2xl h-full flex flex-col justify-between p-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="pb-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="budget-card-title" className="text-base font-bold text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Budget Tracker
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {month || 'Active Month'} • {budgets.length} active {budgets.length === 1 ? 'budget' : 'budgets'}
            </p>
          </div>

          {/* Summary badges */}
          <div className="flex items-center gap-2">
            {exceededCount > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                {exceededCount} Over
              </span>
            )}
            {warningCount > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {warningCount} At Risk
              </span>
            )}
          </div>
        </div>

        {/* Overall Progress (render only when budgets exist) */}
        {budgets.length > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs font-semibold mb-1.5">
              <span className="text-gray-400">
                Overall: {formatCurrency(total_spent)} of {formatCurrency(total_budget)}
              </span>
              <span className={`font-bold ${overall_percentage >= 90 ? 'text-rose-400' : overall_percentage >= 70 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {overall_percentage.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${getProgressBarColor(overall_percentage)}`}
                style={{ width: `${Math.min(overall_percentage, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-gray-500 mt-1">
              <span>{formatCurrency(total_remaining)} remaining</span>
              <span>{(100 - overall_percentage).toFixed(1)}% available</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Category Progress Bars / Empty State ─────────────────────── */}
      <div className="py-4 space-y-4 max-h-[350px] overflow-y-auto flex-1 bg-transparent">
        {budgets.length === 0 ? (
          /* Premium Empty State */
          <div className="text-center py-12 text-gray-500 select-none flex flex-col items-center justify-center h-full">
            <svg className="w-10 h-10 text-gray-500 mb-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-xs font-bold text-gray-400">No active budgets</p>
            <p className="text-[10px] text-gray-550 font-light mt-1 max-w-[180px] mx-auto leading-normal">
              Create a budget threshold in the API to start tracking your category-wise spending.
            </p>
          </div>
        ) : (
          budgets.map((budget) => {
            const config = CATEGORY_CONFIG[budget.category] ?? DEFAULT_CONFIG;
            const statusBadge = getStatusBadge(budget.status);
            const barColor = getProgressBarColor(budget.percentage_used);

            return (
              <div
                key={budget.budget_id}
                id={`budget-item-${budget.category}`}
                className={`rounded-lg p-3.5 transition-all duration-200 ${
                  budget.status === 'exceeded'
                    ? 'bg-rose-500/10 border border-rose-500/20'
                    : budget.status === 'warning'
                    ? 'bg-amber-500/10 border border-amber-500/20'
                    : 'bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04]'
                }`}
              >
                {/* Category Header Row */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded bg-white/[0.04] text-[#FF9900]">
                      {config.icon}
                    </div>
                    <span className="text-sm font-semibold text-white">
                      {config.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusBadge.className}`}>
                      {statusBadge.label}
                    </span>
                    {onEditBudget && (
                      <button
                        onClick={() => onEditBudget(budget)}
                        className="p-1.5 rounded text-gray-400 hover:text-[#FF9900] hover:bg-white/10 focus:outline-none transition-colors"
                        title="Edit Budget"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Amount Row */}
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-400">
                    {formatCurrency(budget.spent_amount)}
                    <span className="text-gray-500"> / </span>
                    <span className="font-light">{formatCurrency(budget.budget_limit)}</span>
                  </span>
                  <span className={`font-bold ${
                    budget.percentage_used >= 90
                      ? 'text-rose-400'
                      : budget.percentage_used >= 70
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}>
                    {budget.percentage_used.toFixed(1)}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out ${barColor}`}
                    style={{ width: `${Math.min(budget.percentage_used, 100)}%` }}
                  />
                </div>

                {/* Footer: Remaining + Warning */}
                <div className="flex justify-between text-[10px] mt-1.5">
                  <span className="text-gray-500">
                    {budget.remaining > 0
                      ? `${formatCurrency(budget.remaining)} remaining`
                      : 'Budget exhausted'}
                  </span>
                  {budget.percentage_used >= 90 && (
                    <span className="text-rose-400 font-bold uppercase tracking-wider flex items-center gap-0.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Alert
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Alerts Section ──────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="pt-2 flex-shrink-0">
          <div className="bg-white/[0.02] border border-[#FF9900]/20 rounded-lg p-3.5">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-[#FF9900] mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1.5">
                  Budget Alerts ({alerts.length})
                </p>
                <ul className="space-y-1">
                  {alerts.map((alert, idx) => (
                    <li key={idx} className="text-[11px] text-gray-300 leading-relaxed">
                      {alert}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
