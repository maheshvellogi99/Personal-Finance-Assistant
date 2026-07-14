'use client';

import React, { useState, useEffect } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import DashboardLayout from '@/components/DashboardLayout';
import { apiFetch } from '@/utils/api';
import { useAuth } from '@/context/AuthContext';

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [mfaEnabled, setMfaEnabled] = useState(user?.mfa_enabled || false);
  const [loading, setLoading] = useState(true);
  
  // Setup State
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [tempMfaSecret, setTempMfaSecret] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  
  // Disable State
  const [disableCode, setDisableCode] = useState('');

  const [isLoadingAction, setIsLoadingAction] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync with AuthContext user status when loaded or updated
  useEffect(() => {
    if (user) {
      setMfaEnabled(user.mfa_enabled || false);
    }
  }, [user?.mfa_enabled]);

  // Initial fetch for robust hydration on mount
  useEffect(() => {
    async function loadStatus() {
      try {
        setLoading(true);
        await refreshUser();
      } catch (err) {
        setErrorMsg('Network error. Unable to contact account server.');
      } finally {
        setLoading(false);
      }
    }
    loadStatus();
  }, []);

  // Initiate MFA setup and fetch QR Code
  const handleSetupInit = async () => {
    setIsLoadingAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch('/auth/mfa/setup', {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        const qrCodeUrl = data.qr_code_url || data.qr_code_base64;
        setQrCode(qrCodeUrl);
        setTempMfaSecret(data.secret);
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Failed to generate MFA secret key.');
      }
    } catch (err) {
      setErrorMsg('Network error. Failed to start MFA setup.');
    } finally {
      setIsLoadingAction(false);
    }
  };

  // Verify setup code to enable MFA
  const handleVerifySetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totpCode.length !== 6) {
      setErrorMsg('Please enter a valid 6-digit verification code.');
      return;
    }
    if (!tempMfaSecret) {
      setErrorMsg('MFA setup session expired. Please start over.');
      return;
    }

    setIsLoadingAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ 
          secret: tempMfaSecret, 
          totp_code: totpCode 
        })
      });

      if (res.ok) {
        setSuccessMsg('Two-Factor Authentication has been successfully enabled!');
        setMfaEnabled(true);
        setQrCode(null);
        setTempMfaSecret(null);
        setTotpCode('');
        // Re-fetch status at the global level to sync all contexts
        await refreshUser();
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Incorrect verification code. Please try again.');
      }
    } catch (err) {
      setErrorMsg('Network error. Failed to verify code.');
    } finally {
      setIsLoadingAction(false);
    }
  };

  // Disable MFA
  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disableCode.length !== 6) {
      setErrorMsg('Please enter a valid 6-digit verification code.');
      return;
    }

    setIsLoadingAction(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch('/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ totp_code: disableCode })
      });

      if (res.ok) {
        setSuccessMsg('Two-Factor Authentication has been successfully disabled.');
        setMfaEnabled(false);
        setDisableCode('');
        // Re-fetch status at the global level to sync all contexts
        await refreshUser();
      } else {
        const err = await res.json();
        setErrorMsg(err.detail || 'Incorrect verification code. Unable to deactivate MFA.');
      }
    } catch (err) {
      setErrorMsg('Network error. Failed to deactivate MFA.');
    } finally {
      setIsLoadingAction(false);
    }
  };

  return (
    <ProtectedRoute>
      <DashboardLayout>
        {/* Header Row */}
        <div id="settings-header" className="pb-6">
          <h1 className="text-2xl font-bold tracking-tight text-white">Account Settings</h1>
          <p className="text-sm text-gray-400 mt-1">
            Manage credentials, security gates, and two-factor configurations.
          </p>
        </div>

        {errorMsg && (
          <div className="bg-rose-500/10 border-l-4 border-rose-500 p-3.5 rounded mb-6 animate-fade-in">
            <p className="text-xs font-bold text-rose-400 uppercase tracking-wider">Security Exception</p>
            <p className="text-xs text-rose-350 mt-0.5">{errorMsg}</p>
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-500/10 border-l-4 border-emerald-500 p-3.5 rounded mb-6 animate-fade-in">
            <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Success</p>
            <p className="text-xs text-emerald-350 mt-0.5">{successMsg}</p>
          </div>
        )}

        {loading ? (
          <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 animate-pulse space-y-4">
            <div className="h-4 bg-white/10 rounded w-1/3" />
            <div className="h-10 bg-white/10 rounded w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            {/* MFA Panel Card */}
            <div className="lg:col-span-2 bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 text-white">
              <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-[#FF9900]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Two-Factor Authentication (MFA)
              </h2>

              <div className="border-t border-b border-white/10 py-4 my-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Status: {mfaEnabled ? 'Active' : 'Inactive'}</p>
                  <p className="text-xs text-gray-400 mt-1 max-w-md leading-normal">
                    Protect your financial ledger. When enabled, signing in requires a password and a 6-digit OTP code from an authenticator app.
                  </p>
                </div>
                <div>
                  <span className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                    mfaEnabled ? 'bg-emerald-500/10 text-emerald-450 border border-emerald-500/20' : 'bg-white/5 text-gray-400 border border-white/10'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${mfaEnabled ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                    <span>{mfaEnabled ? 'Enabled' : 'Disabled'}</span>
                  </span>
                </div>
              </div>

              {!mfaEnabled ? (
                /* Setup Flow */
                <div className="space-y-6">
                  {!qrCode ? (
                    <div>
                      <button
                        onClick={handleSetupInit}
                        disabled={isLoadingAction}
                        className="py-2 px-4 rounded font-bold text-sm bg-[#FF9900] text-black hover:bg-[#EC7211] shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isLoadingAction ? 'Generating QR Code...' : 'Configure Multi-Factor Authentication'}
                      </button>
                    </div>
                  ) : (
                    <div className="bg-white/[0.02] border border-white/10 rounded p-6 space-y-6 animate-fade-in">
                      <div>
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">Step 1: Scan QR Code</h3>
                        <p className="text-xs text-gray-400 leading-normal mb-4">
                          Scan the QR code below using your authenticator app (Google Authenticator, Duo, Authy, etc.).
                        </p>
                        <div className="bg-white p-3 border border-white/10 rounded shadow-sm w-max mx-auto">
                          <img 
                            src={qrCode.startsWith('data:') || qrCode.startsWith('http') ? qrCode : `data:image/png;base64,${qrCode}`} 
                            alt="MFA QR Code" 
                            className="w-48 h-48" 
                          />
                        </div>
                      </div>

                      {tempMfaSecret && (
                        <div>
                          <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-1">Manual Configuration Code</h3>
                          <code className="text-xs bg-black text-[#FF9900] p-2 rounded block font-mono border border-white/10 select-all text-center">
                            {tempMfaSecret}
                          </code>
                        </div>
                      )}

                      <div className="border-t border-white/10 pt-6">
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-2">Step 2: Enter Verification Code</h3>
                        <p className="text-xs text-gray-400 leading-normal mb-4">
                          Type the 6-digit confirmation code generated by your app.
                        </p>
                        
                        <form onSubmit={handleVerifySetup} className="flex items-end gap-3 max-w-sm">
                          <div className="flex-1">
                            <input
                              type="text"
                              maxLength={6}
                              required
                              placeholder="000000"
                              value={totpCode}
                              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                              className="w-full border border-white/10 bg-black text-white rounded px-3 py-2 text-center text-base font-bold tracking-widest focus:outline-none focus:border-[#FF9900]"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={isLoadingAction}
                            className="py-2.5 px-4 rounded font-bold text-sm bg-[#FF9900] text-black hover:bg-[#EC7211] shadow-sm transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                          >
                            Verify & Enable
                          </button>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Disable Flow */
                <div className="bg-rose-500/10 border border-rose-500/20 rounded p-6">
                  <h3 className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-1.5">Deactivate Two-Factor Gate</h3>
                  <p className="text-xs text-rose-350 leading-normal mb-4">
                    Disabling MFA reduces account security. To disable, enter a valid 6-digit authenticator code.
                  </p>
                  
                  <form onSubmit={handleDisableMfa} className="flex items-end gap-3 max-w-sm">
                    <div className="flex-1">
                      <input
                        type="text"
                        maxLength={6}
                        required
                        placeholder="000000"
                        value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
                        className="w-full border border-white/10 bg-black text-white rounded px-3 py-2 text-center text-base font-bold tracking-widest focus:outline-none focus:border-rose-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isLoadingAction}
                      className="py-2.5 px-4 rounded font-bold text-sm bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      Disable MFA
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Profile Info Sidebar */}
            <div className="lg:col-span-1 bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 text-white space-y-4">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-550" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Console Identity
              </h2>
              <div className="space-y-3 pt-2 text-xs">
                <div>
                  <span className="block text-gray-500 font-bold uppercase tracking-wider text-[10px]">Session Provider</span>
                  <span className="text-white font-medium">Cognito Identity Pool</span>
                </div>
                <div>
                  <span className="block text-gray-500 font-bold uppercase tracking-wider text-[10px]">Credential Scopes</span>
                  <span className="text-gray-400">read:ledger, write:ledger, mfa:setup</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </DashboardLayout>
    </ProtectedRoute>
  );
}
