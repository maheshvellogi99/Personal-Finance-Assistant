"""
Financial data retrieval service for RAG-based chatbot.

This module provides secure, user-scoped data retrieval functions that the
chatbot uses to ground LLM responses in the user's actual financial data.

Security
────────
Every query is parameterised and filtered by ``user_id`` — there is no
possibility of cross-user data leakage.  Raw SQL is never constructed from
user input; instead, intent is parsed into structured retrieval calls.

Architecture
────────────
    User query  →  Intent classifier (keyword rules)
                →  Appropriate retrieval function(s)
                →  Structured context dict
                →  LLM prompt builder
                →  Natural-language response
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select, case, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    BankAccount,
    Budget,
    SavingsGoal,
    Transaction,
    TransactionCategory,
    TransactionType,
)


# ═══════════════════════════════════════════════════════════════════════════
#  Intent Detection
# ═══════════════════════════════════════════════════════════════════════════
@dataclass
class ParsedIntent:
    """Structured representation of what the user is asking about."""

    intent: str = "general_inquiry"  # e.g. "spending_by_category", "total_spending", "budget_status", etc.
    category: str | None = None
    time_range: str = "this_month"  # "this_month", "last_month", "this_year", "last_7_days", "all", "specific_date"
    specific_date: date | None = None
    merchant: str | None = None
    raw_query: str = ""


_CATEGORY_KEYWORDS: dict[str, TransactionCategory] = {
    "food": TransactionCategory.FOOD,
    "dining": TransactionCategory.FOOD,
    "groceries": TransactionCategory.FOOD,
    "grocery": TransactionCategory.FOOD,
    "restaurant": TransactionCategory.FOOD,
    "eating": TransactionCategory.FOOD,
    "housing": TransactionCategory.HOUSING,
    "rent": TransactionCategory.HOUSING,
    "mortgage": TransactionCategory.HOUSING,
    "transport": TransactionCategory.TRANSPORTATION,
    "transportation": TransactionCategory.TRANSPORTATION,
    "uber": TransactionCategory.TRANSPORTATION,
    "lyft": TransactionCategory.TRANSPORTATION,
    "gas": TransactionCategory.TRANSPORTATION,
    "utilities": TransactionCategory.UTILITIES,
    "electric": TransactionCategory.UTILITIES,
    "internet": TransactionCategory.UTILITIES,
    "phone": TransactionCategory.UTILITIES,
    "healthcare": TransactionCategory.HEALTHCARE,
    "medical": TransactionCategory.HEALTHCARE,
    "doctor": TransactionCategory.HEALTHCARE,
    "entertainment": TransactionCategory.ENTERTAINMENT,
    "netflix": TransactionCategory.ENTERTAINMENT,
    "streaming": TransactionCategory.ENTERTAINMENT,
    "movies": TransactionCategory.ENTERTAINMENT,
    "shopping": TransactionCategory.SHOPPING,
    "amazon": TransactionCategory.SHOPPING,
    "clothes": TransactionCategory.SHOPPING,
    "education": TransactionCategory.EDUCATION,
    "tuition": TransactionCategory.EDUCATION,
    "course": TransactionCategory.EDUCATION,
    "debt": TransactionCategory.DEBT_PAYMENT,
    "loan": TransactionCategory.DEBT_PAYMENT,
    "investment": TransactionCategory.INVESTMENT,
    "savings": TransactionCategory.SAVINGS,
    "salary": TransactionCategory.INCOME_SALARY,
    "income": TransactionCategory.INCOME_SALARY,
    "freelance": TransactionCategory.INCOME_FREELANCE,
}


def parse_user_intent(query: str) -> ParsedIntent:
    """
    Parse a natural-language user query into a structured intent.
    This is a rule-based intent parser — designed to be replaced by a
    fine-tuned classifier or LLM function-calling in a future iteration.
    """
    q = query.lower().strip()
    intent = ParsedIntent(raw_query=query)

    # ── Time range & Date detection ──────────────────────────────────
    today = date.today()
    if re.search(r"\byesterday\b", q):
        intent.time_range = "specific_date"
        intent.specific_date = today - timedelta(days=1)
    elif re.search(r"\btoday\b", q):
        intent.time_range = "specific_date"
        intent.specific_date = today
    else:
        # Check for specific dates like "1st july", "july 1", "july 1st", "1 july"
        months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        month_pattern = "|".join(months)
        # matches: 1st july, 2nd august, 3 september, july 1, aug 2nd
        date_match = re.search(fr"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({month_pattern})\b|\b({month_pattern})\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", q)
        if date_match:
            day_str = date_match.group(1) or date_match.group(4)
            month_str = (date_match.group(2) or date_match.group(3)).lower()
            try:
                day = int(day_str)
                # find month index
                month_idx = 1
                for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]):
                    if month_str.startswith(m):
                        month_idx = i + 1
                        break
                intent.time_range = "specific_date"
                intent.specific_date = today.replace(month=month_idx, day=day)
            except ValueError:
                pass
            
    if intent.time_range != "specific_date":
        if re.search(r"last\s*month|previous\s*month", q):
            intent.time_range = "last_month"
        elif re.search(r"this\s*year|year\s*to\s*date|ytd", q):
            intent.time_range = "this_year"
        elif re.search(r"last\s*(7|seven)\s*days|past\s*week|this\s*week", q):
            intent.time_range = "last_7_days"
        elif re.search(r"last\s*(30|thirty)\s*days", q):
            intent.time_range = "last_30_days"
        elif re.search(r"all\s*time|ever|total|overall", q):
            intent.time_range = "all"
        else:
            intent.time_range = "this_month"

    # ── Category detection ───────────────────────────────────────────
    for keyword, category in _CATEGORY_KEYWORDS.items():
        if keyword in q:
            intent.category = category.value
            break

    # ── Intent classification ────────────────────────────────────────
    if re.search(r"budget|limit|over\s*budget|under\s*budget|budget\s*status", q):
        intent.intent = "budget_status"
    elif re.search(r"saving|goal|target|progress", q):
        intent.intent = "savings_goals"
    elif re.search(r"balance|account|bank|net\s*worth", q):
        intent.intent = "account_balance"
    elif re.search(r"top|highest|most|biggest|largest", q):
        intent.intent = "top_spending"
    elif re.search(r"recur|subscription|monthly\s*charge", q):
        intent.intent = "recurring_transactions"
    elif re.search(r"income|earn|salary|revenue", q):
        intent.intent = "income_summary"
    elif re.search(r"cash\s*flow|cashflow", q):
        if intent.time_range == "specific_date":
            intent.intent = "daily_cashflow"
        else:
            intent.intent = "income_summary"
    elif re.search(r"compar|versus|vs|trend|change", q):
        intent.intent = "spending_comparison"
    elif re.search(r"categor|breakdown|split|distribut", q):
        intent.intent = "spending_by_category"
    elif re.search(r"how\s*much|spend|spent|expense|cost", q):
        if intent.category:
            intent.intent = "spending_by_category"
        else:
            intent.intent = "total_spending"
    elif re.search(r"recent|latest|last\s*\d+\s*transaction|history", q):
        intent.intent = "recent_transactions"
    elif re.search(r"help|what\s*can|feature|capability", q):
        intent.intent = "help"
    else:
        intent.intent = "general"

    return intent


# ═══════════════════════════════════════════════════════════════════════════
#  Time Range Resolver
# ═══════════════════════════════════════════════════════════════════════════
def _resolve_date_range(time_range: str) -> tuple[date | None, date | None]:
    """Convert a time_range label into (start_date, end_date)."""
    today = date.today()

    if time_range == "this_month":
        return today.replace(day=1), today
    elif time_range == "last_month":
        first_of_current = today.replace(day=1)
        last_month_end = first_of_current - timedelta(days=1)
        last_month_start = last_month_end.replace(day=1)
        return last_month_start, last_month_end
    elif time_range == "this_year":
        return today.replace(month=1, day=1), today
    elif time_range == "last_7_days":
        return today - timedelta(days=7), today
    elif time_range == "last_30_days":
        return today - timedelta(days=30), today
    elif time_range == "all":
        return None, None
    elif time_range == "specific_date":
        return None, None  # Specific dates are handled explicitly in the queries
    else:
        return today.replace(day=1), today


def _time_label(time_range: str) -> str:
    """Human-friendly label for the time range."""
    labels = {
        "this_month": "this month",
        "last_month": "last month",
        "this_year": "this year",
        "last_7_days": "the last 7 days",
        "last_30_days": "the last 30 days",
        "all": "all time",
        "specific_date": "that specific date",
    }
    return labels.get(time_range, "this month")


def _fmt(val: float | Decimal) -> str:
    """Format a number as INR currency string."""
    return f"₹{float(val):,.2f}"


# ═══════════════════════════════════════════════════════════════════════════
#  Data Retrieval Functions (all user-scoped)
# ═══════════════════════════════════════════════════════════════════════════
async def retrieve_total_spending(
    db: AsyncSession,
    user_id: uuid.UUID,
    time_range: str,
    category: str | None = None,
) -> dict:
    """Total spending for the user, optionally filtered by category."""
    start, end = _resolve_date_range(time_range)

    query = (
        select(
            func.coalesce(func.sum(Transaction.amount), 0).label("total"),
            func.count(Transaction.id).label("count"),
        )
        .where(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.EXPENSE,
        )
    )
    if start and time_range != "specific_date":
        query = query.where(Transaction.transaction_date >= start)
    if end and time_range != "specific_date":
        query = query.where(Transaction.transaction_date <= end)
        
    if category:
        try:
            cat_enum = TransactionCategory(category)
            query = query.where(Transaction.category == cat_enum)
        except ValueError:
            pass

    result = await db.execute(query)
    row = result.one()

    return {
        "total_spent": float(row.total),
        "transaction_count": row.count,
        "category": category,
        "time_range": _time_label(time_range),
    }


async def retrieve_spending_by_category(
    db: AsyncSession,
    user_id: uuid.UUID,
    time_range: str,
) -> dict:
    """Spending breakdown grouped by category."""
    start, end = _resolve_date_range(time_range)

    query = (
        select(
            Transaction.category,
            func.sum(Transaction.amount).label("total"),
            func.count(Transaction.id).label("count"),
        )
        .where(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.EXPENSE,
        )
        .group_by(Transaction.category)
        .order_by(func.sum(Transaction.amount).desc())
    )
    if start:
        query = query.where(Transaction.transaction_date >= start)
    if end:
        query = query.where(Transaction.transaction_date <= end)

    result = await db.execute(query)
    rows = result.all()

    categories = []
    grand_total = 0.0
    for row in rows:
        cat_name = row.category.value if hasattr(row.category, "value") else str(row.category)
        amount = float(row.total)
        grand_total += amount
        categories.append({
            "category": cat_name,
            "total": amount,
            "count": row.count,
        })

    # Calculate percentages
    for cat in categories:
        cat["percentage"] = round((cat["total"] / grand_total * 100) if grand_total > 0 else 0, 1)

    return {
        "categories": categories,
        "grand_total": grand_total,
        "time_range": _time_label(time_range),
    }


async def retrieve_top_spending(
    db: AsyncSession,
    user_id: uuid.UUID,
    time_range: str,
    limit: int = 5,
) -> dict:
    """Top N individual transactions by amount."""
    start, end = _resolve_date_range(time_range)

    query = (
        select(Transaction)
        .where(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.EXPENSE,
        )
        .order_by(Transaction.amount.desc())
        .limit(limit)
    )
    if start:
        query = query.where(Transaction.transaction_date >= start)
    if end:
        query = query.where(Transaction.transaction_date <= end)

    result = await db.execute(query)
    txns = result.scalars().all()

    return {
        "transactions": [
            {
                "description": t.description or t.merchant_name or "Unknown",
                "amount": float(t.amount),
                "category": t.category.value if hasattr(t.category, "value") else str(t.category),
                "date": t.transaction_date.isoformat(),
            }
            for t in txns
        ],
        "time_range": _time_label(time_range),
    }


async def retrieve_recent_transactions(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 10,
) -> dict:
    """Most recent N transactions."""
    result = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .order_by(Transaction.transaction_date.desc())
        .limit(limit)
    )
    txns = result.scalars().all()

    return {
        "transactions": [
            {
                "description": t.description or t.merchant_name or "Unknown",
                "amount": float(t.amount),
                "type": t.transaction_type.value,
                "category": t.category.value if hasattr(t.category, "value") else str(t.category),
                "date": t.transaction_date.isoformat(),
            }
            for t in txns
        ],
    }


async def retrieve_income_summary(
    db: AsyncSession,
    user_id: uuid.UUID,
    time_range: str,
) -> dict:
    """Total income broken down by source category."""
    start, end = _resolve_date_range(time_range)

    query = (
        select(
            Transaction.category,
            func.sum(Transaction.amount).label("total"),
            func.count(Transaction.id).label("count"),
        )
        .where(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.INCOME,
        )
        .group_by(Transaction.category)
    )
    if start:
        query = query.where(Transaction.transaction_date >= start)
    if end:
        query = query.where(Transaction.transaction_date <= end)

    result = await db.execute(query)
    rows = result.all()

    return {
        "sources": [
            {
                "category": row.category.value if hasattr(row.category, "value") else str(row.category),
                "total": float(row.total),
                "count": row.count,
            }
            for row in rows
        ],
        "grand_total": sum(float(r.total) for r in rows),
        "time_range": _time_label(time_range),
    }


async def retrieve_budget_status(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict:
    """Current month budget status for all categories."""
    today = date.today()

    budgets_result = await db.execute(
        select(Budget).where(
            Budget.user_id == user_id,
            Budget.start_date <= today,
            Budget.end_date >= today,
        )
    )
    budgets = list(budgets_result.scalars().all())

    # Spending per category this month
    spending_result = await db.execute(
        select(
            Transaction.category,
            func.coalesce(func.sum(Transaction.amount), 0).label("total"),
        )
        .where(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.EXPENSE,
            Transaction.transaction_date >= today.replace(day=1),
            Transaction.transaction_date <= today,
        )
        .group_by(Transaction.category)
    )
    spending_map = {
        (row.category.value if hasattr(row.category, "value") else str(row.category)): float(row.total)
        for row in spending_result.all()
    }

    budget_items = []
    for b in budgets:
        cat = b.category.value if hasattr(b.category, "value") else str(b.category)
        limit_val = float(b.budget_limit)
        spent = spending_map.get(cat, 0.0)
        pct = (spent / limit_val * 100) if limit_val > 0 else 0
        budget_items.append({
            "category": cat,
            "limit": limit_val,
            "spent": spent,
            "remaining": max(limit_val - spent, 0),
            "percentage": round(pct, 1),
            "status": "exceeded" if pct >= 100 else ("warning" if pct >= 80 else "on_track"),
        })

    return {"budgets": budget_items}


async def retrieve_savings_goals(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict:
    """Active savings goals and progress."""
    result = await db.execute(
        select(SavingsGoal).where(
            SavingsGoal.user_id == user_id,
            SavingsGoal.status == "active",
        )
    )
    goals = result.scalars().all()

    return {
        "goals": [
            {
                "name": g.goal_name,
                "target": float(g.target_amount),
                "current": float(g.current_amount),
                "remaining": float(g.target_amount) - float(g.current_amount),
                "percentage": round(
                    float(g.current_amount) / float(g.target_amount) * 100, 1
                ) if float(g.target_amount) > 0 else 0,
                "target_date": g.target_date.isoformat() if g.target_date else None,
            }
            for g in goals
        ],
    }


async def retrieve_account_balances(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict:
    """Bank account balances."""
    result = await db.execute(
        select(BankAccount).where(
            BankAccount.user_id == user_id,
            BankAccount.is_active == True,
        )
    )
    accounts = result.scalars().all()

    total = sum(float(a.balance) for a in accounts)

    return {
        "accounts": [
            {
                "name": a.account_name,
                "type": a.account_type.value if hasattr(a.account_type, "value") else str(a.account_type),
                "balance": float(a.balance),
                "currency": a.currency,
            }
            for a in accounts
        ],
        "total_balance": total,
    }


async def retrieve_recurring_transactions(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> dict:
    """Recurring / subscription transactions."""
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.user_id == user_id,
            Transaction.is_recurring == True,
        )
        .order_by(Transaction.amount.desc())
    )
    txns = result.scalars().all()

    return {
        "recurring": [
            {
                "description": t.description or t.merchant_name or "Unknown",
                "amount": float(t.amount),
                "category": t.category.value if hasattr(t.category, "value") else str(t.category),
            }
            for t in txns
        ],
        "total_monthly": sum(float(t.amount) for t in txns),
    }


# ═══════════════════════════════════════════════════════════════════════════
#  Master Retrieval Router
# ═══════════════════════════════════════════════════════════════════════════
async def retrieve_context_for_intent(
    db: AsyncSession,
    user_id: uuid.UUID,
    intent: ParsedIntent,
) -> dict:
    """
    Route a parsed intent to the appropriate retrieval function(s)
    and return a unified context dict for the LLM prompt.
    """
    context: dict = {
        "intent": intent.intent,
        "time_range": intent.time_range,
        "query": intent.raw_query,
    }

    if intent.intent == "daily_cashflow" and intent.specific_date:
        data = await retrieve_daily_cashflow(db, user_id, intent.specific_date)
        context["data"] = data
        
    elif intent.intent == "total_spending":
        if intent.specific_date:
            # Overwrite for specific date queries
            data = await retrieve_daily_cashflow(db, user_id, intent.specific_date)
        else:
            data = await retrieve_total_spending(db, user_id, intent.time_range, intent.category)
        context["data"] = data

    elif intent.intent == "spending_by_category":
        if intent.category:
            data = await retrieve_total_spending(db, user_id, intent.time_range, intent.category)
        else:
            data = await retrieve_spending_by_category(db, user_id, intent.time_range)
        context["data"] = data

    elif intent.intent == "top_spending":
        data = await retrieve_top_spending(db, user_id, intent.time_range)
        context["data"] = data

    elif intent.intent == "recent_transactions":
        data = await retrieve_recent_transactions(db, user_id)
        context["data"] = data

    elif intent.intent == "income_summary":
        data = await retrieve_income_summary(db, user_id, intent.time_range)
        context["data"] = data

    elif intent.intent == "budget_status":
        data = await retrieve_budget_status(db, user_id)
        context["data"] = data

    elif intent.intent == "savings_goals":
        data = await retrieve_savings_goals(db, user_id)
        context["data"] = data

    elif intent.intent == "account_balance":
        data = await retrieve_account_balances(db, user_id)
        context["data"] = data

    elif intent.intent == "recurring_transactions":
        data = await retrieve_recurring_transactions(db, user_id)
        context["data"] = data

    elif intent.intent == "spending_comparison":
        # Retrieve both current and previous month for comparison
        current = await retrieve_spending_by_category(db, user_id, "this_month")
        previous = await retrieve_spending_by_category(db, user_id, "last_month")
        context["data"] = {"current_month": current, "last_month": previous}

    elif intent.intent == "help":
        context["data"] = {"type": "help"}

    else:
        # General — provide a snapshot of key data including savings
        spending = await retrieve_total_spending(db, user_id, "this_month")
        categories = await retrieve_spending_by_category(db, user_id, "this_month")
        savings = await retrieve_savings_goals(db, user_id)
        context["data"] = {
            "spending": spending,
            "categories": categories,
            "savings_goals": savings,
        }

    return context


async def retrieve_daily_cashflow(
    db: AsyncSession,
    user_id: uuid.UUID,
    target_date: date,
) -> dict:
    """Retrieve all transactions (income and expense) for a specific date."""
    result = await db.execute(
        select(Transaction)
        .where(
            Transaction.user_id == user_id,
            Transaction.transaction_date == target_date
        )
        .order_by(Transaction.amount.desc())
    )
    txns = result.scalars().all()
    
    total_income = sum(float(t.amount) for t in txns if t.transaction_type == TransactionType.INCOME)
    total_expense = sum(float(t.amount) for t in txns if t.transaction_type == TransactionType.EXPENSE)
    
    return {
        "date": target_date.isoformat(),
        "total_income": total_income,
        "total_expense": total_expense,
        "net_cashflow": total_income - total_expense,
        "transactions": [
            {
                "description": t.description or t.merchant_name or "Unknown",
                "amount": float(t.amount),
                "type": t.transaction_type.value,
                "category": t.category.value if hasattr(t.category, "value") else str(t.category),
            }
            for t in txns
        ],
    }
