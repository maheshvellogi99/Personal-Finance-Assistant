'use client';

import React, { useState, useEffect } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import DashboardLayout from '@/components/DashboardLayout';
import { apiFetch } from '@/utils/api';

interface Transaction {
  id: string;
  description: string;
  category: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  date: string;
  status: string;
}

// ── Smart Expandable Description Component ─────────────────────────────
interface ExpandableTextProps {
  text: string;
}

function ExpandableText({ text }: ExpandableTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (text.length <= 40) {
    return <span className="font-semibold text-white">{text}</span>;
  }

  return (
    <div className="inline">
      <span className="font-semibold text-white">
        {isExpanded ? text : `${text.slice(0, 40)}...`}
      </span>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="ml-1.5 text-xs text-[#FF9900] hover:text-[#EC7211] font-bold cursor-pointer transition-colors focus:outline-none"
      >
        {isExpanded ? ' less' : ' more'}
      </button>
    </div>
  );
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters State
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const fetchAllTransactions = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      
      const res = await apiFetch('/transactions/?page=1&page_size=100');
      if (res.ok) {
        const data = await res.json();
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
      } else {
        setErrorMsg('Failed to load transaction ledger from server.');
      }
    } catch (err) {
      setErrorMsg('Network error. Unable to connect to transaction database.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllTransactions();
  }, []);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);
  };

  // Filter transactions dynamically
  const filteredTransactions = transactions.filter(tx => {
    const matchesType = typeFilter === 'all' || tx.type === typeFilter;
    const matchesCategory = categoryFilter === 'all' || tx.category === categoryFilter;
    return matchesType && matchesCategory;
  });

  const categories = Array.from(new Set(transactions.map(tx => tx.category)));

  return (
    <ProtectedRoute>
      <DashboardLayout>
        {/* Header Row */}
        <div id="transactions-header" className="pb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Transaction History</h1>
            <p className="text-sm text-gray-400 mt-1">
              View and filter all manual and statement-ingested transactions.
            </p>
          </div>
          <button 
            onClick={fetchAllTransactions}
            className="px-4 py-2 text-xs font-semibold rounded border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-white transition-colors cursor-pointer"
          >
            Refresh Ledger
          </button>
        </div>

        {errorMsg && (
          <div className="bg-rose-500/10 border-l-4 border-rose-500 p-3.5 rounded mb-6 animate-fade-in text-white">
            <p className="text-xs font-bold text-rose-400 uppercase tracking-wider">System Alert</p>
            <p className="text-xs text-rose-350 mt-0.5">{errorMsg}</p>
          </div>
        )}

        {/* Ledger Table Container */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 text-white">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center gap-4 border-b border-white/10 pb-5 mb-5">
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Filter by Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-black text-xs border border-white/10 rounded px-2.5 py-1.5 focus:outline-none focus:border-[#FF9900] text-white font-medium"
              >
                <option value="all">All Types</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Filter by Category</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-black text-xs border border-white/10 rounded px-2.5 py-1.5 focus:outline-none focus:border-[#FF9900] text-white font-medium capitalize"
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div className="ml-auto text-xs text-gray-400 font-medium">
              Showing {filteredTransactions.length} of {transactions.length} records
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-white/10 bg-white/[0.01]">
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Description</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-gray-400 text-xs font-medium">
                      Loading transactional database...
                    </td>
                  </tr>
                ) : filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-gray-400 text-xs font-medium">
                      No matching records found.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-white/[0.02] transition-colors border-b border-white/5">
                      <td className="py-3.5 px-3 text-gray-450 whitespace-nowrap text-xs">
                        {tx.date}
                      </td>
                      <td className="py-3.5 px-3 max-w-xs break-all whitespace-normal text-sm">
                        <ExpandableText text={tx.description} />
                      </td>
                      <td className="py-3.5 px-3 text-xs">
                        <span className="bg-white/[0.06] border border-white/10 text-gray-300 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded">
                          {tx.category.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-xs">
                        <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center ${
                          tx.type === 'income' ? 'text-emerald-400' : tx.type === 'transfer' ? 'text-blue-400' : 'text-gray-400'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                            tx.type === 'income' ? 'bg-emerald-450' : tx.type === 'transfer' ? 'bg-blue-400' : 'bg-gray-500'
                          }`}></span>
                          {tx.type}
                        </span>
                      </td>
                      <td className={`py-3.5 px-3 text-right font-bold ${
                        tx.type === 'income' ? 'text-emerald-400' : 'text-white'
                      }`}>
                        {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
