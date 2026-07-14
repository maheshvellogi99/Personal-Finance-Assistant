'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/utils/api';
import { Playfair_Display, Inter } from 'next/font/google';

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

interface UserRecord {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_verified: boolean;
  mfa_enabled: boolean;
  data_consent: boolean;
  created_at: string;
  updated_at: string;
}

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Pagination / Filter states
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [totalUsers, setTotalUsers] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch all registered users via admin list endpoint
  const fetchUsersList = async () => {
    if (!user || user.role !== 'admin') return;

    try {
      setLoadingData(true);
      setErrorMsg(null);

      const res = await apiFetch(`/admin/users?page=${page}&page_size=${pageSize}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setTotalUsers(data.total || 0);
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Failed to fetch user ledger from admin registry.');
      }
    } catch (err) {
      setErrorMsg('Network error. Unable to establish admin session with authentication service.');
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    fetchUsersList();
  }, [page, refreshKey, user]);

  // Handle Role updates via query parameters
  const handleRoleChange = async (userId: string, newRole: string) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await apiFetch(`/admin/users/${userId}?role=${newRole}`, {
        method: 'PATCH',
      });

      if (res.ok) {
        setSuccessMsg(`Successfully promoted/demoted user role to ${newRole}.`);
        setRefreshKey(prev => prev + 1);
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Failed to update user authorization privileges.');
      }
    } catch (err) {
      setErrorMsg('Network error. Failed to dispatch user update request.');
    }
  };

  // Toggle user suspension via query parameters
  const handleToggleSuspension = async (userId: string, currentActiveStatus: boolean) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    const targetStatus = !currentActiveStatus;

    try {
      const res = await apiFetch(`/admin/users/${userId}?is_active=${targetStatus}`, {
        method: 'PATCH',
      });

      if (res.ok) {
        setSuccessMsg(
          targetStatus
            ? 'Successfully reactivated user account login privileges.'
            : 'Successfully suspended user account.'
        );
        setRefreshKey(prev => prev + 1);
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Failed to toggle account suspension state.');
      }
    } catch (err) {
      setErrorMsg('Network error. Failed to update account suspension.');
    }
  };

  // ── Guarding: loading auth state ─────────────────────────────────────────
  if (authLoading) {
    return (
      <ProtectedRoute>
        <DashboardLayout>
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-gray-400 space-y-4 animate-pulse">
            <svg className="animate-spin h-8 w-8 text-[#FF9900]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-sm font-semibold">Validating security clearances...</p>
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  // ── Guarding: Unauthorized Access Block ──────────────────────────────────
  if (!user || user.role !== 'admin') {
    return (
      <ProtectedRoute>
        <DashboardLayout>
          <div className="flex items-center justify-center min-h-[60vh] p-4">
            <div className="bg-rose-500/10 border border-rose-500/20 backdrop-blur-xl rounded-2xl p-8 max-w-md w-full text-center space-y-6 shadow-2xl">
              <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0-8v6m0 5h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white tracking-wide">Privilege Violation Detected</h2>
                <p className="text-xs text-rose-200 leading-relaxed">
                  Your identity context does not contain administrative credentials. This console requires root IAM access.
                </p>
              </div>
              <button
                onClick={() => router.push('/')}
                className="w-full py-2.5 px-4 rounded font-bold text-xs bg-[#FF9900] text-black hover:bg-[#EC7211] shadow-sm transition-all active:scale-98 cursor-pointer"
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  // ── Computing Telemetry metrics ──────────────────────────────────────────
  const totalManagedAccounts = totalUsers;
  const privilegedAdmins = users.filter(u => u.role === 'admin').length;
  const mfaAdopters = users.filter(u => u.mfa_enabled).length;
  const mfaAdoptionRate = users.length > 0 ? (mfaAdopters / users.length) * 100 : 0;

  return (
    <ProtectedRoute>
      <DashboardLayout>
        {/* Header Title Row */}
        <div id="admin-dashboard-header" className="pb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <svg className="w-6 h-6 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              IAM Command Center
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Global administration console for identity roles, credentials, and access lists.
            </p>
          </div>
          <button
            onClick={() => setRefreshKey(prev => prev + 1)}
            className="px-4 py-2 text-xs font-semibold rounded border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-white transition-colors cursor-pointer"
          >
            Refresh Registry
          </button>
        </div>

        {/* Notifications and Toasts */}
        {errorMsg && (
          <div className="bg-rose-500/10 border-l-4 border-rose-500 p-3.5 rounded mb-6 animate-fade-in text-white">
            <p className="text-xs font-bold text-rose-400 uppercase tracking-wider">Administration Warning</p>
            <p className="text-xs text-rose-350 mt-0.5">{errorMsg}</p>
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-500/10 border-l-4 border-emerald-500 p-3.5 rounded mb-6 animate-fade-in text-white">
            <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Console Log</p>
            <p className="text-xs text-emerald-350 mt-0.5">{successMsg}</p>
          </div>
        )}

        {/* ── Telemetry Cards ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Card 1 */}
          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 hover:border-white/15 transition-all">
            <span className="text-[10px] font-bold text-[#FF9900] uppercase tracking-wider block mb-1">Total Identity Pool</span>
            <h2 className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Managed Accounts</h2>
            <h1 className={`text-4xl font-extrabold text-white mt-3 ${playfair.className}`}>
              {loadingData ? '...' : totalManagedAccounts}
            </h1>
          </div>

          {/* Card 2 */}
          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 hover:border-white/15 transition-all">
            <span className="text-[10px] font-bold text-[#FF9900] uppercase tracking-wider block mb-1">Console Access</span>
            <h2 className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Privileged Admins</h2>
            <h1 className={`text-4xl font-extrabold text-white mt-3 ${playfair.className}`}>
              {loadingData ? '...' : privilegedAdmins}
            </h1>
          </div>

          {/* Card 3 */}
          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 hover:border-white/15 transition-all">
            <span className="text-[10px] font-bold text-[#FF9900] uppercase tracking-wider block mb-1">Security Coverage</span>
            <h2 className="text-xs text-gray-400 font-semibold uppercase tracking-wider">MFA Adoption Rate</h2>
            <h1 className={`text-4xl font-extrabold text-white mt-3 ${playfair.className}`}>
              {loadingData ? '...' : `${mfaAdoptionRate.toFixed(1)}%`}
            </h1>
          </div>
        </div>

        {/* ── Master Control Table Widget ────────────────────────────────── */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 text-white">
          <div className="border-b border-white/10 pb-4 mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white">Directory Services</h2>
              <p className="text-xs text-gray-400 mt-0.5">Authorization and credential status records</p>
            </div>
            <div className="text-xs text-gray-450 font-medium">
              Registered Identities: {totalUsers}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-white/10 bg-white/[0.01]">
                  <th className="py-3 px-3">Name</th>
                  <th className="py-3 px-3">Email Address</th>
                  <th className="py-3 px-3">Assigned Role</th>
                  <th className="py-3 px-3">Security (2FA)</th>
                  <th className="py-3 px-3">Account Status</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loadingData ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-gray-400 text-xs font-medium animate-pulse">
                      Retrieving authorization nodes...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-gray-400 text-xs font-medium">
                      No user records located in registry.
                    </td>
                  </tr>
                ) : (
                  users.map((record) => (
                    <tr key={record.id} className="hover:bg-white/[0.02] transition-colors border-b border-white/5">
                      {/* Name */}
                      <td className="py-3.5 px-3 font-semibold text-white whitespace-nowrap">
                        {record.full_name || 'N/A'}
                      </td>

                      {/* Email */}
                      <td className="py-3.5 px-3 text-gray-300 font-mono text-xs">
                        {record.email}
                      </td>

                      {/* Role Dropdown */}
                      <td className="py-3.5 px-3">
                        <select
                          value={record.role}
                          onChange={(e) => handleRoleChange(record.id, e.target.value)}
                          className="bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#FF9900] font-medium"
                        >
                          <option value="user" className="bg-black text-white">user</option>
                          <option value="admin" className="bg-black text-white">admin</option>
                        </select>
                      </td>

                      {/* Security Status */}
                      <td className="py-3.5 px-3 text-xs">
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          record.mfa_enabled
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-white/5 text-gray-400 border border-white/10'
                        }`}>
                          {record.mfa_enabled ? 'MFA Shielded' : 'Unprotected'}
                        </span>
                      </td>

                      {/* Status badge */}
                      <td className="py-3.5 px-3 text-xs">
                        <span className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          record.is_active
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${record.is_active ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
                          <span>{record.is_active ? 'Active' : 'Suspended'}</span>
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-3 text-right">
                        <button
                          onClick={() => handleToggleSuspension(record.id, record.is_active)}
                          className="px-3.5 py-1.5 rounded text-xs font-bold bg-[#FF9900] text-black hover:bg-[#EC7211] shadow-sm transition-colors cursor-pointer font-sans"
                        >
                          Toggle Suspension
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Simple pagination controls */}
          {totalUsers > pageSize && (
            <div className="flex items-center justify-between border-t border-white/10 pt-4 mt-4">
              <button
                disabled={page === 1 || loadingData}
                onClick={() => setPage(p => Math.max(p - 1, 1))}
                className="px-3 py-1.5 text-xs font-semibold rounded border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-white disabled:opacity-30 cursor-pointer"
              >
                Previous
              </button>
              <span className="text-xs text-gray-400">
                Page {page} of {Math.ceil(totalUsers / pageSize)}
              </span>
              <button
                disabled={page * pageSize >= totalUsers || loadingData}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-xs font-semibold rounded border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-white disabled:opacity-30 cursor-pointer"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
