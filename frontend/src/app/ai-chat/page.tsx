'use client';

import React from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import DashboardLayout from '@/components/DashboardLayout';
import ChatInterface from '@/components/ChatInterface';
import { Playfair_Display } from 'next/font/google';

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['600', '700'],
  display: 'swap',
});

export default function AIChatPage() {
  return (
    <ProtectedRoute>
      <DashboardLayout>
        <div className="flex flex-col h-[calc(100vh-6rem)] max-w-5xl w-full mx-auto">
          {/* Glowing Header */}
          <div className="pb-4 text-center relative flex-shrink-0">
            <h1 className={`text-2xl md:text-3xl font-extrabold tracking-tight text-white ${playfair.className} relative z-10`}>
              Financial Intelligence <span className="text-[#FF9900]">Command Center</span>
            </h1>
            <p className="text-xs text-gray-400 mt-1">
              Interact with the AI assistant to query transaction history, analyze budget alerts, and optimize savings plans.
            </p>
            {/* Subtle background glow */}
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-64 h-24 bg-[#FF9900]/10 rounded-full blur-2xl pointer-events-none" />
          </div>

          {/* Chatbot container */}
          <div className="flex-1 min-h-0 bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ChatInterface />
            </div>
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
