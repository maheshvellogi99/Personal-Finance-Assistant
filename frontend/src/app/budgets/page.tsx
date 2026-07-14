'use client';

import React, { useState } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import DashboardLayout from '@/components/DashboardLayout';
import BudgetProgressCard, { BudgetItem } from '@/components/BudgetProgressCard';
import { apiFetch } from '@/utils/api';

const CATEGORIES_MAP = [
  { value: 'food', label: 'Food & Dining' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'transportation', label: 'Transportation' },
  { value: 'utilities', label: 'Utilities & Tech' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'housing', label: 'Housing' },
  { value: 'other', label: 'Other' }
];

interface RecommendationItem {
  category: string;
  historical_average: number;
  suggested_limit: number;
  total_spent_90_days: number;
}

export default function BudgetsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  // AI recommendations state
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplyingRec, setIsApplyingRec] = useState<string | null>(null);

  // Form State
  const [category, setCategory] = useState('food');
  const [limit, setLimit] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
  });
  const [threshold, setThreshold] = useState('80');

  const handleEditBudget = (budget: BudgetItem) => {
    setCategory(budget.category);
    setLimit(budget.budget_limit.toString());
    setStartDate(budget.start_date);
    setEndDate(budget.end_date);
    setThreshold(budget.alert_threshold_pct.toString());
    setIsEditing(true);
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!limit || parseFloat(limit) <= 0) {
      setErrorMsg('Please enter a budget limit greater than ₹0.');
      setSuccessMsg(null);
      return;
    }

    if (new Date(endDate) <= new Date(startDate)) {
      setErrorMsg('End Date must be strictly after Start Date.');
      setSuccessMsg(null);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload = {
        category,
        budget_limit: parseFloat(limit),
        period: 'monthly',
        start_date: startDate,
        end_date: endDate,
        alert_threshold_pct: parseFloat(threshold)
      };

      const res = await apiFetch('/budgets/', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setSuccessMsg(
          isEditing
            ? `Successfully updated budget for ${CATEGORIES_MAP.find(c => c.value === category)?.label}!`
            : `Successfully created budget for ${CATEGORIES_MAP.find(c => c.value === category)?.label}!`
        );
        setLimit('');
        setIsEditing(false); // Reset edit mode
        setRefreshKey(prev => prev + 1); // Trigger automatic budget tracker reload
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Failed to update/create budget rule.');
      }
    } catch (err) {
      setErrorMsg('Network error. Failed to connect to budget manager.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setLimit('');
    setCategory('food');
    setStartDate(() => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    });
    setEndDate(() => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
    });
    setThreshold('80');
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  // Trigger AI auto-generation recommendation analysis
  const handleAutoGenerate = async () => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await apiFetch('/budgets/auto-generate', {
        method: 'POST'
      });

      if (res.ok) {
        const data = await res.json();
        if (data.recommendations && data.recommendations.length > 0) {
          setRecommendations(data.recommendations);
          setSuccessMsg(data.message || 'AI recommendations generated based on historical transactions.');
        } else {
          setErrorMsg(data.message || 'No sufficient transaction history found to perform budget analysis.');
        }
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Failed to run AI budget recommendation analysis.');
      }
    } catch (err) {
      setErrorMsg('Network error connecting to the AI budget recommendation engine.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Commit individual AI recommendation
  const handleApplyRecommendation = async (rec: RecommendationItem) => {
    setIsApplyingRec(rec.category);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload = {
        category: rec.category,
        budget_limit: rec.suggested_limit,
        period: 'monthly',
        start_date: startDate,
        end_date: endDate,
        alert_threshold_pct: parseFloat(threshold)
      };

      const res = await apiFetch('/budgets/', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setSuccessMsg(`Successfully accepted & configured ₹${rec.suggested_limit} budget limit for ${CATEGORIES_MAP.find(c => c.value === rec.category)?.label}.`);
        // Remove from staging state
        setRecommendations(prev => prev.filter(r => r.category !== rec.category));
        setRefreshKey(prev => prev + 1); // Live-reload budget progress card
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Failed to apply recommended budget limit.');
      }
    } catch (err) {
      setErrorMsg('Network error. Failed to commit recommendation.');
    } finally {
      setIsApplyingRec(null);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);
  };

  return (
    <ProtectedRoute>
      <DashboardLayout>
        {/* Header Row */}
        <div id="budgets-header" className="pb-6">
          <h1 className="text-2xl font-bold tracking-tight text-white">AWS Budget Manager</h1>
          <p className="text-sm text-gray-400 mt-1">
            Configure spending constraints, warnings, and track category-wise limits.
          </p>
        </div>

        {/* Content Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Creation Form Card */}
          <div className="lg:col-span-1 bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 text-white">
            <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              {isEditing ? 'Update Limit Threshold' : 'Establish Limit Threshold'}
            </h2>

            {/* AI Budget Auto Generation Trigger */}
            {!isEditing && (
              <button
                type="button"
                onClick={handleAutoGenerate}
                disabled={isAnalyzing}
                className="w-full mb-4 py-2.5 px-4 rounded font-bold text-xs bg-gradient-to-r from-[#FF9900] to-[#FFB84D] text-black hover:from-[#EC7211] hover:to-[#FF9900] shadow-md transition-all active:scale-98 flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
              >
                {isAnalyzing ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-black" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Analyzing 90-day history...</span>
                  </>
                ) : (
                  <span>✨ Auto-Generate with AI</span>
                )}
              </button>
            )}

            {errorMsg && (
              <div className="bg-rose-500/10 border-l-4 border-rose-500 p-3 rounded mb-4 animate-fade-in">
                <p className="text-xs font-bold text-rose-400 uppercase tracking-wider">Configuration Alert</p>
                <p className="text-xs text-rose-350 mt-0.5">{errorMsg}</p>
              </div>
            )}

            {successMsg && (
              <div className="bg-emerald-500/10 border-l-4 border-emerald-500 p-3 rounded mb-4 animate-fade-in">
                <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Success</p>
                <p className="text-xs text-emerald-350 mt-0.5">{successMsg}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Category */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Category</label>
                <select
                  value={category}
                  disabled={isEditing} // Category is key for upsert
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FF9900] font-medium disabled:bg-white/[0.02] disabled:text-gray-500"
                >
                  {CATEGORIES_MAP.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount Limit */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Budget Limit (INR)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 font-semibold text-sm">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="0.00"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    className="w-full border border-white/10 bg-black/50 rounded px-3 py-2 pl-7 text-sm text-white focus:outline-none focus:border-[#FF9900] font-medium"
                  />
                </div>
              </div>

              {/* Start Date */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Start Date</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full border border-white/10 bg-black/50 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FF9900] font-medium"
                />
              </div>

              {/* End Date */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">End Date</label>
                <input
                  type="date"
                  required
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full border border-white/10 bg-black/50 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FF9900] font-medium"
                />
              </div>

              {/* Alert Warning Threshold percentage */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Alert Threshold (%)</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  required
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="w-full border border-white/10 bg-black/50 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#FF9900] font-medium"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">Notify when category spending exceeds this percentage.</span>
              </div>

              {/* Submit / Cancel CTAs */}
              <div className="space-y-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 px-4 rounded font-bold text-sm bg-[#FF9900] text-black hover:bg-[#EC7211] shadow-sm transition-colors cursor-pointer flex items-center justify-center space-x-1.5 disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-black" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Saving Budget...</span>
                    </>
                  ) : (
                    <span>{isEditing ? 'Update Budget Rule' : 'Establish Budget Rule'}</span>
                  )}
                </button>

                {isEditing && (
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="w-full py-2 px-4 rounded font-semibold text-xs border border-white/10 hover:bg-white/10 text-gray-300 transition-colors"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Right side: AI proposals and tracker display */}
          <div className="lg:col-span-2 space-y-8">
            {/* AI Budget Proposals Staging Area */}
            {recommendations && recommendations.length > 0 && (
              <div id="ai-budget-proposals" className="bg-white/[0.03] backdrop-blur-xl border border-[#FF9900]/30 rounded-2xl p-6 text-white animate-fade-in">
                <div className="flex items-center justify-between border-b border-white/10 pb-3.5 mb-4">
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#FF9900] animate-pulse"></span>
                      ✨ AI Budget Proposals
                    </h2>
                    <p className="text-xs text-gray-400 mt-1">
                      Historical averages from past 90 days + 10% safety buffer, rounded to the nearest ₹100.
                    </p>
                  </div>
                  <button
                    onClick={() => setRecommendations([])}
                    className="text-gray-400 hover:text-white hover:bg-white/10 p-1.5 rounded-lg focus:outline-none transition-colors"
                    title="Dismiss Suggestions"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-white/10 bg-white/[0.01]">
                        <th className="py-2.5 px-2">Category</th>
                        <th className="py-2.5 px-2">Historical Monthly Avg</th>
                        <th className="py-2.5 px-2 text-[#FF9900]">AI Suggested Limit</th>
                        <th className="py-2.5 px-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {recommendations.map((rec) => (
                        <tr key={rec.category} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 px-2 font-semibold text-white">
                            {CATEGORIES_MAP.find(c => c.value === rec.category)?.label || rec.category}
                          </td>
                          <td className="py-3 px-2 text-gray-300 font-medium">
                            {formatCurrency(rec.historical_average)}
                          </td>
                          <td className="py-3 px-2 font-extrabold text-[#FF9900]">
                            {formatCurrency(rec.suggested_limit)}
                          </td>
                          <td className="py-3 px-2 text-right">
                            <button
                              onClick={() => handleApplyRecommendation(rec)}
                              disabled={isApplyingRec === rec.category}
                              className="px-3.5 py-1.5 rounded text-[11px] font-bold bg-white/10 text-white hover:bg-[#FF9900] hover:text-black transition-all cursor-pointer disabled:opacity-50"
                            >
                              {isApplyingRec === rec.category ? (
                                <svg className="animate-spin h-3.5 w-3.5 mx-auto text-white" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                              ) : (
                                'Accept & Apply'
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <BudgetProgressCard key={refreshKey} onEditBudget={handleEditBudget} />
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
