"""
LLM response generation for the RAG chatbot.

This module takes the structured context from ``rag_retrieval`` and
produces a natural-language response.

Architecture
────────────
Four modes of operation, in priority order:

1. **Google Gemini** (free tier) — GEMINI_API_KEY set → uses Gemini 1.5
   Flash via the google-generativeai SDK.  Free tier: 15 RPM,
   1 million tokens/day, 1,500 requests/day.

2. **Groq** (free tier) — GROQ_API_KEY set → uses Llama 3 70B via the
   OpenAI-compatible Groq API.  Free tier: 30 RPM, 14,400 req/day.

3. **OpenAI** (paid) — OPENAI_API_KEY set → uses GPT-4o-mini.

4. **Built-in generator** (default) — Uses template-based responses
   crafted from the retrieved data.  Zero external API dependencies.

The built-in generator is production-ready for common queries and
serves as a reliable fallback if any LLM API is unreachable.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from enum import Enum

from app.core.config import settings

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
#  LLM Provider Enum
# ═══════════════════════════════════════════════════════════════════════════
class LLMProvider(str, Enum):
    GEMINI = "gemini"
    GROQ = "groq"
    OPENAI = "openai"
    BUILTIN = "builtin"


def _detect_provider() -> LLMProvider:
    """Auto-detect the best available LLM provider based on env config."""
    if settings.GEMINI_API_KEY:
        return LLMProvider.GEMINI
    if settings.GROQ_API_KEY:
        return LLMProvider.GROQ
    if settings.OPENAI_API_KEY:
        return LLMProvider.OPENAI
    return LLMProvider.BUILTIN


# ═══════════════════════════════════════════════════════════════════════════
#  System Prompt (shared across all LLM providers)
# ═══════════════════════════════════════════════════════════════════════════
SYSTEM_PROMPT = """You are an expert personal finance AI assistant embedded in a banking application.

CRITICAL RULES:
1. You ONLY answer questions about the user's personal finances using the data provided in the context.
2. NEVER fabricate data. If the context doesn't contain the answer, say so honestly.
3. NEVER reveal SQL, database schema, internal system details, or other users' data.
4. Be concise, friendly, and use specific numbers from the context.
5. Format currency values with ₹ symbol and 2 decimal places (Indian Rupees).
6. When discussing spending, always mention the time period.
7. Proactively suggest actionable financial advice when relevant.
8. Use bullet points and clear formatting for readability.
9. You can also answer general financial literacy questions (e.g., "What is an ETF?", "How does compound interest work?") using your knowledge — but always prioritise the user's actual data when available.
10. If the user asks something outside of personal finance, politely redirect them back to financial topics.
11. RESTRICTION: You are a READ-ONLY assistant. You CANNOT create goals, transfer money, or perform any actions on behalf of the user. NEVER offer to "set up", "create", or "schedule" anything. If a user asks to create a savings goal or make a transaction, politely inform them that you are a read-only assistant and direct them to use the "Savings Planner" or "Transactions" tabs in their dashboard.

You have access to the user's real financial data provided below. Use it to give accurate, personalised responses."""


DEFAULT_SUGGESTIONS = [
    "Show my spending by category",
    "What's my budget status?",
    "How are my savings goals?",
]


def _build_context_message(context: dict, user_name: str) -> str:
    """Build the context injection message for any LLM provider."""
    context_str = json.dumps(context.get("data", {}), indent=2, default=str)
    return (
        f"User's name: {user_name}\n"
        f"Current date: {date.today().isoformat()}\n"
        f"Retrieved financial data:\n```json\n{context_str}\n```"
    )


# ═══════════════════════════════════════════════════════════════════════════
#  Built-in Template Generator
# ═══════════════════════════════════════════════════════════════════════════
def _fmt(val: float) -> str:
    return f"₹{val:,.2f}"


def _generate_builtin_response(context: dict) -> tuple[str, list[str]]:
    """
    Generate a natural-language response from structured context
    without calling an external LLM.

    Returns (reply, suggestions).
    """
    intent = context.get("intent", "general")
    data = context.get("data", {})
    time_range = context.get("time_range", "this month")

    suggestions: list[str] = []

    # ── Total Spending ───────────────────────────────────────────────
    if intent == "total_spending":
        total = data.get("total_spent", 0)
        count = data.get("transaction_count", 0)
        category = data.get("category")
        period = data.get("time_range", "this month")

        if category:
            cat_label = category.replace("_", " ").title()
            reply = (
                f"📊 You've spent **{_fmt(total)}** on **{cat_label}** {period}, "
                f"across **{count}** transaction{'s' if count != 1 else ''}."
            )
            suggestions = [
                f"Show me my {cat_label} spending trend",
                "What's my overall budget status?",
                "What are my top 5 expenses?",
            ]
        else:
            reply = (
                f"💰 Your total spending {period} is **{_fmt(total)}** "
                f"across **{count}** transaction{'s' if count != 1 else ''}."
            )
            suggestions = [
                "Break down my spending by category",
                "What are my biggest expenses?",
                "Am I over budget anywhere?",
            ]

    # ── Spending by Category ─────────────────────────────────────────
    elif intent == "spending_by_category":
        if "categories" in data:
            cats = data["categories"]
            grand_total = data.get("grand_total", 0)
            period = data.get("time_range", "this month")

            if not cats:
                reply = f"No expenses recorded for {period}."
            else:
                lines = [f"📊 **Spending Breakdown** ({period}) — Total: **{_fmt(grand_total)}**\n"]
                for cat in cats[:8]:
                    cat_label = cat["category"].replace("_", " ").title()
                    bar_fill = "█" * max(1, int(cat["percentage"] / 5))
                    lines.append(
                        f"• **{cat_label}**: {_fmt(cat['total'])} "
                        f"({cat['percentage']}%) {bar_fill}"
                    )
                reply = "\n".join(lines)

            suggestions = [
                "Which category grew the most?",
                "Show my top 5 expenses",
                "What's my budget status?",
            ]
        else:
            # Single category query
            total = data.get("total_spent", 0)
            category = data.get("category", "unknown")
            period = data.get("time_range", "this month")
            cat_label = category.replace("_", " ").title()

            reply = (
                f"📊 You've spent **{_fmt(total)}** on **{cat_label}** {period}."
            )
            suggestions = [
                "Show all categories",
                f"Compare {cat_label} to last month",
                "What's my budget status?",
            ]

    # ── Top Spending ─────────────────────────────────────────────────
    elif intent == "top_spending":
        txns = data.get("transactions", [])
        period = data.get("time_range", "this month")

        if not txns:
            reply = f"No expenses found for {period}."
        else:
            lines = [f"🔝 **Top {len(txns)} Expenses** ({period}):\n"]
            for i, t in enumerate(txns, 1):
                cat_label = t["category"].replace("_", " ").title()
                lines.append(
                    f"{i}. **{t['description']}** — {_fmt(t['amount'])} "
                    f"({cat_label}, {t['date']})"
                )
            reply = "\n".join(lines)

        suggestions = [
            "Show my spending by category",
            "Am I over budget?",
            "Show recurring subscriptions",
        ]

    # ── Recent Transactions ──────────────────────────────────────────
    elif intent == "recent_transactions":
        txns = data.get("transactions", [])

        if not txns:
            reply = "No transactions found in your history."
        else:
            lines = [f"📋 **Last {len(txns)} Transactions**:\n"]
            for t in txns:
                emoji = "🟢" if t["type"] == "income" else "🔴"
                sign = "+" if t["type"] == "income" else "-"
                lines.append(
                    f"{emoji} {t['date']} — {t['description']}: "
                    f"**{sign}{_fmt(t['amount'])}** ({t['category'].replace('_', ' ').title()})"
                )
            reply = "\n".join(lines)

        suggestions = [
            "How much did I spend this month?",
            "Show my top expenses",
            "What's my income this month?",
        ]

    # ── Income Summary ───────────────────────────────────────────────
    elif intent == "income_summary":
        sources = data.get("sources", [])
        grand_total = data.get("grand_total", 0)
        period = data.get("time_range", "this month")

        if not sources:
            reply = f"No income recorded for {period}."
        else:
            lines = [f"💵 **Income Summary** ({period}) — Total: **{_fmt(grand_total)}**\n"]
            for s in sources:
                cat_label = s["category"].replace("_", " ").title()
                lines.append(f"• **{cat_label}**: {_fmt(s['total'])} ({s['count']} entries)")
            reply = "\n".join(lines)

        suggestions = [
            "Compare income to expenses",
            "Show my net savings this month",
            "What are my biggest expenses?",
        ]

    # ── Budget Status ────────────────────────────────────────────────
    elif intent == "budget_status":
        budgets = data.get("budgets", [])

        if not budgets:
            reply = (
                "You don't have any active budgets set up for this period. "
                "Would you like me to help you create some?"
            )
        else:
            lines = ["📋 **Budget Status** (current period):\n"]
            for b in budgets:
                cat_label = b["category"].replace("_", " ").title()
                status_emoji = "🚨" if b["status"] == "exceeded" else ("⚠️" if b["status"] == "warning" else "✅")
                lines.append(
                    f"{status_emoji} **{cat_label}**: {_fmt(b['spent'])} / "
                    f"{_fmt(b['limit'])} ({b['percentage']}%)"
                )
            exceeded = [b for b in budgets if b["status"] == "exceeded"]
            if exceeded:
                lines.append(
                    f"\n⚠️ You've exceeded **{len(exceeded)}** budget{'s' if len(exceeded) > 1 else ''}! "
                    "Consider reviewing your spending in those categories."
                )
            reply = "\n".join(lines)

        suggestions = [
            "Which category am I spending most on?",
            "Show me tips to stay on budget",
            "What are my savings goals?",
        ]

    # ── Savings Goals ────────────────────────────────────────────────
    elif intent == "savings_goals":
        goals = data.get("goals", [])

        if not goals:
            reply = (
                "You don't have any active savings goals. "
                "Setting specific targets can really help with financial discipline!"
            )
        else:
            lines = ["🎯 **Savings Goals Progress**:\n"]
            for g in goals:
                bar_pct = min(int(g["percentage"]), 100)
                bar_fill = "█" * max(1, bar_pct // 5)
                bar_empty = "░" * (20 - len(bar_fill))
                target_info = f" (by {g['target_date']})" if g.get("target_date") else ""
                lines.append(
                    f"• **{g['name']}**: {_fmt(g['current'])} / {_fmt(g['target'])} "
                    f"({g['percentage']}%){target_info}\n  {bar_fill}{bar_empty}"
                )
            reply = "\n".join(lines)

        suggestions = [
            "How can I save more?",
            "What's my monthly income?",
            "Show my spending breakdown",
        ]

    # ── Account Balance ──────────────────────────────────────────────
    elif intent == "account_balance":
        accounts = data.get("accounts", [])
        total = data.get("total_balance", 0)

        if not accounts:
            reply = "No bank accounts found. Link an account to get started."
        else:
            lines = [f"🏦 **Account Balances** — Net: **{_fmt(total)}**\n"]
            for a in accounts:
                type_label = a["type"].replace("_", " ").title()
                lines.append(
                    f"• **{a['name']}** ({type_label}): {_fmt(a['balance'])} {a['currency']}"
                )
            reply = "\n".join(lines)

        suggestions = [
            "Show my spending this month",
            "What's my income vs expenses?",
            "Show my savings goals",
        ]

    # ── Recurring Transactions ───────────────────────────────────────
    elif intent == "recurring_transactions":
        recurring = data.get("recurring", [])
        total_monthly = data.get("total_monthly", 0)

        if not recurring:
            reply = "No recurring transactions detected in your history."
        else:
            lines = [f"🔄 **Recurring Charges** — Monthly Total: **{_fmt(total_monthly)}**\n"]
            for r in recurring:
                cat_label = r["category"].replace("_", " ").title()
                lines.append(
                    f"• **{r['description']}**: {_fmt(r['amount'])} ({cat_label})"
                )
            reply = "\n".join(lines)

        suggestions = [
            "Which subscriptions can I cancel?",
            "Show my total expenses",
            "What's my budget status?",
        ]

    # ── Spending Comparison ──────────────────────────────────────────
    elif intent == "spending_comparison":
        current = data.get("current_month", {})
        previous = data.get("last_month", {})
        curr_total = current.get("grand_total", 0)
        prev_total = previous.get("grand_total", 0)

        if prev_total > 0:
            change_pct = ((curr_total - prev_total) / prev_total) * 100
            direction = "📈 increased" if change_pct > 0 else "📉 decreased"
            reply = (
                f"**Month-over-Month Comparison:**\n\n"
                f"• This month: **{_fmt(curr_total)}**\n"
                f"• Last month: **{_fmt(prev_total)}**\n"
                f"• Change: {direction} by **{abs(change_pct):.1f}%** "
                f"({'+' if change_pct > 0 else ''}{_fmt(curr_total - prev_total)})"
            )
        else:
            reply = (
                f"This month's spending is **{_fmt(curr_total)}**. "
                "No data available for last month to compare."
            )

        suggestions = [
            "Which category changed the most?",
            "Show my budget status",
            "What are my top expenses?",
        ]

    # ── Help ─────────────────────────────────────────────────────────
    elif intent == "help":
        reply = (
            "🤖 **I'm your AI Finance Assistant!** Here's what I can help with:\n\n"
            "• 💰 **Spending Analysis** — \"How much did I spend on dining last month?\"\n"
            "• 📊 **Category Breakdown** — \"Show my spending by category\"\n"
            "• 🔝 **Top Expenses** — \"What are my biggest expenses?\"\n"
            "• 📋 **Budget Tracking** — \"Am I over budget anywhere?\"\n"
            "• 🎯 **Savings Goals** — \"How are my savings goals going?\"\n"
            "• 🏦 **Account Balances** — \"What's my net worth?\"\n"
            "• 🔄 **Subscriptions** — \"Show my recurring charges\"\n"
            "• 📈 **Trends** — \"Compare this month to last month\"\n"
            "• 💵 **Income** — \"What's my income this month?\"\n\n"
            "Just ask in plain English — I'll look up your real data!"
        )
        suggestions = [
            "Show my spending this month",
            "What's my budget status?",
            "How are my savings goals?",
        ]

    # ── General / Fallback ───────────────────────────────────────────
    else:
        spending = data.get("spending", {})
        categories = data.get("categories", {})
        savings_data = data.get("savings_goals", {})

        total = spending.get("total_spent", 0)
        count = spending.get("transaction_count", 0)
        top_cats = categories.get("categories", [])[:3]
        goals = savings_data.get("goals", []) if savings_data else []

        lines = [
            f"Here's a quick snapshot of your finances this month:\n",
            f"• **Total Spending**: {_fmt(total)} ({count} transactions)",
        ]
        if top_cats:
            lines.append("• **Top Categories**:")
            for c in top_cats:
                cat_label = c["category"].replace("_", " ").title()
                lines.append(f"  — {cat_label}: {_fmt(c['total'])} ({c['percentage']}%)")

        if goals:
            lines.append("\n🎯 **Savings Goals**:")
            for g in goals:
                target_info = f" (by {g['target_date']})" if g.get("target_date") else ""
                lines.append(
                    f"• **{g['name']}**: {_fmt(g['current'])} / {_fmt(g['target'])} "
                    f"({g['percentage']}%){target_info}"
                )
        else:
            lines.append("\n🎯 No active savings goals — consider setting one!")

        lines.append("\nAsk me anything specific about your finances!")
        reply = "\n".join(lines)

        suggestions = [
            "Break down spending by category",
            "What's my budget status?",
            "Show my savings goals",
        ]

    return reply, suggestions


# ═══════════════════════════════════════════════════════════════════════════
#  Google Gemini Generator (FREE TIER — Primary)
#  ─────────────────────────────────────────────
#  Free tier limits (as of 2026):
#    • 15 requests per minute
#    • 1,000,000 tokens per day
#    • 1,500 requests per day
#  Docs: https://ai.google.dev/pricing
# ═══════════════════════════════════════════════════════════════════════════
async def _generate_gemini_response(
    query: str,
    context: dict,
    user_name: str,
) -> tuple[str, list[str]]:
    """
    Send context + query to Google Gemini 1.5 Flash (free tier).
    Falls back to built-in generator on any error.
    """
    try:
        import google.generativeai as genai

        genai.configure(api_key=settings.GEMINI_API_KEY)

        model = genai.GenerativeModel(
            model_name="gemini-2.5-flash",
            system_instruction=SYSTEM_PROMPT,
            generation_config=genai.GenerationConfig(
                temperature=0.3,
                max_output_tokens=800,
                top_p=0.9,
            ),
        )

        context_msg = _build_context_message(context, user_name)
        prompt = f"{context_msg}\n\nUser question: {query}"

        response = model.generate_content(prompt)

        if response and response.text:
            reply = response.text.strip()
            logger.info("Gemini 1.5 Flash response generated successfully")
            return reply, DEFAULT_SUGGESTIONS.copy()
        else:
            raise ValueError("Gemini returned empty response")

    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        logger.error(f"Gemini call failed:\\n{error_details}")
        raise

# ═══════════════════════════════════════════════════════════════════════════
#  Groq Generator (FREE TIER — Secondary)
#  ───────────────────────────────────────
#  Free tier limits (as of 2026):
#    • 30 requests per minute
#    • 14,400 requests per day
#    • 6,000 tokens per minute (Llama 3 70B)
#  Docs: https://console.groq.com/docs/rate-limits
#  API: OpenAI-compatible — uses httpx directly (no extra SDK needed)
# ═══════════════════════════════════════════════════════════════════════════
async def _generate_groq_response(
    query: str,
    context: dict,
    user_name: str,
) -> tuple[str, list[str]]:
    """
    Send context + query to Groq (Llama 3 70B) via OpenAI-compatible API.
    Falls back to built-in generator on any error.
    """
    try:
        import httpx

        context_msg = _build_context_message(context, user_name)

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "system", "content": context_msg},
            {"role": "user", "content": query},
        ]

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": 800,
                },
            )
            response.raise_for_status()
            result = response.json()
            reply = result["choices"][0]["message"]["content"].strip()

            logger.info("Groq (Llama 3.1 70B) response generated successfully")
            return reply, DEFAULT_SUGGESTIONS.copy()

    except Exception as e:
        logger.warning(f"Groq call failed ({type(e).__name__}: {e})")
        raise


# ═══════════════════════════════════════════════════════════════════════════
#  OpenAI Generator (PAID — Tertiary / Legacy)
# ═══════════════════════════════════════════════════════════════════════════
async def _generate_openai_response(
    query: str,
    context: dict,
    user_name: str,
) -> tuple[str, list[str]]:
    """
    Send context + query to OpenAI GPT-4o-mini.
    Falls back to built-in generator on any error.
    """
    try:
        import httpx

        context_msg = _build_context_message(context, user_name)

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "system", "content": context_msg},
            {"role": "user", "content": query},
        ]

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": messages,
                    "temperature": 0.3,
                    "max_tokens": 800,
                },
            )
            response.raise_for_status()
            result = response.json()
            reply = result["choices"][0]["message"]["content"].strip()

            logger.info("OpenAI (GPT-4o-mini) response generated successfully")
            return reply, DEFAULT_SUGGESTIONS.copy()

    except Exception as e:
        logger.warning(f"OpenAI call failed ({type(e).__name__}: {e})")
        raise


# ═══════════════════════════════════════════════════════════════════════════
#  Provider Router Map
# ═══════════════════════════════════════════════════════════════════════════
_PROVIDER_HANDLERS = {
    LLMProvider.GEMINI: _generate_gemini_response,
    LLMProvider.GROQ: _generate_groq_response,
    LLMProvider.OPENAI: _generate_openai_response,
}


# ═══════════════════════════════════════════════════════════════════════════
#  Public API
# ═══════════════════════════════════════════════════════════════════════════
async def generate_response(
    query: str,
    context: dict,
    user_name: str = "User",
) -> tuple[str, list[str]]:
    """
    Generate an AI response for a user query.

    Provider selection priority:
        1. GEMINI_API_KEY → Google Gemini 1.5 Flash (free)
        2. GROQ_API_KEY   → Groq Llama 3.1 70B (free)
        3. OPENAI_API_KEY → OpenAI GPT-4o-mini (paid)
        4. (none)         → Built-in template generator

    All LLM providers fall back to the built-in generator on error.
    """
    providers_to_try = []
    
    if settings.GEMINI_API_KEY:
        providers_to_try.append(LLMProvider.GEMINI)
    if settings.GROQ_API_KEY:
        providers_to_try.append(LLMProvider.GROQ)
    if settings.OPENAI_API_KEY:
        providers_to_try.append(LLMProvider.OPENAI)
        
    for provider in providers_to_try:
        try:
            handler = _PROVIDER_HANDLERS[provider]
            logger.info(f"Attempting LLM provider: {provider.value}")
            return await handler(query, context, user_name)
        except Exception as e:
            logger.warning(f"Provider {provider.value} failed, trying next. Error: {e}")
            continue

    logger.warning("All configured LLM providers failed or none configured. Falling back to built-in template generator.")
    return _generate_builtin_response(context)


def get_active_provider() -> dict:
    """Return info about the currently active LLM provider (for diagnostics)."""
    provider = _detect_provider()
    provider_info = {
        LLMProvider.GEMINI: {
            "name": "Google Gemini 1.5 Flash",
            "tier": "free",
            "limits": "15 RPM / 1M tokens per day / 1,500 req per day",
        },
        LLMProvider.GROQ: {
            "name": "Groq (Llama 3.1 70B Versatile)",
            "tier": "free",
            "limits": "30 RPM / 14,400 req per day",
        },
        LLMProvider.OPENAI: {
            "name": "OpenAI GPT-4o-mini",
            "tier": "paid",
            "limits": "Usage-based pricing",
        },
        LLMProvider.BUILTIN: {
            "name": "Built-in Template Engine",
            "tier": "free",
            "limits": "Unlimited (no external API calls)",
        },
    }
    info = provider_info[provider]
    info["provider_key"] = provider.value
    return info
