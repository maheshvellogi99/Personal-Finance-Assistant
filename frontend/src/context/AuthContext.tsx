'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch } from '@/utils/api';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  phone_number: string | null;
  currency_preference: string;
  is_active: boolean;
  is_verified: boolean;
  data_consent: boolean;
  mfa_enabled?: boolean;
  role: string;
  created_at: string;
}

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<boolean>;
  register: (fullName: string, email: string, password: string) => Promise<boolean>;
  googleLogin: (token: string, totpCode?: string) => Promise<boolean>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Initialize and check for existing session
  useEffect(() => {
    async function initAuth() {
      try {
        const storedToken = localStorage.getItem('token');
        if (storedToken) {
          // Verify token and fetch user details
          const res = await apiFetch('/auth/me');
          if (res.ok) {
            const userData = await res.json();
            setUser(userData);
            setToken(storedToken);
          } else {
            // Token was invalid or expired
            localStorage.removeItem('token');
          }
        }
      } catch (err) {
        console.error('Failed to initialize authentication context', err);
      } finally {
        setLoading(false);
      }
    }
    initAuth();
  }, []);

  const login = async (email: string, password: string, totpCode?: string): Promise<boolean> => {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, totp_code: totpCode || null }),
    });

    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('token', data.access_token);
      setToken(data.access_token);

      // Fetch user profile immediately
      const profileRes = await apiFetch('/auth/me');
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        setUser(profileData);
        return true;
      }
    }

    const err = await res.json();
    throw new Error(err.detail || 'Incorrect email or password');
  };

  const googleLogin = async (token: string, totpCode?: string): Promise<boolean> => {
    const res = await apiFetch('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ token, totp_code: totpCode || null }),
    });

    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('token', data.access_token);
      setToken(data.access_token);

      // Fetch user profile immediately
      const profileRes = await apiFetch('/auth/me');
      if (profileRes.ok) {
        const profileData = await profileRes.json();
        setUser(profileData);
        return true;
      }
    }

    const err = await res.json();
    throw new Error(err.detail || 'Google Authentication failed');
  };

  const register = async (fullName: string, email: string, password: string): Promise<boolean> => {
    const res = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        full_name: fullName,
        phone_number: null,
        currency_preference: 'USD',
        data_consent: true, // Auto-consented via registration checkbox validation
      }),
    });

    if (res.ok) {
      // Auto login on successful registration
      return await login(email, password);
    }

    const err = await res.json();
    throw new Error(err.detail || 'Registration failed. Please check your inputs.');
  };

  const refreshUser = async () => {
    try {
      const res = await apiFetch('/auth/me');
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
      }
    } catch (err) {
      console.error('Failed to refresh user profile', err);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setToken(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, googleLogin, refreshUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
