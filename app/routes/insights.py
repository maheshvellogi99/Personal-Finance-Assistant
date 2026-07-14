"""
ML Insights routes — Subscription Tracking & Anomaly Detection.

Endpoints
─────────
GET  /insights/subscriptions    Detected recurring subscriptions
GET  /insights/anomalies        Recently flagged spending anomalies

Security
────────
All endpoints require JWT authentication and strictly scope queries
to the authenticated user's data.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user
from app.schemas.schemas import (
    AnomalyItem,
    AnomalyResponse,
    SubscriptionItem,
    SubscriptionResponse,
)
from app.services.insights import detect_subscriptions, scan_recent_anomalies

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/insights", tags=["ML Insights"])


# ═══════════════════════════════════════════════════════════════════════════
#  GET /insights/subscriptions
# ═══════════════════════════════════════════════════════════════════════════
@router.get(
    "/subscriptions",
    response_model=SubscriptionResponse,
    summary="Detect recurring subscription patterns in transaction history",
)
async def get_subscriptions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Analyse the authenticated user's transaction history to identify
    recurring subscription payments.

    **Detection logic:**
    - Groups expenses by (merchant, amount)
    - Checks for consistent monthly intervals (30 ± 3 days)
    - Requires at least 2 occurrences to classify as subscription
    - Computes confidence score, next renewal date, and active status

    Results are sorted by confidence (descending), with active
    subscriptions listed first.
    """
    detected = await detect_subscriptions(db=db, user_id=current_user.id)

    items = [
        SubscriptionItem(
            merchant_name=sub.merchant_name,
            amount=sub.amount,
            currency=sub.currency,
            category=sub.category,
            occurrence_count=sub.occurrence_count,
            avg_interval_days=sub.avg_interval_days,
            confidence=sub.confidence,
            first_seen=sub.first_seen,
            last_seen=sub.last_seen,
            next_expected_date=sub.next_expected_date,
            is_active=sub.is_active,
        )
        for sub in detected
    ]

    active_count = sum(1 for s in items if s.is_active)
    monthly_cost = round(sum(s.amount for s in items if s.is_active), 2)

    return SubscriptionResponse(
        total_detected=len(items),
        active_count=active_count,
        estimated_monthly_cost=monthly_cost,
        subscriptions=items,
    )


# ═══════════════════════════════════════════════════════════════════════════
#  GET /insights/anomalies
# ═══════════════════════════════════════════════════════════════════════════
@router.get(
    "/anomalies",
    response_model=AnomalyResponse,
    summary="Retrieve recently flagged spending anomalies",
)
async def get_anomalies(
    lookback_days: int = Query(
        30,
        ge=7,
        le=180,
        description="How many days back to scan for anomalies (default: 30)",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Scan the authenticated user's recent transactions and flag any that
    are statistically anomalous relative to their per-category spending
    baseline.

    **Detection logic:**
    - Computes 90-day rolling mean (μ) and standard deviation (σ) per category
    - Flags transactions where amount > μ + 2σ
    - Severity: ``"warning"`` (2–3σ) or ``"critical"`` (> 3σ)
    - Requires at least 3 historical transactions per category for a baseline

    **Query parameters:**
    - ``lookback_days``: How far back to scan (7–180 days, default 30)
    """
    detected = await scan_recent_anomalies(
        db=db,
        user_id=current_user.id,
        lookback_days=lookback_days,
    )

    items = [
        AnomalyItem(
            transaction_id=a.transaction_id,
            transaction_date=a.transaction_date,
            description=a.description,
            merchant_name=a.merchant_name,
            category=a.category,
            amount=a.amount,
            currency=a.currency,
            baseline_mean=a.baseline_mean,
            baseline_std=a.baseline_std,
            z_score=a.z_score,
            severity=a.severity,
        )
        for a in detected
    ]

    critical_count = sum(1 for a in items if a.severity == "critical")
    warning_count = sum(1 for a in items if a.severity == "warning")

    return AnomalyResponse(
        total_flagged=len(items),
        critical_count=critical_count,
        warning_count=warning_count,
        lookback_days=lookback_days,
        anomalies=items,
    )
