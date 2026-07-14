'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Playfair_Display, Inter } from 'next/font/google';
import { useGoogleLogin } from '@react-oauth/google';

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

export default function RegisterPage() {
  const { user, register, googleLogin } = useAuth();
  const router = useRouter();

  // Registration Fields State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dataConsent, setDataConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // MFA Gate State (for Google OAuth auto-registration if 2FA is required)
  const [showMfa, setShowMfa] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);

  // Redirect to dashboard if authenticated
  useEffect(() => {
    if (user) {
      router.replace('/');
    }
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showMfa && !googleAccessToken && (!fullName || !email || !password)) {
      setError('Please fill in all required fields.');
      return;
    }

    if (!showMfa && !googleAccessToken && password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (!showMfa && !googleAccessToken && !dataConsent) {
      setError('You must consent to GDPR data processing to register.');
      return;
    }

    if (showMfa && totpCode.length !== 6) {
      setError('Please enter a valid 6-digit TOTP verification code.');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      if (showMfa && googleAccessToken) {
        // Google OAuth MFA submission
        const success = await googleLogin(googleAccessToken, totpCode);
        if (success) {
          router.push('/');
        }
      } else {
        // Standard registration submission
        const success = await register(fullName, email, password);
        if (success) {
          router.push('/');
        }
      }
    } catch (err: any) {
      if (err.message === 'MFA_REQUIRED') {
        setShowMfa(true);
        setError(null);
      } else if (err.message === 'INVALID_MFA') {
        setError('Invalid verification code. Please check your authenticator application.');
      } else {
        setError(err.message || 'Registration failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelMfa = () => {
    setShowMfa(false);
    setTotpCode('');
    setGoogleAccessToken(null);
    setError(null);
  };

  // Google OAuth Hook
  const registerWithGoogle = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setIsLoading(true);
      setError(null);
      try {
        const success = await googleLogin(tokenResponse.access_token);
        if (success) {
          router.push('/');
        }
      } catch (err: any) {
        if (err.message === 'MFA_REQUIRED') {
          setGoogleAccessToken(tokenResponse.access_token);
          setShowMfa(true);
          setError(null);
        } else {
          setError(err.message || 'Google Registration failed.');
        }
      } finally {
        setIsLoading(false);
      }
    },
    onError: () => {
      setError('Google Sign-In failed. Please try again.');
    },
  });

  return (
    <div className={`min-h-screen bg-black text-white flex flex-col justify-between relative overflow-hidden select-none ${inter.className}`}>
      
      {/* 1. Deep Vignette Background Layers */}
      <div className="fixed inset-0 z-0 bg-[url('/FinanceBG.png')] bg-cover bg-center bg-no-repeat" />
      <div className="fixed inset-0 z-0 bg-black/85 backdrop-blur-[2px]" />

      {/* Subtle top branding padding */}
      <div className="pt-6" />

      {/* Main Container - Centered Single Column Layout */}
      <main className="flex-1 flex items-center justify-center p-6 relative z-10">
        
        {/* Massive Ambient Gold Radial Glow behind the card */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#FFD700]/10 via-transparent to-transparent blur-3xl pointer-events-none z-0" />

        {/* Centralized Glassmorphic Authentication Card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="w-full max-w-sm bg-black/40 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)] p-8 z-10 select-text"
        >
          <h2 className={`${playfair.className} text-2xl font-semibold text-white tracking-wide mb-6 text-center`}>
            {showMfa ? 'Verification' : 'Create account'}
          </h2>

          {error && (
            <div className="bg-rose-500/10 border-l-4 border-rose-500 p-3.5 rounded mb-5">
              <div className="flex">
                <svg className="h-5 w-5 text-rose-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="ml-2.5">
                  <p className="text-[10px] font-bold text-rose-400 uppercase tracking-widest">Alert</p>
                  <p className="text-xs text-rose-200 mt-0.5 leading-relaxed">{error}</p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!showMfa ? (
              /* Standard Register Fields */
              <>
                <div>
                  <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5">Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-[#FF9900] focus:ring-1 focus:ring-[#FF9900]/30 transition-all font-medium"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5">Email address</label>
                  <input
                    type="email"
                    required
                    placeholder="email@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-[#FF9900] focus:ring-1 focus:ring-[#FF9900]/30 transition-all font-medium"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5">Password</label>
                  <input
                    type="password"
                    required
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-[#FF9900] focus:ring-1 focus:ring-[#FF9900]/30 transition-all"
                  />
                  <span className="text-[9px] text-neutral-500 mt-1.5 block leading-normal">Passwords must contain at least 8 characters.</span>
                </div>

                {/* GDPR Consent checkbox */}
                <div className="pt-1.5">
                  <label className="flex items-start cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={dataConsent}
                      onChange={(e) => setDataConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-white/10 bg-white/5 text-[#FF9900] focus:ring-[#FF9900] focus:ring-offset-0 accent-[#FF9900] cursor-pointer"
                    />
                    <span className="ml-2.5 text-[11px] text-neutral-400 leading-normal select-none group-hover:text-white transition-colors">
                      I explicitly consent to the processing of my personal financial transactions under GDPR guidelines.
                    </span>
                  </label>
                </div>
              </>
            ) : (
              /* MFA Verify Input */
              <>
                <p className="text-xs text-neutral-400 leading-relaxed mb-4">
                  Two-Factor Authentication is active. Enter the 6-digit TOTP code from your authenticator app.
                </p>
                <div>
                  <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5">Verification Code</label>
                  <input
                    type="text"
                    maxLength={6}
                    required
                    pattern="\d{6}"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-center text-lg font-bold tracking-widest text-white focus:outline-none focus:border-[#FF9900] focus:ring-1 focus:ring-[#FF9900]/30 transition-all"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-lg font-bold text-sm bg-[#FF9900] text-white hover:bg-[#E68A00] shadow-[0_4px_14px_rgba(255,153,0,0.3)] transition-all flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              {isLoading && !googleAccessToken ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Creating Account...</span>
                </>
              ) : (
                <span>{showMfa ? 'Verify & Register' : 'REGISTER'}</span>
              )}
            </button>

            {showMfa && (
              <button
                type="button"
                onClick={handleCancelMfa}
                className="w-full py-2.5 text-xs font-semibold rounded border border-white/10 hover:bg-white/5 text-neutral-400 hover:text-white transition-colors"
              >
                Cancel Verification
              </button>
            )}
          </form>

          {/* Google OAuth Button */}
          <div className="flex items-center my-5 text-neutral-500 text-[10px] font-bold tracking-widest uppercase">
            <div className="flex-1 border-t border-white/[0.06]" />
            <span className="px-3">or</span>
            <div className="flex-1 border-t border-white/[0.06]" />
          </div>

          <button
            type="button"
            onClick={() => registerWithGoogle()}
            disabled={isLoading}
            className="w-full py-2.5 px-4 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] text-white font-semibold text-xs transition-all flex items-center justify-center space-x-2.5 cursor-pointer disabled:opacity-50"
          >
            {isLoading && googleAccessToken ? (
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
              </svg>
            )}
            <span>Continue with Google</span>
          </button>

          <div className="mt-6 pt-5 border-t border-white/[0.06] text-center">
            <span className="text-xs text-neutral-500">Already have an account?</span>{' '}
            <Link
              href="/login"
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
            >
              Sign in
            </Link>
          </div>
        </motion.div>
      </main>

      {/* Styled Footer */}
      <footer className="bg-black/25 text-neutral-600 py-4 text-center text-[10px] border-t border-white/[0.03] z-30">
        © 2026 AWS Virtual Personal Finance Assistance. All rights reserved.
      </footer>
    </div>
  );
}
