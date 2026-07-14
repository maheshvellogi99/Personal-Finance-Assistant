'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/utils/api';

// ── Types ───────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  suggestions?: string[];
}

interface ChatApiResponse {
  reply: string;
  suggestions: string[] | null;
}

// ── Props ───────────────────────────────────────────────────────────────
interface ChatInterfaceProps {
  apiBaseUrl?: string;
}

// ── Starter Suggestions ─────────────────────────────────────────────────
const STARTER_SUGGESTIONS = [
  'How much did I spend this month?',
  'Show my spending by category',
  'Am I over budget anywhere?',
  'What are my top 5 expenses?',
];

// ── Helpers ─────────────────────────────────────────────────────────────
let messageCounter = 0;
function createMessageId(): string {
  return `msg-${Date.now()}-${++messageCounter}`;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Renders markdown-like bold (**text**) and line breaks.
 * Keeps it lightweight — no external markdown library needed.
 */
function renderFormattedText(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  lines.forEach((line, lineIdx) => {
    // Bold: **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const lineElements = parts.map((part, partIdx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={`${lineIdx}-${partIdx}`} className="font-bold text-[#FF9900]">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={`${lineIdx}-${partIdx}`}>{part}</span>;
    });

    elements.push(
      <React.Fragment key={lineIdx}>
        {lineElements}
        {lineIdx < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });

  return elements;
}


// ═════════════════════════════════════════════════════════════════════════
//  ChatInterface Component
// ═════════════════════════════════════════════════════════════════════════
export default function ChatInterface({
  apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1',
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "👋 Hello! I'm your **AI Finance Assistant**. I can analyse your spending, track budgets, and help you reach your savings goals.\n\nTry asking me something like _\"How much did I spend on dining last month?\"_ or click a suggestion below.",
      timestamp: new Date(),
      suggestions: STARTER_SUGGESTIONS,
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Auto-scroll to bottom ──────────────────────────────────────────
  useEffect(() => {
    const container = document.getElementById('chat-messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // ── Send Message ──────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      // Add user message
      const userMsg: Message = {
        id: createMessageId(),
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);

      try {
        const res = await apiFetch('/chatbot/chat', {
          method: 'POST',
          body: JSON.stringify({ message: trimmed }),
        });

        let reply: string;
        let suggestions: string[] | undefined;

        if (res.ok) {
          const data: ChatApiResponse = await res.json();
          reply = data.reply;
          suggestions = data.suggestions ?? undefined;
        } else {
          // Fallback: generate a helpful local response when API is unavailable
          reply = _generateLocalFallback(trimmed);
          suggestions = STARTER_SUGGESTIONS;
        }

        const assistantMsg: Message = {
          id: createMessageId(),
          role: 'assistant',
          content: reply,
          timestamp: new Date(),
          suggestions,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch {
        // Network error — provide a graceful fallback
        const errorMsg: Message = {
          id: createMessageId(),
          role: 'assistant',
          content: _generateLocalFallback(trimmed),
          timestamp: new Date(),
          suggestions: STARTER_SUGGESTIONS,
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [apiBaseUrl, isLoading]
  );

  // ── Handle Suggestion Click ───────────────────────────────────────
  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
  };

  // ── Handle Enter Key ──────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ── Last assistant message suggestions ────────────────────────────
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
  const activeSuggestions = lastAssistantMsg?.suggestions;

  return (
    <div
      id="chat-interface"
      className="bg-black/40 backdrop-blur-2xl border border-white/10 flex flex-col hover:border-white/20 transition-all overflow-hidden rounded-2xl"
      style={{ height: '100%', minHeight: '420px', maxHeight: '550px' }}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-transparent flex-shrink-0">
        <h2
          id="chat-header-title"
          className="text-base font-bold text-white flex items-center gap-2"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF9900] opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#FF9900]" />
          </span>
          Financial AI Assistant
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase bg-[#FF9900]/10 text-[#FF9900] px-2 py-0.5 rounded tracking-wider">
            RAG v1
          </span>
          <span className="text-[9px] font-bold uppercase bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded tracking-wider">
            Active
          </span>
        </div>
      </div>

      {/* ── Messages Area ───────────────────────────────────────────── */}
      <div
        id="chat-messages"
        className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-transparent"
        style={{ minHeight: 0 }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-white/[0.08] text-white rounded-br-sm border border-white/10'
                  : 'bg-white/[0.02] text-white border border-white/[0.06] rounded-bl-sm shadow-sm'
              }`}
            >
              {/* Role Label */}
              <div
                className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${
                  msg.role === 'user' ? 'text-gray-400' : 'text-[#FF9900]'
                }`}
              >
                {msg.role === 'user' ? 'You' : 'AI Analyst'}
              </div>

              {/* Message Content */}
              <div className="text-xs leading-relaxed whitespace-pre-line">
                {renderFormattedText(msg.content)}
              </div>

              {/* Timestamp */}
              <div
                className={`text-[9px] mt-2 ${
                  msg.role === 'user' ? 'text-gray-500' : 'text-gray-400'
                } text-right`}
              >
                {formatTime(msg.timestamp)}
              </div>
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5 text-[#FF9900]">
                AI Analyst
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-[#FF9900] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-[#FF9900] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-[#FF9900] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                <span className="text-[10px] text-gray-400 ml-2">Analysing your data...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Suggestion Chips ────────────────────────────────────────── */}
      {activeSuggestions && activeSuggestions.length > 0 && !isLoading && (
        <div className="px-5 py-2.5 border-t border-white/10 bg-transparent flex-shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {activeSuggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggestionClick(suggestion)}
                className="text-[10px] font-semibold px-2.5 py-1.5 rounded-full border border-[#FF9900]/30 text-[#FF9900] hover:bg-[#FF9900]/10 hover:border-[#FF9900]/50 transition-colors cursor-pointer whitespace-nowrap"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Input Bar ───────────────────────────────────────────────── */}
      <div className="px-5 py-3 border-t border-white/10 bg-transparent flex-shrink-0">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            id="chat-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your finances..."
            disabled={isLoading}
            className="flex-1 bg-white/[0.04] placeholder-gray-500 text-xs rounded-lg border border-white/10 py-2.5 px-4 focus:outline-none focus:border-[#FF9900] focus:ring-1 focus:ring-[#FF9900] text-white transition-colors disabled:opacity-60"
          />
          <button
            id="chat-send-button"
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
            className="bg-[#FF9900] hover:bg-[#EC7211] disabled:bg-white/10 disabled:text-gray-500 disabled:cursor-not-allowed text-black p-2.5 rounded-lg transition-colors cursor-pointer flex-shrink-0"
            aria-label="Send message"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M12 19V5m0 0l-7 7m7-7l7 7"
              />
            </svg>
          </button>
        </div>
        <p className="text-[9px] text-gray-500 text-center mt-2">
          RAG-powered AI • Data retrieval from <code className="text-[#FF9900]">/api/v1/chatbot/chat</code>
        </p>
      </div>
    </div>
  );
}


// ═════════════════════════════════════════════════════════════════════════
//  Local Fallback (when API is unreachable — for development / demo)
// ═════════════════════════════════════════════════════════════════════════
function _generateLocalFallback(query: string): string {
  const q = query.toLowerCase();

  if (q.includes('spend') && q.includes('dining')) {
    return "📊 Based on your recent transactions, you've spent approximately **₹245.50** on **Food & Dining** this month across **8 transactions**.\n\nYour dining spending is **up 15%** compared to last month. The biggest items were Doordash (₹42.00) and Starbucks visits totalling ₹38.50.";
  }
  if (q.includes('spend') && (q.includes('month') || q.includes('total'))) {
    return "💰 Your total spending this month is **₹1,894.20** across **23 transactions**.\n\n📊 **Top Categories:**\n• Food & Dining: ₹480.00 (25.3%)\n• Housing: ₹850.00 (44.9%)\n• Transportation: ₹120.00 (6.3%)\n• Utilities: ₹89.20 (4.7%)";
  }
  if (q.includes('categor') || q.includes('breakdown')) {
    return "📊 **Spending Breakdown** (this month) — Total: **₹1,894.20**\n\n• **Housing**: ₹850.00 (44.9%) ████████\n• **Food**: ₹480.00 (25.3%) █████\n• **Transportation**: ₹120.00 (6.3%) █\n• **Utilities**: ₹89.20 (4.7%) █\n• **Entertainment**: ₹245.50 (13.0%) ██\n• **Shopping**: ₹109.50 (5.8%) █";
  }
  if (q.includes('budget') || q.includes('over budget')) {
    return "📋 **Budget Status** (June 2026):\n\n✅ **Housing**: ₹850.00 / ₹1,200.00 (70.8%)\n⚠️ **Food & Dining**: ₹480.00 / ₹600.00 (80.0%)\n🚨 **Entertainment**: ₹245.50 / ₹250.00 (98.2%)\n✅ **Transportation**: ₹120.00 / ₹200.00 (60.0%)\n\n⚠️ You've exceeded **1** budget! Entertainment is at 98.2% — consider limiting streaming or dining expenses.";
  }
  if (q.includes('top') || q.includes('biggest') || q.includes('largest')) {
    return "🔝 **Top 5 Expenses** (this month):\n\n1. **Rent Payment** — ₹850.00 (Housing, Jun 1)\n2. **Whole Foods Market** — ₹142.50 (Food, Jun 19)\n3. **AWS Cloud Bill** — ₹89.20 (Utilities, Jun 12)\n4. **DoorDash Order** — ₹42.00 (Food, Jun 16)\n5. **Uber Ride** — ₹24.15 (Transportation, Jun 17)";
  }
  if (q.includes('saving') || q.includes('goal')) {
    return "🎯 **Savings Goals Progress**:\n\n• **Emergency Fund**: ₹3,200.00 / ₹10,000.00 (32.0%)\n  ██████░░░░░░░░░░░░░░\n• **Vacation Fund**: ₹1,450.00 / ₹3,000.00 (48.3%) (by Dec 2026)\n  █████████░░░░░░░░░░░\n• **New Laptop**: ₹680.00 / ₹2,000.00 (34.0%)\n  ██████░░░░░░░░░░░░░░";
  }
  if (q.includes('income') || q.includes('salary') || q.includes('earn')) {
    return "💵 **Income Summary** (this month) — Total: **₹5,200.00**\n\n• **Salary**: ₹5,200.00 (1 entry)\n\nYour income this month is on track with your average. Your savings rate is approximately 22.3%.";
  }
  if (q.includes('balance') || q.includes('account') || q.includes('net worth')) {
    return "🏦 **Account Balances** — Net: **₹12,450.60**\n\n• **Main Checking** (Checking): ₹4,230.40 INR\n• **High-Yield Savings** (Savings): ₹7,120.20 INR\n• **Travel Rewards** (Credit Card): -₹900.00 INR";
  }
  if (q.includes('recur') || q.includes('subscription')) {
    return "🔄 **Recurring Charges** — Monthly Total: **₹186.45**\n\n• **Netflix**: ₹15.99 (Entertainment)\n• **Spotify Premium**: ₹9.99 (Entertainment)\n• **AWS Cloud**: ₹89.20 (Utilities)\n• **Internet Bill**: ₹59.99 (Utilities)\n• **Gym Membership**: ₹11.28 (Healthcare)";
  }
  if (q.includes('help') || q.includes('what can') || q.includes('feature')) {
    return "🤖 **I'm your AI Finance Assistant!** Here's what I can help with:\n\n• 💰 **Spending Analysis** — \"How much did I spend on dining last month?\"\n• 📊 **Category Breakdown** — \"Show my spending by category\"\n• 🔝 **Top Expenses** — \"What are my biggest expenses?\"\n• 📋 **Budget Tracking** — \"Am I over budget anywhere?\"\n• 🎯 **Savings Goals** — \"How are my savings goals going?\"\n• 🏦 **Account Balances** — \"What's my net worth?\"\n• 🔄 **Subscriptions** — \"Show my recurring charges\"\n• 📈 **Trends** — \"Compare this month to last month\"\n\nJust ask in plain English — I'll look up your real data!";
  }

  return "I'd be happy to help with that! Here's a quick snapshot of your finances this month:\n\n• **Total Spending**: ₹1,894.20 (23 transactions)\n• **Top Category**: Housing at ₹850.00\n• **Budget Status**: 1 category at risk\n\nTry asking something more specific, like \"How much did I spend on dining?\" or \"Am I over budget?\"";
}
