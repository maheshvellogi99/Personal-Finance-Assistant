'use client';

import React, { useState, useEffect } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import DashboardLayout from '@/components/DashboardLayout';
import { apiFetch } from '@/utils/api';
import { Playfair_Display, Inter } from 'next/font/google';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

interface ProjectionPoint {
  month_label: string;
  base_balance: number;
  what_if_balance: number;
}

interface WhatIfResponse {
  points: ProjectionPoint[];
  base_months_to_goal: number;
  what_if_months_to_goal: number;
  months_saved: number;
  is_unreachable: boolean;
}

interface SavingsGoal {
  id: string;
  goal_name: string;
  target_amount: number;
  current_amount: number;
  target_date: string;
  monthly_contribution?: number;
  ai_monthly_suggestion?: number;
  description?: string;
  currency?: string;
}

export default function SavingsPage() {
  const [mounted, setMounted] = useState(false);

  // Form Inputs for Simulator
  const [currentAmount, setCurrentAmount] = useState<number>(50000);
  const [targetAmount, setTargetAmount] = useState<number>(500000);
  const [monthlyContribution, setMonthlyContribution] = useState<number>(10000);
  const [additionalContribution, setAdditionalContribution] = useState<number>(5000);

  // Response Projection Data
  const [projectionData, setProjectionData] = useState<WhatIfResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active Goals State
  const [savedGoals, setSavedGoals] = useState<SavingsGoal[]>([]);
  const [loadingGoals, setLoadingGoals] = useState(false);

  // Glassmorphic Modal State (Create / Edit)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [modalGoalName, setModalGoalName] = useState('');
  const [modalTargetAmount, setModalTargetAmount] = useState<number>(0);
  const [modalMonthlyContribution, setModalMonthlyContribution] = useState<number>(0);
  const [modalTargetDate, setModalTargetDate] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Glassmorphic Funding Modal State
  const [isFundModalOpen, setIsFundModalOpen] = useState(false);
  const [activeFundGoalId, setActiveFundGoalId] = useState<string | null>(null);
  const [activeFundGoalName, setActiveFundGoalName] = useState('');
  const [fundAmount, setFundAmount] = useState('');
  const [isFunding, setIsFunding] = useState(false);

  // Glassmorphic Delete Confirmation Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [goalToDelete, setGoalToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetchSavedGoals();
  }, []);

  const fetchProjection = async () => {
    if (currentAmount >= targetAmount) {
      setErrorMsg('Current balance must be less than your target savings goal.');
      setProjectionData(null);
      return;
    }
    if (monthlyContribution <= 0 && additionalContribution <= 0) {
      setErrorMsg('At least one contribution (base or additional) must be greater than zero.');
      setProjectionData(null);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const payload = {
        current_amount: currentAmount,
        target_amount: targetAmount,
        monthly_contribution: monthlyContribution,
        additional_contribution: additionalContribution,
      };

      const res = await apiFetch('/savings/what-if', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setProjectionData(data);
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Failed to calculate savings timeline.');
      }
    } catch (err) {
      setErrorMsg('Network error. Failed to connect to savings projection engine.');
    } finally {
      setLoading(false);
    }
  };

  const fetchSavedGoals = async () => {
    setLoadingGoals(true);
    try {
      const res = await apiFetch('/savings/');
      if (res.ok) {
        const data = await res.json();
        setSavedGoals(data || []);
      }
    } catch (err) {
      console.error('Failed to load savings goal cards:', err);
    } finally {
      setLoadingGoals(false);
    }
  };

  // Re-fetch projection when inputs change
  useEffect(() => {
    fetchProjection();
  }, [currentAmount, targetAmount, monthlyContribution, additionalContribution]);

  const openCreateGoalModal = () => {
    if (!projectionData) return;
    const months = projectionData.base_months_to_goal > 0 ? projectionData.base_months_to_goal : 120;
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + months);
    const targetDateString = targetDate.toISOString().split('T')[0];

    setModalMode('create');
    setEditingGoalId(null);
    setModalGoalName('');
    setModalTargetAmount(targetAmount);
    setModalMonthlyContribution(monthlyContribution);
    setModalTargetDate(targetDateString);
    setIsModalOpen(true);
  };

  const openEditGoalModal = (goal: SavingsGoal) => {
    setModalMode('edit');
    setEditingGoalId(goal.id);
    setModalGoalName(goal.goal_name);
    setModalTargetAmount(goal.target_amount);
    setModalMonthlyContribution(goal.monthly_contribution ?? goal.ai_monthly_suggestion ?? 0);
    setModalTargetDate(goal.target_date ? goal.target_date.split('T')[0] : '');
    setIsModalOpen(true);
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload = {
        goal_name: modalGoalName.trim(),
        target_amount: modalTargetAmount,
        target_date: modalTargetDate,
        monthly_contribution: modalMonthlyContribution,
      };

      let res;
      if (modalMode === 'create') {
        res = await apiFetch('/savings/', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } else {
        res = await apiFetch(`/savings/${editingGoalId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }

      if (res.ok) {
        setSuccessMsg(
          modalMode === 'create'
            ? 'Successfully created savings goal!'
            : 'Successfully updated savings goal!'
        );
        setIsModalOpen(false);
        fetchSavedGoals();
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Failed to save savings goal.');
      }
    } catch (err) {
      setErrorMsg('Network error. Failed to save savings goal.');
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!goalToDelete) return;
    setIsDeleting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await apiFetch(`/savings/${goalToDelete}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setSuccessMsg('Successfully deleted savings goal.');
        setIsDeleteModalOpen(false);
        setGoalToDelete(null);
        fetchSavedGoals();
      } else {
        setErrorMsg('Failed to delete savings goal.');
      }
    } catch (err) {
      setErrorMsg('Network error. Failed to delete savings goal.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Fund management triggers
  const openFundGoalModal = (goal: SavingsGoal) => {
    setActiveFundGoalId(goal.id);
    setActiveFundGoalName(goal.goal_name);
    setFundAmount('');
    setIsFundModalOpen(true);
  };

  const handleFundGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFundGoalId || !fundAmount || parseFloat(fundAmount) <= 0) {
      setErrorMsg('Please enter a valid deposit amount greater than zero.');
      return;
    }

    setIsFunding(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await apiFetch(`/savings/${activeFundGoalId}/fund`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(fundAmount) }),
      });

      if (res.ok) {
        setSuccessMsg(`Funds securely deposited to "${activeFundGoalName}"!`);
        setIsFundModalOpen(false);
        fetchSavedGoals();
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Failed to complete savings deposit.');
      }
    } catch (err) {
      setErrorMsg('Network error. Failed to execute deposit transaction.');
    } finally {
      setIsFunding(false);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val);
  };

  return (
    <ProtectedRoute>
      <DashboardLayout>
        {/* Header Title */}
        <div id="savings-planner-header" className="pb-6">
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <svg className="w-6 h-6 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Savings "What-If" Planner
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Simulate how optimizing expenses accelerates your timeline to hit financial milestones.
          </p>
        </div>

        {/* Notifications and Alerts */}
        {errorMsg && (
          <div className="bg-rose-500/10 border-l-4 border-rose-500 p-3.5 rounded mb-6 animate-fade-in text-white flex items-start">
            <svg className="w-5 h-5 text-rose-400 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-xs font-bold text-rose-400 uppercase tracking-wider">Simulation Warning</p>
              <p className="text-xs text-rose-250 mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-500/10 border-l-4 border-emerald-500 p-3.5 rounded mb-6 animate-fade-in text-white flex items-start">
            <svg className="w-5 h-5 text-emerald-400 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Success Log</p>
              <p className="text-xs text-emerald-250 mt-0.5">{successMsg}</p>
            </div>
          </div>
        )}

        {/* Hero Acceleration Banner */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 mb-8 text-center relative overflow-hidden">
          {/* Accent radial gold glow */}
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-80 h-80 bg-[#FF9900]/10 rounded-full blur-3xl pointer-events-none" />

          {projectionData && projectionData.is_unreachable ? (
            <div className="relative z-10 bg-red-500/10 border border-red-500/30 text-red-200 p-4 rounded-xl flex items-center justify-center space-x-2">
              <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-xs md:text-sm font-medium">
                This financial target is out of bounds for your current baseline rate. Try adjusting your baseline contribution upward or lowering your target goal.
              </span>
            </div>
          ) : projectionData && projectionData.months_saved > 0 ? (
            <div className="space-y-1.5 relative z-10">
              <span className="text-[10px] font-bold text-[#FF9900] uppercase tracking-wider block">Timeline Accelerated</span>
              <h2 className={`text-2xl md:text-3xl font-extrabold text-white tracking-tight ${playfair.className}`}>
                You will reach your goal{' '}
                <span className="text-[#FF9900] underline decoration-[#FF9900]/30">
                  {projectionData.months_saved} {projectionData.months_saved === 1 ? 'month' : 'months'}
                </span>{' '}
                faster!
              </h2>
              <p className="text-xs text-gray-400">
                Baseline hits goal in {projectionData.base_months_to_goal} months. Accelerated path hits in {projectionData.what_if_months_to_goal} months.
              </p>
            </div>
          ) : (
            <div className="space-y-1 relative z-10">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Simulation Offline</span>
              <h2 className={`text-xl md:text-2xl font-bold text-gray-300 ${playfair.className}`}>
                Adjust the slider to see your accelerated timeline.
              </h2>
              <p className="text-xs text-gray-500">
                Increasing your "What-If" contribution cuts down target goal achievement times.
              </p>
            </div>
          )}
        </div>

        {/* Grid Split Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Controls Card */}
          <div className="lg:col-span-1 bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 text-white space-y-6">
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                Simulation Parameters
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Define your goal scope and current savings metrics.</p>
            </div>

            <div className="space-y-4">
              {/* Current Amount */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Current Balance</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 font-semibold text-sm">₹</span>
                  <input
                    type="number"
                    min="0"
                    required
                    value={currentAmount}
                    onChange={(e) => setCurrentAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full border border-white/10 bg-black/50 rounded px-3 py-2 pl-7 text-sm text-white focus:outline-none focus:border-[#FF9900] font-medium font-mono"
                  />
                </div>
              </div>

              {/* Target Goal */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Target Goal</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 font-semibold text-sm">₹</span>
                  <input
                    type="number"
                    min="1"
                    required
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(Math.max(1, parseFloat(e.target.value) || 1))}
                    className="w-full border border-white/10 bg-black/50 rounded px-3 py-2 pl-7 text-sm text-white focus:outline-none focus:border-[#FF9900] font-medium font-mono"
                  />
                </div>
              </div>

              {/* Monthly Contribution */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Base Monthly Contribution</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-400 font-semibold text-sm">₹</span>
                  <input
                    type="number"
                    min="0"
                    required
                    value={monthlyContribution}
                    onChange={(e) => setMonthlyContribution(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full border border-white/10 bg-black/50 rounded px-3 py-2 pl-7 text-sm text-white focus:outline-none focus:border-[#FF9900] font-medium font-mono"
                  />
                </div>
              </div>

              {/* What-If Slider */}
              <div className="border-t border-white/10 pt-4 pb-2">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider">
                    What-If Additional Contribution
                  </label>
                  <span className="text-xs font-extrabold text-[#FF9900] font-mono">
                    +{formatCurrency(additionalContribution)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50000"
                  step="500"
                  value={additionalContribution}
                  onChange={(e) => setAdditionalContribution(parseInt(e.target.value) || 0)}
                  className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF9900]"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">
                  Simulate reallocation (e.g. cutting dining budgets, subscriptions).
                </span>
              </div>

              {/* Save Goal Button */}
              <button
                type="button"
                onClick={openCreateGoalModal}
                disabled={loading || !projectionData || projectionData.is_unreachable}
                className="w-full py-2.5 px-4 rounded font-bold text-xs bg-gradient-to-r from-[#FF9900] to-[#FFB84D] text-black hover:from-[#EC7211] hover:to-[#FF9900] shadow-md transition-all active:scale-98 flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                <span>Save Goal to Dashboard</span>
              </button>
            </div>
          </div>

          {/* Area Chart Card */}
          <div className="lg:col-span-2 bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 text-white min-h-[400px] flex flex-col justify-between">
            <div className="flex justify-between items-center border-b border-white/10 pb-3 mb-4">
              <div>
                <h3 className="font-bold text-sm text-white">Savings Projection Timelines</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">Month-by-month trajectory towards your savings target.</p>
              </div>
              {loading && (
                <div className="flex items-center space-x-1.5">
                  <svg className="animate-spin h-3.5 w-3.5 text-[#FF9900]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-[10px] text-gray-400">Computing...</span>
                </div>
              )}
            </div>

            {/* Recharts chart area guarded with mounted state to prevent hydration errors */}
            <div className="flex-1 w-full min-h-[300px]">
              {mounted && projectionData && projectionData.points.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart
                    data={projectionData.points}
                    margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorWhatIf" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FF9900" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#FF9900" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorBase" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4B5563" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#4B5563" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.06)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="month_label"
                      stroke="#9CA3AF"
                      fontSize={10}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#9CA3AF"
                      fontSize={10}
                      tickLine={false}
                      tickFormatter={(v) => formatCurrency(v)}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#000',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderRadius: '8px',
                        fontSize: '11px',
                        color: '#FFF'
                      }}
                      formatter={(value: any) => [formatCurrency(Number(value)), '']}
                    />
                    <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                    <Area
                      type="monotone"
                      name="Accelerated Path"
                      dataKey="what_if_balance"
                      stroke="#FF9900"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorWhatIf)"
                    />
                    <Area
                      type="monotone"
                      name="Baseline Path"
                      dataKey="base_balance"
                      stroke="#4B5563"
                      strokeWidth={1.5}
                      fillOpacity={1}
                      fill="url(#colorBase)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-gray-500 font-medium">
                  {errorMsg ? 'Invalid simulation scope parameters.' : 'Loading projection timeline...'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Active Financial Milestones Grid ───────────────────────────── */}
        <div id="active-milestones" className="mt-12">
          <h2 className="text-xl font-bold tracking-tight text-white mb-6 flex items-center gap-2">
            <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
            Active Financial Milestones
          </h2>

          {loadingGoals ? (
            <div className="text-center py-10 text-xs text-gray-500 font-medium animate-pulse">
              Syncing milestones...
            </div>
          ) : savedGoals.length === 0 ? (
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-8 text-center text-xs text-gray-500 font-medium">
              No milestones active. Save your current simulation to start tracking.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {savedGoals.map((goal) => {
                const fundingPct = Math.min(100, Math.max(0, (goal.current_amount / goal.target_amount) * 100));

                return (
                  <div
                    key={goal.id}
                    className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 relative overflow-hidden group hover:border-white/15 transition-all flex flex-col justify-between min-h-[220px]"
                  >
                    <div>
                      {/* Action triggers top right */}
                      <div className="absolute top-4 right-4 flex space-x-2.5 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditGoalModal(goal)}
                          className="text-gray-400 hover:text-[#FF9900] transition-colors duration-200 cursor-pointer"
                          title="Edit Goal"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            setGoalToDelete(goal.id);
                            setIsDeleteModalOpen(true);
                          }}
                          className="text-gray-400 hover:text-rose-500 transition-colors duration-200 cursor-pointer"
                          title="Delete Goal"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>

                      <h3 className="font-bold text-base text-white tracking-tight mb-3 mr-12 truncate">
                        {goal.goal_name}
                      </h3>

                      {/* Goal funding progress bar */}
                      <div className="mb-4">
                        <div className="w-full bg-white/10 rounded-full h-1.5 mt-2 mb-1.5">
                          <div className="bg-[#FF9900] h-1.5 rounded-full transition-all duration-500" style={{ width: `${fundingPct}%` }} />
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                          <span>{fundingPct.toFixed(1)}% Funded</span>
                          <span>{formatCurrency(goal.current_amount)} / {formatCurrency(goal.target_amount)}</span>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs border-t border-white/5 pt-3">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400">Monthly Contribution</span>
                          <span className="font-medium text-white">
                            {formatCurrency(goal.monthly_contribution ?? goal.ai_monthly_suggestion ?? 0)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400">Est. Target Date</span>
                          <span className="font-mono text-gray-300">
                            {goal.target_date ? new Date(goal.target_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'short' }) : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Add Funds Button */}
                    <div className="mt-4 pt-3 border-t border-white/5 flex justify-end">
                      <button
                        onClick={() => openFundGoalModal(goal)}
                        className="text-xs font-bold text-[#FF9900] hover:text-[#EC7211] transition-colors flex items-center space-x-1 cursor-pointer"
                      >
                        <span className="text-sm">+</span>
                        <span>Add Funds</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Reusable Glassmorphic Create/Edit Modal ────────────────────── */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-black/85 backdrop-blur-2xl border border-white/10 rounded-2xl text-white shadow-2xl max-w-md w-full overflow-hidden animate-zoom-in">
              {/* Modal Header */}
              <div className="bg-white/[0.02] border-b border-white/10 px-6 py-4 flex items-center justify-between">
                <h3 className="font-bold text-base flex items-center space-x-2">
                  <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{modalMode === 'create' ? 'Create Savings Goal' : 'Edit Savings Goal'}</span>
                </h3>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="text-gray-400 hover:text-white transition-colors focus:outline-none"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body Form */}
              <form onSubmit={handleModalSubmit} className="p-6 space-y-4">
                {/* Goal Name */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Goal Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Vacation Fund, Emergency Savings"
                    value={modalGoalName}
                    onChange={(e) => setModalGoalName(e.target.value)}
                    className="w-full border border-white/10 bg-white/5 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900] font-medium"
                  />
                </div>

                {/* Target Amount */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Target Amount (INR)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-gray-400 font-semibold text-sm">₹</span>
                    <input
                      type="number"
                      required
                      min="1"
                      value={modalTargetAmount}
                      onChange={(e) => setModalTargetAmount(Math.max(1, parseFloat(e.target.value) || 1))}
                      className="w-full border border-white/10 bg-white/5 text-white rounded px-3 py-2 pl-7 text-sm focus:outline-none focus:border-[#FF9900] font-medium font-mono"
                    />
                  </div>
                </div>

                {/* Monthly Contribution */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Monthly Contribution (INR)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-gray-400 font-semibold text-sm">₹</span>
                    <input
                      type="number"
                      required
                      min="0"
                      value={modalMonthlyContribution}
                      onChange={(e) => setModalMonthlyContribution(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full border border-white/10 bg-white/5 text-white rounded px-3 py-2 pl-7 text-sm focus:outline-none focus:border-[#FF9900] font-medium font-mono"
                    />
                  </div>
                </div>

                {/* Target Date */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Target Date</label>
                  <input
                    type="date"
                    required
                    value={modalTargetDate}
                    onChange={(e) => setModalTargetDate(e.target.value)}
                    className="w-full border border-white/10 bg-white/5 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900] font-medium"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 text-xs font-semibold rounded border border-white/10 hover:bg-white/[0.04] text-gray-300 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 text-xs font-bold rounded bg-gradient-to-r from-[#FF9900] to-[#FFB84D] text-black hover:from-[#EC7211] hover:to-[#FF9900] shadow-sm transition-all cursor-pointer"
                  >
                    {isSaving ? 'Saving...' : 'Confirm & Save'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Reusable Glassmorphic Funding Modal ───────────────────────── */}
        {isFundModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-black/85 backdrop-blur-2xl border border-white/10 rounded-2xl text-white shadow-2xl max-w-sm w-full overflow-hidden animate-zoom-in">
              {/* Modal Header */}
              <div className="bg-white/[0.02] border-b border-white/10 px-6 py-4 flex items-center justify-between">
                <h3 className="font-bold text-base flex items-center space-x-2">
                  <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Deposit to Milestone</span>
                </h3>
                <button 
                  onClick={() => setIsFundModalOpen(false)}
                  className="text-gray-400 hover:text-white transition-colors focus:outline-none"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body Form */}
              <form onSubmit={handleFundGoal} className="p-6 space-y-4">
                <div>
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Target Goal</span>
                  <span className="text-sm font-semibold text-white mt-1 block">{activeFundGoalName}</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Deposit Amount (INR)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-gray-400 font-semibold text-sm">₹</span>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="0"
                      value={fundAmount}
                      onChange={(e) => setFundAmount(e.target.value)}
                      className="w-full border border-white/10 bg-white/5 text-white rounded px-3 py-2 pl-7 text-sm focus:outline-none focus:border-[#FF9900] font-medium font-mono"
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsFundModalOpen(false)}
                    className="px-4 py-2 text-xs font-semibold rounded border border-white/10 hover:bg-white/[0.04] text-gray-300 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isFunding}
                    className="px-4 py-2 text-xs font-bold rounded bg-gradient-to-r from-[#FF9900] to-[#FFB84D] text-black hover:from-[#EC7211] hover:to-[#FF9900] shadow-sm transition-all cursor-pointer flex items-center justify-center space-x-1.5"
                  >
                    {isFunding ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5 text-black" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Depositing...</span>
                      </>
                    ) : (
                      <span>Deposit Funds</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Reusable Glassmorphic Delete Confirmation Modal ────────────── */}
        {isDeleteModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#111] border border-white/10 rounded-2xl p-6 max-w-sm w-full text-center text-white shadow-2xl animate-zoom-in">
              {/* Warning Icon SVG */}
              <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>

              <h3 className="text-lg font-bold tracking-tight text-white mb-2">Delete Savings Goal?</h3>
              <p className="text-xs text-gray-400 mb-6 leading-relaxed">
                This action cannot be undone. Your active funds will remain in your central ledger, but this milestone tracker will be permanently deleted.
              </p>

              {/* Side by side action buttons */}
              <div className="flex items-center justify-center space-x-3">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => {
                    setIsDeleteModalOpen(false);
                    setGoalToDelete(null);
                  }}
                  className="flex-1 py-2 px-4 rounded text-xs font-semibold border border-white/10 hover:bg-white/[0.04] text-gray-300 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={confirmDelete}
                  className="flex-1 py-2 px-4 rounded text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-colors cursor-pointer flex items-center justify-center space-x-1.5 disabled:opacity-50"
                >
                  {isDeleting ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <span>Delete Goal</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </DashboardLayout>
    </ProtectedRoute>
  );
}
