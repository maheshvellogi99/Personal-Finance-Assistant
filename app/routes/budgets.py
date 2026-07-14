"""
Budget management routes.

Endpoints
─────────
POST   /budgets/              Create a new budget
GET    /budgets/              List all budgets for the current user
GET    /budgets/status        Compare current month spending vs budget limits
POST   /budgets/auto-generate Analyze history and recommend smart budgets
GET    /budgets/{id}          Get a single budget
PATCH  /budgets/{id}          Update a budget
DELETE /budgets/{id}          Delete a budget
"""

from __future__ import annotations

import math
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import (
    Budget,
    BudgetPeriod,
    Transaction,
    TransactionCategory,
    TransactionType,
    User,
)
from app.routes.auth import get_current_user
from app.schemas.schemas import (
    BudgetAutoGenerateResponse,
    BudgetCreate,
    BudgetRecommendation,
    BudgetResponse,
    BudgetStatusItem,
    BudgetStatusResponse,
    BudgetUpdate,
)

router = APIRouter(prefix="/budgets", tags=["Budgets"])


# ── CRUD Endpoints ───────────────────────────────────────────────────────
@router.post(
    "/",
    response_model=BudgetResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create or update a budget (UPSERT)",
)
async def create_budget(
    body: BudgetCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new budget **or** update an existing one (UPSERT).

    If an active budget already exists for the same ``user_id + category``,
    the existing row's ``budget_limit``, ``start_date``, ``end_date``, and
    ``alert_threshold_pct`` are updated in-place — no duplicate is created.

    Returns **200** for updates and **201** for new inserts.
    """
    # Validate enums
    try:
        category = TransactionCategory(body.category)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid category. Must be one of: {[e.value for e in TransactionCategory]}",
        )
    try:
        period = BudgetPeriod(body.period)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid period. Must be one of: {[e.value for e in BudgetPeriod]}",
        )

    if body.end_date <= body.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_date must be after start_date.",
        )

    # ── UPSERT: check for existing budget (same user + category) ─────
    existing_result = await db.execute(
        select(Budget).where(
            Budget.user_id == current_user.id,
            Budget.category == category,
        ).order_by(Budget.created_at.desc())  # Pick most recent if duplicates exist
    )
    existing_budget = existing_result.scalars().first()

    if existing_budget is not None:
        # UPDATE the existing budget — no duplicate
        existing_budget.budget_limit = body.budget_limit
        existing_budget.period = period
        existing_budget.start_date = body.start_date
        existing_budget.end_date = body.end_date
        existing_budget.alert_threshold_pct = body.alert_threshold_pct
        existing_budget.updated_at = datetime.now(timezone.utc)

        # ── Clean up any pre-existing duplicates for this user+category ──
        dup_result = await db.execute(
            select(Budget).where(
                Budget.user_id == current_user.id,
                Budget.category == category,
                Budget.id != existing_budget.id,
            )
        )
        for dup in dup_result.scalars().all():
            await db.delete(dup)

        await db.flush()
        await db.refresh(existing_budget)
        # Return with 200 OK (not 201) to signal an update
        return existing_budget

    # ── INSERT new budget ─────────────────────────────────────────────
    budget = Budget(
        user_id=current_user.id,
        category=category,
        budget_limit=body.budget_limit,
        period=period,
        start_date=body.start_date,
        end_date=body.end_date,
        alert_threshold_pct=body.alert_threshold_pct,
    )
    db.add(budget)
    await db.flush()
    await db.refresh(budget)
    return budget


@router.get(
    "/",
    response_model=list[BudgetResponse],
    summary="List all budgets for the current user",
)
async def list_budgets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Budget)
        .where(Budget.user_id == current_user.id)
        .order_by(Budget.start_date.desc())
    )
    return list(result.scalars().all())


# ── Budget Status Endpoint (Module 3 Core) ───────────────────────────────
@router.get(
    "/status",
    response_model=BudgetStatusResponse,
    summary="Compare current month's categorized spending against budget limits",
)
async def budget_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    For every active budget belonging to the current user whose date range
    covers the current month, query the actual expense transactions in that
    category and compute:

    • spent_amount  — SUM of expenses in that category within the period
    • remaining     — budget_limit − spent_amount
    • percentage    — (spent / limit) × 100
    • status        — 'exceeded' | 'warning' | 'on_track'
    • alerts        — human-readable alert strings
    """
    today = date.today()
    current_month_str = today.strftime("%Y-%m")

    # Fetch all budgets whose date range overlaps the current month
    budgets_result = await db.execute(
        select(Budget).where(
            Budget.user_id == current_user.id,
            Budget.start_date <= today,
            Budget.end_date >= today,
        )
    )
    budgets = list(budgets_result.scalars().all())

    # Pre-compute spending per category for the current period
    # (single query, much better than N+1)
    spending_query = (
        select(
            Transaction.category,
            func.coalesce(func.sum(Transaction.amount), 0).label("total_spent"),
        )
        .where(
            Transaction.user_id == current_user.id,
            Transaction.transaction_type == TransactionType.EXPENSE,
            Transaction.transaction_date >= today.replace(day=1),
            Transaction.transaction_date <= today,
        )
        .group_by(Transaction.category)
    )
    spending_result = await db.execute(spending_query)
    spending_map: dict[str, float] = {
        row.category.value if hasattr(row.category, "value") else str(row.category): float(row.total_spent)
        for row in spending_result.all()
    }

    # Build per-budget status items
    status_items: list[BudgetStatusItem] = []
    alerts: list[str] = []
    total_budget = 0.0
    total_spent = 0.0

    for budget in budgets:
        cat_key = (
            budget.category.value
            if hasattr(budget.category, "value")
            else str(budget.category)
        )
        spent = spending_map.get(cat_key, 0.0)
        limit = float(budget.budget_limit)
        remaining = max(limit - spent, 0.0)
        pct = (spent / limit * 100) if limit > 0 else 0.0
        threshold = float(budget.alert_threshold_pct)

        # Determine status
        if pct >= 100:
            item_status = "exceeded"
            alerts.append(
                f"🚨 {cat_key.replace('_', ' ').title()} budget EXCEEDED — "
                f"${spent:,.2f} spent of ${limit:,.2f} limit ({pct:.1f}%)."
            )
        elif pct >= threshold:
            item_status = "warning"
            alerts.append(
                f"⚠️ {cat_key.replace('_', ' ').title()} is at {pct:.1f}% of budget — "
                f"${remaining:,.2f} remaining."
            )
        else:
            item_status = "on_track"

        status_items.append(
            BudgetStatusItem(
                budget_id=budget.id,
                category=cat_key,
                budget_limit=limit,
                spent_amount=spent,
                remaining=remaining,
                percentage_used=round(pct, 2),
                period=budget.period.value if hasattr(budget.period, "value") else str(budget.period),
                start_date=budget.start_date,
                end_date=budget.end_date,
                alert_threshold_pct=threshold,
                status=item_status,
            )
        )

        total_budget += limit
        total_spent += spent

    total_remaining = max(total_budget - total_spent, 0.0)
    overall_pct = (total_spent / total_budget * 100) if total_budget > 0 else 0.0

    return BudgetStatusResponse(
        month=current_month_str,
        total_budget=round(total_budget, 2),
        total_spent=round(total_spent, 2),
        total_remaining=round(total_remaining, 2),
        overall_percentage=round(overall_pct, 2),
        budgets=status_items,
        alerts=alerts,
    )


# ═══════════════════════════════════════════════════════════════════════════
#  Automated Budget Recommendation Engine (Module 12.1)
# ═══════════════════════════════════════════════════════════════════════════

def _round_up_to_nearest(value: float, increment: float) -> float:
    """Round *value* UP to the nearest *increment*."""
    return math.ceil(value / increment) * increment


@router.post(
    "/auto-generate",
    response_model=BudgetAutoGenerateResponse,
    summary="Analyze 90-day expense history and recommend smart budgets",
)
async def auto_generate_budgets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    **Automated Budget Recommendation Engine**

    Analyzes the authenticated user's expense transactions from the last
    90 days, groups by category, and produces intelligent budget
    recommendations with a 10 % safety buffer.

    **Algorithm:**
    1. Query all ``EXPENSE`` transactions within the last 90 days.
    2. If less than 90 days of history exist, the month factor is
       dynamically computed from the oldest transaction date (min 1 month).
    3. For each category: ``monthly_avg = total_spent / month_factor``.
    4. A **10 % buffer** is applied: ``buffered = monthly_avg × 1.10``.
    5. The result is **rounded up** to the nearest ₹100 (or $100).
    """
    today = date.today()
    window_start = today - timedelta(days=90)

    # ── Query expense transactions in the 90-day window ─────────────
    expense_query = (
        select(
            Transaction.category,
            func.sum(Transaction.amount).label("total_spent"),
            func.min(Transaction.transaction_date).label("oldest_date"),
        )
        .where(
            Transaction.user_id == current_user.id,
            Transaction.transaction_type == TransactionType.EXPENSE,
            Transaction.transaction_date >= window_start,
            Transaction.transaction_date <= today,
        )
        .group_by(Transaction.category)
    )
    result = await db.execute(expense_query)
    rows = result.all()

    if not rows:
        return BudgetAutoGenerateResponse(
            analysis_window_days=0,
            month_factor=1.0,
            recommendations=[],
            message="No expense transactions found in the last 90 days. "
                    "Upload a bank statement first to generate recommendations.",
        )

    # ── Compute the actual analysis window ──────────────────────────
    global_oldest = min(
        r.oldest_date for r in rows if r.oldest_date is not None
    )
    # Handle both date and datetime types from the DB
    if isinstance(global_oldest, datetime):
        global_oldest = global_oldest.date()

    actual_days = (today - global_oldest).days
    # Ensure at least 30 days (1 month) to prevent inflated averages
    month_factor = max(actual_days / 30.0, 1.0)

    # ── Build recommendations per category ──────────────────────────
    recommendations: list[BudgetRecommendation] = []

    for row in rows:
        cat_key = (
            row.category.value
            if hasattr(row.category, "value")
            else str(row.category)
        )
        total = float(row.total_spent)
        monthly_avg = total / month_factor

        # 10% safety buffer
        buffered = monthly_avg * 1.10

        # Round up to nearest 100 (₹100 / $100)
        suggested = _round_up_to_nearest(buffered, 100.0)

        recommendations.append(
            BudgetRecommendation(
                category=cat_key,
                historical_average=round(monthly_avg, 2),
                suggested_limit=suggested,
                total_spent_90_days=round(total, 2),
            )
        )

    # Sort by highest spend first for prioritisation
    recommendations.sort(key=lambda r: r.total_spent_90_days, reverse=True)

    return BudgetAutoGenerateResponse(
        analysis_window_days=actual_days,
        month_factor=round(month_factor, 2),
        recommendations=recommendations,
        message=f"Analyzed {actual_days} days of history across "
                f"{len(recommendations)} spending categories. "
                f"Recommendations include a 10% safety buffer, "
                f"rounded up to the nearest 100.",
    )


# ── Single Budget CRUD ───────────────────────────────────────────────────
@router.get(
    "/{budget_id}",
    response_model=BudgetResponse,
    summary="Get a single budget",
)
async def get_budget(
    budget_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Budget).where(
            Budget.id == budget_id,
            Budget.user_id == current_user.id,
        )
    )
    budget = result.scalar_one_or_none()
    if budget is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found"
        )
    return budget


@router.patch(
    "/{budget_id}",
    response_model=BudgetResponse,
    summary="Update a budget",
)
async def update_budget(
    budget_id: uuid.UUID,
    body: BudgetUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Budget).where(
            Budget.id == budget_id,
            Budget.user_id == current_user.id,
        )
    )
    budget = result.scalar_one_or_none()
    if budget is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found"
        )

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(budget, field, value)

    await db.flush()
    await db.refresh(budget)
    return budget


@router.delete(
    "/{budget_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a budget",
)
async def delete_budget(
    budget_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Budget).where(
            Budget.id == budget_id,
            Budget.user_id == current_user.id,
        )
    )
    budget = result.scalar_one_or_none()
    if budget is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found"
        )
    await db.delete(budget)
