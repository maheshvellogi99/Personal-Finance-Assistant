'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';
import BudgetProgressCard from '@/components/BudgetProgressCard';
import ChatInterface from '@/components/ChatInterface';
import UploadDropdown from '@/components/UploadDropdown';
import ProtectedRoute from '@/components/ProtectedRoute';
import { apiFetch } from '@/utils/api';
import { Playfair_Display, Inter } from 'next/font/google';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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

export interface Transaction {
  id: string;
  description: string;
  category: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  date: string;
  status: 'Completed' | 'Pending';
}

export interface StagedTransactionItem {
  transaction_date: string;
  description: string;
  amount: number;
  transaction_type: 'income' | 'expense' | 'transfer';
  category: string;
  merchant_name: string | null;
  currency: string;
  ai_category_suggestion: string;
  ai_confidence_score: number;
}

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

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mounted, setMounted] = useState(false);

  // Timeframe Filter State
  const [timeframe, setTimeframe] = useState<'last_30_days' | 'last_6_months' | 'ytd'>('last_6_months');

  // Mobile Chat State
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Financial Metrics State
  const [netWorth, setNetWorth] = useState<number>(0);
  const [income, setIncome] = useState<number>(0);
  const [expenses, setExpenses] = useState<number>(0);

  // Staging Review State
  const [stagedTransactions, setStagedTransactions] = useState<StagedTransactionItem[] | null>(null);
  const [ingestionSource, setIngestionSource] = useState<string>('');
  const [isCommitting, setIsCommitting] = useState(false);

  // Manual Modal State
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [manualForm, setManualForm] = useState({
    amount: '',
    description: '',
    date: '',
    category: 'food',
    transaction_type: 'expense' as 'income' | 'expense' | 'transfer'
  });

  // Export Report Modal State
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    setMounted(true);
    setManualForm(prev => ({
      ...prev,
      date: new Date().toISOString().split('T')[0]
    }));
  }, []);

  const handleExportReport = async (format: 'pdf' | 'csv') => {
    setIsExporting(true);
    try {
      const res = await apiFetch(`/reports/export?format=${format}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
        a.download = `finance_report_${timestamp}.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        setIsExportModalOpen(false);
      } else {
        alert('Failed to generate report export.');
      }
    } catch (err) {
      alert('Network error. Failed to export report.');
    } finally {
      setIsExporting(false);
    }
  };

  // Fetch Dashboard Transactions and compute live aggregate metrics
  const fetchTransactions = async () => {
    try {
      setLoading(true);
      const txRes = await apiFetch('/transactions/?page=1&page_size=100');
      if (txRes.ok) {
        const data = await txRes.json();
        const items = Array.isArray(data) ? data : (data.items || []);
        const formattedTx = items.map((t: any) => ({
          id: t.id,
          description: t.description || t.merchant_name || 'Unknown',
          category: t.category,
          amount: t.amount,
          type: t.transaction_type || t.type || 'expense',
          date: t.transaction_date || t.date,
          status: 'Completed'
        }));
        
        setTransactions(formattedTx);

        // Compute metrics dynamically from the live database transactions
        const totalIncome = formattedTx
          .filter((t: any) => t.type === 'income')
          .reduce((sum: number, t: any) => sum + t.amount, 0);

        const totalExpense = formattedTx
          .filter((t: any) => t.type === 'expense')
          .reduce((sum: number, t: any) => sum + t.amount, 0);

        setIncome(totalIncome);
        setExpenses(totalExpense);
        setNetWorth(totalIncome - totalExpense);
      }
    } catch (err) {
      console.error('Failed to fetch transactions', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [refreshKey]);

  // Handle successful statement/screenshot upload
  const handleUploadSuccess = (items: StagedTransactionItem[], source: string) => {
    setStagedTransactions(items);
    setIngestionSource(source);
  };

  // Handle Manual Category Override inside Staging Table
  const handleStagedCategoryChange = (index: number, newCategory: string) => {
    if (!stagedTransactions) return;
    const updated = [...stagedTransactions];
    updated[index] = {
      ...updated[index],
      category: newCategory
    };
    setStagedTransactions(updated);
  };

  // Submit Batch Ingestion using apiFetch
  const handleBatchCommit = async () => {
    if (!stagedTransactions || stagedTransactions.length === 0) return;
    setIsCommitting(true);

    try {
      const res = await apiFetch('/data/confirm-ingestion', {
        method: 'POST',
        body: JSON.stringify({ transactions: stagedTransactions })
      });

      if (res.ok) {
        const result = await res.json();
        alert(result.message || 'Batch ingestion committed successfully!');
        setStagedTransactions(null);
        setRefreshKey(prev => prev + 1); // Live-update dashboard
      } else {
        const err = await res.json();
        alert(`Failed to commit: ${err.detail || 'Unknown error'}`);
      }
    } catch (err) {
      alert('Error connecting to the server.');
    } finally {
      setIsCommitting(false);
    }
  };

  // Submit Manual Cash Entry using apiFetch
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.amount || !manualForm.description || !manualForm.date) {
      alert('Please fill in all fields.');
      return;
    }

    setIsSavingManual(true);
    try {
      const payload = {
        amount: parseFloat(manualForm.amount),
        description: manualForm.description,
        transaction_date: manualForm.date,
        category: manualForm.category,
        transaction_type: manualForm.transaction_type,
        currency: 'INR',
        is_recurring: false
      };

      const res = await apiFetch('/transactions/', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setIsManualModalOpen(false);
        setManualForm({
          amount: '',
          description: '',
          date: new Date().toISOString().split('T')[0],
          category: 'food',
          transaction_type: 'expense'
        });
        setRefreshKey(prev => prev + 1);
      } else {
        const err = await res.json();
        alert(`Failed to record transaction: ${err.detail || 'Unknown error'}`);
      }
    } catch (err) {
      alert('Error connecting to the server.');
    } finally {
      setIsSavingManual(false);
    }
  };

  // Format currency helper to INR
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);
  };

  // ── Real Data Bar Chart Mapping ──────────────────────────────────────────
  const getChartData = () => {
    const today = new Date();
    
    const filteredTx = transactions.filter(t => {
      if (t.type !== 'expense' || !t.date) return false;
      const tDate = new Date(t.date);
      
      if (timeframe === 'last_30_days') {
        const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        return tDate >= thirtyDaysAgo;
      } else if (timeframe === 'last_6_months') {
        const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate());
        return tDate >= sixMonthsAgo;
      } else if (timeframe === 'ytd') {
        const startOfYear = new Date(today.getFullYear(), 0, 1);
        return tDate >= startOfYear;
      }
      return true;
    });

    const aggregates: { [key: string]: number } = {};
    filteredTx.forEach(t => {
      const dateParts = t.date.split('-');
      let label = t.date;
      if (dateParts.length >= 3) {
        label = `${dateParts[1]}/${dateParts[2]}`; // MM/DD
      }
      aggregates[label] = (aggregates[label] || 0) + t.amount;
    });

    const sortedData = Object.keys(aggregates)
      .sort((a, b) => {
        const [am, ad] = a.split('/').map(Number);
        const [bm, bd] = b.split('/').map(Number);
        if (am !== bm) return am - bm;
        return ad - bd;
      })
      .map(date => ({
        date,
        amount: aggregates[date]
      }));

    return sortedData;
  };

  const chartData = getChartData();

  return (
    <ProtectedRoute>
      <DashboardLayout>
        {/* Welcome and Header Row */}
        <div id="dashboard" className="flex flex-col md:flex-row md:items-center md:justify-between pb-6 space-y-4 md:space-y-0">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Financial Command Center</h1>
            <p className="text-sm text-gray-400 mt-1">
              Real-time analytics and predictive AI insights for your accounts.
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setIsExportModalOpen(true)}
              className="px-4 py-2 text-sm font-semibold rounded bg-white/[0.06] text-white hover:bg-white/[0.12] border border-white/10 shadow-sm transition-colors cursor-pointer"
            >
              Export Report
            </button>
            <UploadDropdown 
              onUploadSuccess={handleUploadSuccess} 
              onManualEntryClick={() => setIsManualModalOpen(true)} 
            />
          </div>
        </div>

        {/* Conditionally Render Ingestion Staging Review UI */}
        {stagedTransactions && stagedTransactions.length > 0 && (
          <div id="ingestion-staging-area" className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 mb-8 border-t-4 border-t-[#FF9900] animate-fade-in text-white">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4 mb-6">
              <div>
                <span className="bg-[#FF9900] text-black text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                  Human-in-the-Loop Review
                </span>
                <h2 className="text-lg font-bold text-white mt-1.5">
                  Ingestion Staging Area <span className="text-[#FF9900] font-normal">({ingestionSource})</span>
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Verify AI suggestions and override categories before batch-committing to database.
                </p>
              </div>
              <div className="flex items-center space-x-3 mt-4 sm:mt-0">
                <button 
                  onClick={() => setStagedTransactions(null)}
                  className="px-4 py-2 text-xs font-semibold rounded border border-white/10 hover:bg-white/[0.04] text-gray-300 transition-colors cursor-pointer"
                >
                  Discard Staging
                </button>
                <button 
                  onClick={handleBatchCommit}
                  disabled={isCommitting}
                  className="px-4 py-2 text-xs font-bold rounded bg-[#FF9900] text-black hover:bg-[#EC7211] shadow-sm transition-colors cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {isCommitting ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-black" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Confirm & Commit All ({stagedTransactions.length})</span>
                  )}
                </button>
              </div>
            </div>

            {/* Staging Review Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-white/10 bg-white/[0.01]">
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Description</th>
                    <th className="py-3 px-3">AI Suggestion & Override</th>
                    <th className="py-3 px-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {stagedTransactions.map((item, index) => {
                    const isConfidenceLow = item.ai_confidence_score < 0.70;
                    return (
                      <tr key={index} className="hover:bg-white/[0.02] transition-colors border-b border-white/5">
                        <td className="py-3.5 px-3 text-gray-300 whitespace-nowrap">
                          {item.transaction_date}
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="font-medium text-white">{item.description}</div>
                          {item.merchant_name && (
                            <div className="text-[10px] text-gray-400 mt-0.5">Merchant: {item.merchant_name}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="flex flex-col sm:flex-row sm:items-center space-y-1.5 sm:space-y-0 sm:space-x-3">
                            <select
                              value={item.category}
                              onChange={(e) => handleStagedCategoryChange(index, e.target.value)}
                              className="bg-white/5 text-xs border border-white/10 rounded px-2.5 py-1.5 focus:outline-none focus:border-[#FF9900] text-white font-medium"
                            >
                              {CATEGORIES_MAP.map((cat) => (
                                <option key={cat.value} value={cat.value}>
                                  {cat.label}
                                </option>
                              ))}
                            </select>
                            
                            {/* Confidence warning badge */}
                            {isConfidenceLow ? (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-semibold w-max animate-pulse">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span>Low Confidence ({Math.round(item.ai_confidence_score * 100)}%)</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium w-max">
                                Confident ({Math.round(item.ai_confidence_score * 100)}%)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-right font-bold text-white">
                          {formatCurrency(item.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Standalone Hero Section (Net Worth) ────────────────────────── */}
        <div className="mb-8 bg-white/[0.02] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-80 h-80 bg-[#FFD700]/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="relative z-10">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1">Portfolio Valuation</span>
            <h2 className="text-sm text-gray-400 font-semibold tracking-wide">Total Net Worth</h2>
            <h1 className={`text-5xl md:text-6xl font-extrabold text-white tracking-tight mt-2 ${playfair.className} drop-shadow-[0_4px_16px_rgba(255,215,0,0.25)]`}>
              {formatCurrency(netWorth)}
            </h1>
            <span className="flex items-center text-xs font-semibold text-emerald-400 mt-3">
              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Calculated from live ledger streams
            </span>
          </div>
          
          <div className="flex flex-row gap-8 relative z-10 border-t md:border-t-0 md:border-l border-white/10 pt-6 md:pt-0 md:pl-10">
            <div>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Incoming Yield</span>
              <span className="text-2xl font-bold text-emerald-400 mt-1 block">{formatCurrency(income)}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Outgoing Flow</span>
              <span className="text-2xl font-bold text-rose-400 mt-1 block">{formatCurrency(expenses)}</span>
            </div>
          </div>
        </div>

        {/* Main Grid: Charts & Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start mb-8">
          {/* Left Column (span 2) */}
          <div className="lg:col-span-2 space-y-8">
            {/* KPI Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Income Widget */}
              <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 flex flex-col justify-between hover:border-white/15 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-450 uppercase tracking-wider">Monthly Income</span>
                  <div className="p-2 rounded bg-emerald-500/10 text-emerald-400">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                </div>
                <div className="mt-4">
                  <h3 className="text-3xl font-extrabold text-white">{formatCurrency(income)}</h3>
                  <span className="flex items-center text-xs font-semibold text-emerald-400 mt-2">
                    <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                    On track for average
                  </span>
                </div>
              </div>

              {/* Expenses Widget */}
              <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 flex flex-col justify-between hover:border-white/15 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-455 uppercase tracking-wider">Monthly Expenses</span>
                  <div className="p-2 rounded bg-rose-500/10 text-rose-450">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  </div>
                </div>
                <div className="mt-4">
                  <h3 className="text-3xl font-extrabold text-white">{formatCurrency(expenses)}</h3>
                  <span className="flex items-center text-xs font-semibold text-rose-400 mt-2">
                    <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                    Total registered expenses
                  </span>
                </div>
              </div>
            </div>

            {/* Chart Widget */}
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 flex flex-col hover:border-white/15 transition-all">
              <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-white">Cashflow Trend</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Rolling expense trend analysis</p>
                </div>
                <select 
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value as any)}
                  className="bg-black text-xs border border-white/10 rounded px-2.5 py-1.5 focus:outline-none focus:border-[#FF9900] text-white font-medium"
                >
                  <option value="last_30_days">Last 30 Days</option>
                  <option value="last_6_months">Last 6 Months</option>
                  <option value="ytd">Year to Date</option>
                </select>
              </div>

              <div className="flex-1 w-full h-64 bg-transparent rounded flex flex-col items-center justify-center p-4 relative overflow-hidden min-h-[260px]">
                {loading || !mounted ? (
                  <div className="flex flex-col items-center justify-center text-gray-400 text-xs animate-pulse">
                    <span>Synchronizing ledger records...</span>
                  </div>
                ) : chartData.length === 0 ? (
                  /* Premium Empty State */
                  <div className="absolute inset-0 flex flex-col items-center justify-center select-none bg-transparent">
                    <svg className="w-8 h-8 text-gray-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs font-bold text-gray-400">No cashflow data available</span>
                    <span className="text-[10px] text-gray-500 mt-0.5">Add transactions or scan a screenshot to generate trends</span>
                  </div>
                ) : (
                  /* Recharts Bar Chart */
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#888888', fontSize: 10 }}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#888888', fontSize: 10 }}
                        tickFormatter={(val) => `₹${val}`}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#121212', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px' }}
                        itemStyle={{ color: '#fff' }}
                        labelStyle={{ color: '#888', fontWeight: 'bold' }}
                        formatter={(value: any) => [formatCurrency(value), 'Expenses']}
                      />
                      <Bar 
                        dataKey="amount" 
                        fill="#FF9900" 
                        radius={[4, 4, 0, 0]} 
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Recent Transactions Widget */}
            <div id="transactions" className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 flex flex-col justify-between hover:border-white/15 transition-all">
              <div>
                <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-white">Recent Transactions</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Live transactions synchronized with core banking</p>
                  </div>
                  <Link href="/transactions" className="text-xs font-semibold text-[#FF9900] hover:text-[#EC7211] hover:underline cursor-pointer">
                    View All
                  </Link>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-white/10">
                        <th className="pb-3 px-2">Date</th>
                        <th className="pb-3 px-2">Description</th>
                        <th className="pb-3 px-2">Category</th>
                        <th className="pb-3 px-2">Type</th>
                        <th className="pb-3 px-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-gray-300">
                      {loading ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-gray-400 text-xs">Loading transactions...</td>
                        </tr>
                      ) : transactions.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-gray-400 text-xs">No transactions found. Add one to get started!</td>
                        </tr>
                      ) : transactions.slice(0, 10).map((tx) => (
                        <tr key={tx.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-4 px-2 text-xs text-gray-400 whitespace-nowrap">{tx.date}</td>
                          <td className="py-4 px-2 font-semibold text-white">{tx.description}</td>
                          <td className="py-4 px-2">
                            <span className="bg-white/[0.06] border border-white/10 text-gray-300 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded">
                              {tx.category.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-4 px-2">
                            <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center ${
                              tx.type === 'income' ? 'text-emerald-400' : tx.type === 'transfer' ? 'text-blue-400' : 'text-gray-400'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                                tx.type === 'income' ? 'bg-emerald-450' : tx.type === 'transfer' ? 'bg-blue-400' : 'bg-gray-500'
                              }`}></span>
                              {tx.type}
                            </span>
                          </td>
                          <td className={`py-4 px-2 text-right font-bold ${
                            tx.type === 'income' ? 'text-emerald-400' : 'text-white'
                          }`}>
                            {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column (span 1) - Budgets & Sleek AI Chat Interface */}
          <div className="lg:col-span-1 space-y-8 flex flex-col h-full">
            {/* Budgets Tracker Widget */}
            <div id="budgets" className="flex-shrink-0">
              <BudgetProgressCard key={refreshKey} />
            </div>

            {/* Dedicated Sleek AI Assistant Panel - hidden on mobile, shown on desktop */}
            <div id="chat" className="hidden lg:block flex-1 min-h-[420px] lg:h-[550px]">
              <ChatInterface />
            </div>
          </div>
        </div>

        {/* Mobile Floating Action Button (FAB) for AI Chat */}
        <div className="lg:hidden fixed bottom-6 right-6 z-50">
          <button
            onClick={() => setIsChatOpen(true)}
            className="bg-[#FF9900] text-black shadow-lg rounded-full p-4 hover:bg-[#EC7211] hover:scale-105 active:scale-95 transition-all flex items-center justify-center cursor-pointer border border-black/10"
            title="Ask AI Assistant"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </button>
        </div>

        {/* Mobile Chat Full-Screen Overlay */}
        {isChatOpen && (
          <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md p-4 flex flex-col justify-between lg:hidden animate-fade-in text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4 flex-shrink-0">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                AI Analyst Assistant
              </h3>
              <button 
                onClick={() => setIsChatOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 focus:outline-none transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              <ChatInterface />
            </div>
          </div>
        )}

        {/* Manual Cash Entry Modal */}
        {isManualModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl text-white shadow-2xl max-w-md w-full overflow-hidden animate-zoom-in">
              {/* Modal Header */}
              <div className="bg-white/[0.02] border-b border-white/10 px-6 py-4 flex items-center justify-between">
                <h3 className="font-bold text-base flex items-center space-x-2">
                  <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Record Cash Transaction</span>
                </h3>
                <button 
                  onClick={() => setIsManualModalOpen(false)}
                  className="text-gray-400 hover:text-white transition-colors focus:outline-none"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body Form */}
              <form onSubmit={handleManualSubmit} className="p-6 space-y-4">
                {/* Transaction Type Segment */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Type</label>
                  <div className="grid grid-cols-3 gap-2 bg-white/[0.04] border border-white/10 p-1 rounded">
                    {(['expense', 'income', 'transfer'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setManualForm({ ...manualForm, transaction_type: t })}
                        className={`py-1.5 text-xs font-bold rounded transition-colors text-center capitalize ${
                          manualForm.transaction_type === t 
                            ? 'bg-[#FF9900] text-black shadow-sm' 
                            : 'text-gray-300 hover:text-white'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Amount (INR)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-gray-400 font-semibold text-sm">₹</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      placeholder="0.00"
                      value={manualForm.amount}
                      onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
                      className="w-full border border-white/10 bg-white/5 text-white rounded px-3 py-2 pl-7 text-sm focus:outline-none focus:border-[#FF9900] font-medium"
                    />
                  </div>
                </div>

                {/* Description / Merchant */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Description / Merchant</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Starbucks, Cash withdrawal"
                    value={manualForm.description}
                    onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
                    className="w-full border border-white/10 bg-white/5 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900]"
                  />
                </div>

                {/* Date */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Transaction Date</label>
                  <input
                    type="date"
                    required
                    value={manualForm.date}
                    onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
                    className="w-full border border-white/10 bg-white/5 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900] font-medium"
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">Category</label>
                  <select
                    value={manualForm.category}
                    onChange={(e) => setManualForm({ ...manualForm, category: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900] font-medium"
                  >
                    {CATEGORIES_MAP.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Actions Footer */}
                <div className="pt-4 border-t border-white/10 flex items-center justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setIsManualModalOpen(false)}
                    className="px-4 py-2 text-xs font-semibold rounded border border-white/10 hover:bg-white/[0.04] text-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingManual}
                    className="px-5 py-2 text-xs font-bold rounded bg-[#FF9900] text-black hover:bg-[#EC7211] shadow-sm transition-colors cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
                  >
                    {isSavingManual ? 'Saving...' : 'Save Transaction'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Export Report Modal */}
        {isExportModalOpen && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl text-white shadow-2xl max-w-sm w-full overflow-hidden animate-zoom-in">
              {/* Modal Header */}
              <div className="bg-white/[0.02] border-b border-white/10 px-6 py-4 flex items-center justify-between">
                <h3 className="font-bold text-base flex items-center space-x-2">
                  <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Export Financial Report</span>
                </h3>
                <button 
                  onClick={() => setIsExportModalOpen(false)}
                  className="text-gray-400 hover:text-white transition-colors focus:outline-none"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-4">
                <p className="text-xs text-gray-400 leading-normal">
                  Select your preferred file format to download your custom financial statement ledger.
                </p>

                <div className="grid grid-cols-2 gap-4">
                  {/* PDF option */}
                  <button
                    onClick={() => handleExportReport('pdf')}
                    disabled={isExporting}
                    className="p-4 border border-white/10 bg-white/[0.02] hover:border-[#FF9900] hover:bg-white/[0.04] rounded-xl transition-all text-center flex flex-col items-center justify-center group cursor-pointer disabled:opacity-50"
                  >
                    <svg className="w-10 h-10 text-rose-500 mb-2 group-hover:scale-105 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm font-bold text-white">PDF Report</span>
                    <span className="text-[10px] text-gray-400 mt-1">Formatted layout & charts</span>
                  </button>

                  {/* CSV option */}
                  <button
                    onClick={() => handleExportReport('csv')}
                    disabled={isExporting}
                    className="p-4 border border-white/10 bg-white/[0.02] hover:border-[#FF9900] hover:bg-white/[0.04] rounded-xl transition-all text-center flex flex-col items-center justify-center group cursor-pointer disabled:opacity-50"
                  >
                    <svg className="w-10 h-10 text-emerald-500 mb-2 group-hover:scale-105 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="text-sm font-bold text-white">CSV Spreadsheet</span>
                    <span className="text-[10px] text-gray-400 mt-1">Complete raw ledger log</span>
                  </button>
                </div>

                {isExporting && (
                  <div className="pt-2 flex items-center justify-center space-x-2 text-xs text-gray-400">
                    <svg className="animate-spin h-4 w-4 text-[#FF9900]" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Generating financial file...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DashboardLayout>
    </ProtectedRoute>
  );
}
