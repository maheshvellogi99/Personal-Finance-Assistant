'use client';

import React, { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  // Loading state with AWS style spinner
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F2F3F3] flex flex-col items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-4 border-gray-300 border-t-[#FF9900] rounded-full animate-spin"></div>
          <div className="text-xs font-bold text-[#232F3E] tracking-wider uppercase select-none">
            Authenticating Session...
          </div>
        </div>
      </div>
    );
  }

  // If there's no user, return null to avoid flash before redirect completes
  if (!user) {
    return null;
  }

  return <>{children}</>;
}
