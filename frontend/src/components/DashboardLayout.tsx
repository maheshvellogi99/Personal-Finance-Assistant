'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

interface NavItem {
  name: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  const getInitials = (name?: string) => {
    if (!name) return 'US';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const navigation: NavItem[] = [
    {
      name: 'Dashboard',
      href: '/',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
        </svg>
      ),
    },
    {
      name: 'Transactions',
      href: '/transactions',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
    },
    {
      name: 'Budgets',
      href: '/budgets',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      name: 'Savings Planner',
      href: '/savings',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ),
    },
    {
      name: 'AI Chat',
      href: '#chat',
      badge: 'New',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      ),
    },
    ...(user?.role === 'admin' ? [
      {
        name: 'Admin Console',
        href: '/admin',
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      }
    ] : [])
  ];

  return (
    <div id="app-layout" className={`min-h-screen bg-black text-white flex flex-col ${inter.className}`}>
      {/* Top Navbar */}
      <header className="bg-black/40 backdrop-blur-md h-14 flex items-center justify-between px-4 md:px-6 border-b border-white/10 sticky top-0 z-40">
        <div className="flex items-center space-x-4">
          {/* Mobile hamburger menu toggle */}
          <button
            onClick={() => setIsMobileSidebarOpen(true)}
            className="p-1 rounded text-gray-300 hover:text-white hover:bg-white/[0.08] md:hidden focus:outline-none focus:ring-1 focus:ring-[#FF9900]"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Title Logo */}
          <div className="flex items-center space-x-2 select-none">
            <div className="bg-[#FF9900] text-black font-extrabold text-sm px-2 py-0.5 rounded shadow-sm">
              AWS
            </div>
            <span className="text-white font-bold text-base tracking-tight hidden sm:inline">
              Personal Finance <span className="text-[#FF9900] font-light">Assistant</span>
            </span>
          </div>
        </div>

        {/* Global Search Bar */}
        <div className="flex-1 max-w-md mx-6 hidden md:block">
          <input
            type="search"
            placeholder="Search financial records, settings, and insights..."
            className="w-full bg-white/[0.04] text-sm text-white placeholder-gray-400 border border-white/10 rounded px-4 py-1.5 focus:outline-none focus:border-[#FF9900] focus:bg-white/[0.08] transition-all"
          />
        </div>

        {/* User profile & controls */}
        <div className="flex items-center space-x-3">
          {/* Notifications bell */}
          <div className="relative">
            <button
              onClick={() => {
                setIsNotificationsOpen(!isNotificationsOpen);
                setIsProfileDropdownOpen(false);
              }}
              className="p-1.5 rounded-full text-gray-300 hover:text-white hover:bg-white/[0.08] focus:outline-none relative"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-[#FF9900] rounded-full ring-2 ring-black"></span>
            </button>

            {/* Notifications Menu dropdown */}
            {isNotificationsOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-[#121212] border border-white/10 rounded-md shadow-lg py-1 text-white ring-1 ring-black/5 z-50">
                <div className="px-4 py-2 border-b border-white/10 font-semibold text-sm flex justify-between items-center">
                  <span>Notifications</span>
                  <span className="text-xs text-[#FF9900] cursor-pointer hover:underline">Mark all read</span>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  <div className="px-4 py-3 hover:bg-white/[0.04] border-b border-white/10 cursor-pointer">
                    <p className="text-xs font-semibold">Budget Warning</p>
                    <p className="text-xs text-gray-400 mt-0.5">Dining out category has reached 85% of budget.</p>
                    <span className="text-[10px] text-gray-500 mt-1 block">5 minutes ago</span>
                  </div>
                  <div className="px-4 py-3 hover:bg-white/[0.04] border-b border-white/10 cursor-pointer">
                    <p className="text-xs font-semibold">AI Insight Generated</p>
                    <p className="text-xs text-gray-400 mt-0.5">AI analyzed your weekend spending and created a report.</p>
                    <span className="text-[10px] text-gray-500 mt-1 block">2 hours ago</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Profile Dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setIsProfileDropdownOpen(!isProfileDropdownOpen);
                setIsNotificationsOpen(false);
              }}
              className="flex items-center space-x-2 text-sm focus:outline-none hover:opacity-90 py-1"
            >
              <div className="w-8 h-8 rounded-full bg-[#FF9900] text-black font-bold flex items-center justify-center border-2 border-[#FF9900] shadow-sm select-none">
                {getInitials(user?.full_name)}
              </div>
              <span className="hidden md:inline font-medium text-gray-300">{user?.full_name || 'AWS User'}</span>
              <svg className="w-3.5 h-3.5 text-gray-400 hidden md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Profile Dropdown Menu */}
            {isProfileDropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-[#121212] border border-white/10 rounded-md shadow-lg py-1 text-white ring-1 ring-black/5 z-50">
                <div className="px-4 py-2 border-b border-white/10">
                  <p className="text-xs text-gray-400">Signed in as</p>
                  <p className="text-sm font-semibold truncate">{user?.email || 'unknown@geonixa.com'}</p>
                </div>
                <Link href="#" className="block px-4 py-2 text-sm hover:bg-white/[0.04] transition-colors">Your Profile</Link>
                <Link href="/settings" className="block px-4 py-2 text-sm hover:bg-white/[0.04] transition-colors">Account Settings</Link>
                <Link href="#" className="block px-4 py-2 text-sm hover:bg-white/[0.04] transition-colors">AWS Billing Settings</Link>
                <div className="border-t border-white/10 my-1"></div>
                <button
                  onClick={logout}
                  className="w-full text-left block px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 relative">
        {/* Left Navigation Sidebar (Desktop) */}
        <aside className="w-64 bg-white/[0.02] backdrop-blur-xl text-white flex-shrink-0 hidden md:flex flex-col border-r border-white/10 justify-between z-30">
          <div className="py-4">
            <div className="px-4 mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500 select-none">
              Services
            </div>
            <nav className="space-y-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center justify-between px-4 py-2.5 text-sm font-medium transition-all group relative ${
                      isActive
                        ? 'bg-white/[0.06] border-l-4 border-[#FF9900] text-white'
                        : 'text-gray-400 hover:text-white hover:bg-white/[0.02] border-l-4 border-transparent'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <span className={isActive ? 'text-[#FF9900]' : 'text-gray-400 group-hover:text-white'}>
                        {item.icon}
                      </span>
                      <span>{item.name}</span>
                    </div>
                    {item.badge && (
                      <span className="bg-[#FF9900] text-black text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider scale-90">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Sidebar Footer */}
          <div className="p-4 border-t border-white/10 text-xs text-gray-400 flex flex-col space-y-2">
            <div className="flex items-center space-x-1">
              <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
              <span className="text-[11px]">Region: us-east-1</span>
            </div>
            <p>© 2026 Geonixa AWS Finance</p>
          </div>
        </aside>

        {/* Mobile Navigation Sidebar (Drawer overlay) */}
        {isMobileSidebarOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            {/* Overlay backdrop */}
            <div
              onClick={() => setIsMobileSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            ></div>

            {/* Sidebar content drawer */}
            <aside className="relative flex flex-col w-64 bg-black/90 backdrop-blur-2xl text-white h-full shadow-2xl border-r border-white/10 py-4 drawer-slide-in">
              <div className="flex items-center justify-between px-4 pb-4 border-b border-white/10">
                <span className="font-bold text-lg tracking-tight">
                  AWS <span className="text-[#FF9900] font-light">Finance AI</span>
                </span>
                <button
                  onClick={() => setIsMobileSidebarOpen(false)}
                  className="p-1 rounded text-gray-300 hover:text-white hover:bg-white/[0.08] focus:outline-none"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <nav className="mt-4 space-y-1 flex-1">
                {navigation.map((item) => {
                  const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setIsMobileSidebarOpen(false)}
                      className={`flex items-center justify-between px-4 py-3 text-sm font-medium transition-all ${
                        isActive
                          ? 'bg-white/[0.06] border-l-4 border-[#FF9900] text-white'
                          : 'text-gray-400 hover:text-white hover:bg-white/[0.02] border-l-4 border-transparent'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <span className={isActive ? 'text-[#FF9900]' : 'text-gray-400'}>
                          {item.icon}
                        </span>
                        <span>{item.name}</span>
                      </div>
                      {item.badge && (
                        <span className="bg-[#FF9900] text-black text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>

              <div className="p-4 border-t border-white/10 text-xs text-gray-400 space-y-2">
                <div className="flex items-center space-x-1">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                  <span className="text-[11px]">Region: us-east-1 (N. Virginia)</span>
                </div>
                <p>© 2026 Geonixa AWS Finance</p>
              </div>
            </aside>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-black">
          <div className="p-6 md:p-8 flex-1 max-w-7xl w-full mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
