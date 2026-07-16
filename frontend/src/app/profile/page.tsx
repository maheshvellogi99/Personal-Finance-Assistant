'use client';

import React, { useState, useEffect } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/utils/api';
import { Playfair_Display } from 'next/font/google';

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
});

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();

  // Toast / general notifications
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastErrorMsg, setToastErrorMsg] = useState<string | null>(null);

  // 1. Password Change Modal States
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // 2. MFA States
  const [isMfaModalOpen, setIsMfaModalOpen] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [isVerifyingMfa, setIsVerifyingMfa] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  // MFA Disable States
  const [isDisableMfaModalOpen, setIsDisableMfaModalOpen] = useState(false);
  const [disableTotpCode, setDisableTotpCode] = useState('');
  const [isDisablingMfa, setIsDisablingMfa] = useState(false);
  const [disableMfaError, setDisableMfaError] = useState<string | null>(null);

  const mfaEnabled = user?.mfa_enabled || false;

  // Clear alerts after a short delay
  useEffect(() => {
    if (toastMsg || toastErrorMsg) {
      const timer = setTimeout(() => {
        setToastMsg(null);
        setToastErrorMsg(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMsg, toastErrorMsg]);

  // Password submission handler
  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }

    setIsChangingPassword(true);
    try {
      const res = await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });

      if (res.ok) {
        setToastMsg('Password changed successfully.');
        setIsPasswordModalOpen(false);
        setOldPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
      } else {
        const err = await res.json();
        setPasswordError(err.detail || 'Failed to change password.');
      }
    } catch (err) {
      setPasswordError('Network error. Failed to change password.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  // MFA Toggle trigger handler
  const handleMfaToggleClick = async () => {
    if (!mfaEnabled) {
      // Setup MFA (ON flow)
      setMfaError(null);
      setTotpCode('');
      try {
        const res = await apiFetch('/auth/mfa/setup', {
          method: 'POST',
        });
        if (res.ok) {
          const data = await res.json();
          setMfaSecret(data.secret);
          setQrCodeUrl(data.qr_code_base64);
          setIsMfaModalOpen(true);
        } else {
          setToastErrorMsg('Failed to initiate MFA setup.');
        }
      } catch (err) {
        setToastErrorMsg('Network error. Failed to connect to authentication server.');
      }
    } else {
      // Disable MFA (OFF flow)
      setDisableMfaError(null);
      setDisableTotpCode('');
      setIsDisableMfaModalOpen(true);
    }
  };

  // Verify TOTP to enable MFA
  const handleVerifyMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMfaError(null);
    setIsVerifyingMfa(true);

    try {
      const res = await apiFetch('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({
          secret: mfaSecret,
          totp_code: totpCode,
        }),
      });

      if (res.ok) {
        setToastMsg('Two-Factor Authentication (MFA) successfully enabled.');
        setIsMfaModalOpen(false);
        setTotpCode('');
        setMfaSecret('');
        await refreshUser();
      } else {
        const err = await res.json();
        setMfaError(err.detail || 'Invalid code. Please try again.');
      }
    } catch (err) {
      setMfaError('Network error. Failed to verify code.');
    } finally {
      setIsVerifyingMfa(false);
    }
  };

  // Disable MFA confirmation
  const handleDisableMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableMfaError(null);
    setIsDisablingMfa(true);

    try {
      const res = await apiFetch('/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({
          totp_code: disableTotpCode,
        }),
      });

      if (res.ok) {
        setToastMsg('Two-Factor Authentication (MFA) successfully disabled.');
        setIsDisableMfaModalOpen(false);
        setDisableTotpCode('');
        await refreshUser();
      } else {
        const err = await res.json();
        setDisableMfaError(err.detail || 'Invalid code. Cannot disable MFA.');
      }
    } catch (err) {
      setDisableMfaError('Network error. Failed to disable MFA.');
    } finally {
      setIsDisablingMfa(false);
    }
  };

  return (
    <ProtectedRoute>
      <DashboardLayout>
        {/* Header Title */}
        <div className="pb-6">
          <h1 className={`text-2xl font-bold tracking-tight text-white flex items-center gap-2 ${playfair.className}`}>
            <svg className="w-6 h-6 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Identity &amp; Security Settings
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Manage your account credentials, multi-factor authentication, and export or delete options.
          </p>
        </div>

        {/* Dynamic alerts banner */}
        {toastErrorMsg && (
          <div className="bg-rose-500/10 border-l-4 border-rose-500 p-3.5 rounded mb-6 animate-fade-in text-white flex items-start">
            <svg className="w-5 h-5 text-rose-400 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-xs font-bold text-rose-400 uppercase tracking-wider">Security Error</p>
              <p className="text-xs text-rose-250 mt-0.5">{toastErrorMsg}</p>
            </div>
          </div>
        )}

        {toastMsg && (
          <div className="bg-emerald-500/10 border-l-4 border-emerald-500 p-3.5 rounded mb-6 animate-fade-in text-white flex items-start">
            <svg className="w-5 h-5 text-emerald-400 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Security Notice</p>
              <p className="text-xs text-emerald-250 mt-0.5">{toastMsg}</p>
            </div>
          </div>
        )}

        {/* Profile Cards Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Left Column: Personal Details & Security */}
          <div className="space-y-8">
            {/* Card 1: Personal Details */}
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 text-white space-y-4">
              <div>
                <h3 className="font-bold text-base text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.333 0 4 1 4 3v1H5v-1c0-2 2.667-3 4-3z" />
                  </svg>
                  Personal Details
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">Your global personal information and identity records.</p>
              </div>

              <div className="space-y-3.5 border-t border-white/5 pt-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Full Name</label>
                  <input
                    type="text"
                    readOnly
                    value={user?.full_name || 'AWS Client'}
                    className="w-full border border-white/10 bg-black/40 rounded px-3 py-2 text-sm text-gray-300 focus:outline-none font-medium cursor-not-allowed select-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Email Address</label>
                  <input
                    type="email"
                    readOnly
                    value={user?.email || 'unknown@geonixa.com'}
                    className="w-full border border-white/10 bg-black/40 rounded px-3 py-2 text-sm text-gray-300 focus:outline-none font-medium cursor-not-allowed select-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Assigned Role</label>
                  <div className="mt-1">
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wider bg-white/[0.08] border border-white/10 text-[#FF9900] px-2.5 py-1 rounded">
                      {user?.role || 'user'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Security */}
            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 text-white space-y-4">
              <div>
                <h3 className="font-bold text-base text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Account Security &amp; MFA
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">Protect your account using password switches and MFA.</p>
              </div>

              <div className="space-y-4 border-t border-white/5 pt-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-gray-300">Account Password</p>
                    <p className="text-[10px] text-gray-500">Update your current system password credentials.</p>
                  </div>
                  <button
                    onClick={() => {
                      setPasswordError(null);
                      setIsPasswordModalOpen(true);
                    }}
                    className="px-3.5 py-1.5 rounded border border-white/10 text-xs font-semibold text-gray-300 hover:bg-white/[0.04] transition-colors cursor-pointer"
                  >
                    Change Password
                  </button>
                </div>

                <div className="flex items-center justify-between pt-3.5 border-t border-white/5">
                  <div>
                    <p className="text-xs font-bold text-gray-300">Two-Factor Authentication (MFA)</p>
                    <p className="text-[10px] text-gray-500">Secure transactions using dynamic security tokens.</p>
                  </div>
                  {/* Switch Container */}
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={mfaEnabled}
                      onChange={handleMfaToggleClick}
                    />
                    <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 peer-checked:after:bg-[#FF9900] after:border-none after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF9900]/20 border border-white/10"></div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Danger Zone */}
          <div className="space-y-8">
            {/* Card 3: Danger Zone */}
            <div className="bg-rose-500/[0.02] backdrop-blur-xl border border-rose-500/10 rounded-2xl p-6 text-white space-y-4">
              <div>
                <h3 className="font-bold text-base text-rose-400 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Danger Zone
                </h3>
                <p className="text-[11px] text-rose-500/60 mt-0.5">Destructive actions and permanent deletion tools.</p>
              </div>

              <div className="space-y-4 border-t border-rose-500/10 pt-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-gray-300">Request Data Export</p>
                    <p className="text-[10px] text-gray-500">Download a full JSON archive of your ingestion statements.</p>
                  </div>
                  <button className="px-3.5 py-1.5 rounded border border-rose-500/20 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer">
                    Export Data
                  </button>
                </div>

                <div className="flex items-center justify-between pt-3.5 border-t border-rose-500/10">
                  <div>
                    <p className="text-xs font-bold text-gray-300">Permanent Account Deletion</p>
                    <p className="text-[10px] text-gray-500">Deletes your financial ledger, budgets, and goals permanently.</p>
                  </div>
                  <button className="px-3.5 py-1.5 rounded text-xs font-bold bg-rose-500/10 text-rose-500 hover:bg-rose-600 hover:text-white transition-colors cursor-pointer">
                    Delete Account
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Reusable Glassmorphic Password Change Modal ────────────────── */}
        {isPasswordModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-black/85 backdrop-blur-2xl border border-white/10 rounded-2xl text-white shadow-2xl max-w-sm w-full overflow-hidden animate-zoom-in">
              {/* Modal Header */}
              <div className="bg-white/[0.02] border-b border-white/10 px-5 py-3.5 flex items-center justify-between">
                <h3 className="font-bold text-sm flex items-center space-x-2">
                  <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span>Update Account Password</span>
                </h3>
                <button
                  onClick={() => setIsPasswordModalOpen(false)}
                  className="text-gray-400 hover:text-white transition-colors focus:outline-none"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body */}
              <form onSubmit={handleChangePasswordSubmit} className="p-5 space-y-4">
                {passwordError && (
                  <div className="bg-rose-500/10 border-l-2 border-rose-500 p-2 rounded text-rose-300 text-xs">
                    {passwordError}
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Current Password</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="w-full border border-white/10 bg-white/5 text-white placeholder-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">New Password</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full border border-white/10 bg-white/5 text-white placeholder-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Confirm New Password</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full border border-white/10 bg-white/5 text-white placeholder-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF9900]"
                  />
                </div>

                {/* Footer */}
                <div className="pt-4 border-t border-white/10 flex items-center justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setIsPasswordModalOpen(false)}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded border border-white/10 hover:bg-white/10 text-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isChangingPassword}
                    className="px-4 py-1.5 text-xs font-bold rounded bg-gradient-to-r from-[#FF9900] to-[#FFB84D] text-black hover:from-[#EC7211] hover:to-[#FF9900] shadow-sm transition-colors cursor-pointer"
                  >
                    {isChangingPassword ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Reusable Glassmorphic MFA Setup Modal ──────────────────────── */}
        {isMfaModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-black/85 backdrop-blur-2xl border border-white/10 rounded-2xl text-white shadow-2xl max-w-sm w-full overflow-hidden animate-zoom-in">
              {/* Modal Header */}
              <div className="bg-white/[0.02] border-b border-white/10 px-5 py-3.5 flex items-center justify-between">
                <h3 className="font-bold text-sm flex items-center space-x-2">
                  <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>MFA Security Setup</span>
                </h3>
                <button
                  onClick={() => {
                    setIsMfaModalOpen(false);
                    setTotpCode('');
                  }}
                  className="text-gray-400 hover:text-white transition-colors focus:outline-none"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body */}
              <form onSubmit={handleVerifyMfaSubmit} className="p-5 space-y-4 text-center">
                <p className="text-xs text-gray-300 leading-normal text-left">
                  Scan this QR code using Google Authenticator or Microsoft Authenticator, then enter the 6-digit code below to confirm.
                </p>

                {qrCodeUrl && (
                  <div className="bg-white p-3.5 rounded-xl inline-block mx-auto">
                    <img
                      src={`data:image/png;base64,${qrCodeUrl}`}
                      alt="MFA QR Code"
                      className="w-40 h-40 object-contain mx-auto"
                    />
                  </div>
                )}

                {mfaError && (
                  <div className="bg-rose-500/10 border-l-2 border-rose-500 p-2 rounded text-rose-300 text-xs text-left">
                    {mfaError}
                  </div>
                )}

                <div className="text-left">
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Authenticator Code</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full border border-white/10 bg-white/5 text-white placeholder-gray-650 rounded px-3 py-2 text-center text-sm focus:outline-none focus:border-[#FF9900] tracking-[0.2em] font-bold"
                  />
                </div>

                {/* Footer */}
                <div className="pt-4 border-t border-white/10 flex items-center justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMfaModalOpen(false);
                      setTotpCode('');
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded border border-white/10 hover:bg-white/10 text-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isVerifyingMfa}
                    className="px-4 py-1.5 text-xs font-bold rounded bg-gradient-to-r from-[#FF9900] to-[#FFB84D] text-black hover:from-[#EC7211] hover:to-[#FF9900] shadow-sm transition-colors cursor-pointer"
                  >
                    {isVerifyingMfa ? 'Verifying...' : 'Verify & Enable'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Reusable Glassmorphic MFA Disable Modal ────────────────────── */}
        {isDisableMfaModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-black/85 backdrop-blur-2xl border border-white/10 rounded-2xl text-white shadow-2xl max-w-sm w-full overflow-hidden animate-zoom-in">
              {/* Modal Header */}
              <div className="bg-white/[0.02] border-b border-white/10 px-5 py-3.5 flex items-center justify-between">
                <h3 className="font-bold text-sm flex items-center space-x-2">
                  <svg className="w-5 h-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>Disable MFA Security</span>
                </h3>
                <button
                  onClick={() => {
                    setIsDisableMfaModalOpen(false);
                    setDisableTotpCode('');
                  }}
                  className="text-gray-400 hover:text-white transition-colors focus:outline-none"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body */}
              <form onSubmit={handleDisableMfaSubmit} className="p-5 space-y-4">
                <p className="text-xs text-gray-300 leading-normal">
                  To disable multi-factor authentication, please enter the current 6-digit code from your authenticator app.
                </p>

                {disableMfaError && (
                  <div className="bg-rose-500/10 border-l-2 border-rose-500 p-2 rounded text-rose-300 text-xs">
                    {disableMfaError}
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Authenticator Code</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="000000"
                    value={disableTotpCode}
                    onChange={(e) => setDisableTotpCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full border border-white/10 bg-white/5 text-white placeholder-gray-600 rounded px-3 py-2 text-center text-sm focus:outline-none focus:border-[#FF9900] tracking-[0.2em] font-bold"
                  />
                </div>

                {/* Footer */}
                <div className="pt-4 border-t border-white/10 flex items-center justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsDisableMfaModalOpen(false);
                      setDisableTotpCode('');
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded border border-white/10 hover:bg-white/10 text-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isDisablingMfa}
                    className="px-4 py-1.5 text-xs font-bold rounded bg-rose-500/10 text-rose-500 hover:bg-rose-600 hover:text-white transition-colors cursor-pointer"
                  >
                    {isDisablingMfa ? 'Disabling...' : 'Confirm & Disable'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </DashboardLayout>
    </ProtectedRoute>
  );
}
