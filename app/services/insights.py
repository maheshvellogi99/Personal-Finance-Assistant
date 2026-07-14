"""
ML Insights service — Subscription Tracking & Spending Anomaly Detection.

Architecture
────────────
This module implements two statistical analysis engines that operate on the
user-scoped ``transactions`` table:

1. **Subscription Tracker** — Groups transactions by (merchant, amount)
   and detects recurring monthly patterns using interval analysis with a
   ±3-day tolerance over 30-day cycles.

2. **Anomaly Detector** — Computes per-category rolling baselines (mean + σ)
   from the last 90 days and flags any transaction whose amount exceeds
   μ + 2σ.

Security
────────
Every query is parameterised by ``user_id`` — there is no possibility of
cross-user data leakage.  All functions accept a DB session and UUID,
never raw SQL from user input.
"""

from __future__ import annotations

import logging
import math
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Transaction, TransactionCategory, TransactionType

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
#  Data classes for internal results
# ═══════════════════════════════════════════════════════════════════════════
@dataclass
class DetectedSubscription:
    """A detected recurring payment pattern."""

    merchant_name: str
    amount: float
    currency: str
    category: str
    occurrence_count: int
    avg_interval_days: float
    confidence: float  # 0.0–1.0
    first_seen: date
    last_seen: date
    next_expected_date: date
    is_active: bool  # True if last occurrence within 45 days


@dataclass
class DetectedAnomaly:
    """A transaction flagged as anomalous relative to historical baseline."""

    transaction_id: uuid.UUID
    transaction_date: date
    description: str | None
    merchant_name: str | None
    category: str
    amount: float
    currency: str
    baseline_mean: float
    baseline_std: float
    z_score: float  # How many σ above the mean
    severity: str  # "warning" (2–3σ) | "critical" (>3σ)


# ═══════════════════════════════════════════════════════════════════════════
#  1. Subscription Detection Engine
# ═══════════════════════════════════════════════════════════════════════════
# Configuration
_SUBSCRIPTION_INTERVAL_TARGET = 30  # Expected cycle in days
_SUBSCRIPTION_TOLERANCE_DAYS = 3  # ±3 days tolerance
_MIN_OCCURRENCES = 2  # Need at least 2 transactions to detect a pattern
_ACTIVE_WINDOW_DAYS = 45  # Still "active" if last seen within 45 days


async def detect_subscriptions(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[DetectedSubscription]:
    """
    Analyse historical transactions to detect recurring subscription patterns.

    Algorithm
    ---------
    1. Pull all expense transactions for the user from the last 12 months.
    2. Group by (merchant_name, amount) — normalised to 2 decimal places.
    3. For each group with ≥ 2 occurrences:
       a. Sort by transaction_date and compute day-intervals between consecutive txns.
       b. Filter intervals to those within the 30 ±3 day window.
       c. If ≥50% of intervals match, classify as subscription.
    4. Compute confidence score, next expected date, and active status.

    Returns
    -------
    list[DetectedSubscription]
        Sorted by confidence (descending), then by next expected date.
    """
    # ── Pull 12 months of expense data ───────────────────────────────
    cutoff = date.today() - timedelta(days=365)

    query = (
        select(Transaction)
        .where(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.EXPENSE,
            Transaction.transaction_date >= cutoff,
        )
        .order_by(Transaction.transaction_date.asc())
    )

    result = await db.execute(query)
    transactions = list(result.scalars().all())

    if not transactions:
        return []

    # ── Group by (merchant_name, amount) ─────────────────────────────
    # Key: (normalised_merchant, rounded_amount) → list of txn dates
    groups: dict[tuple[str, float], list[tuple[date, str, str]]] = defaultdict(list)

    for txn in transactions:
        merchant = (txn.merchant_name or txn.description or "unknown").strip().lower()
        rounded_amt = round(float(txn.amount), 2)
        groups[(merchant, rounded_amt)].append(
            (txn.transaction_date, txn.category.value, txn.currency)
        )

    # ── Analyse each group for recurrence ────────────────────────────
    subscriptions: list[DetectedSubscription] = []
    today = date.today()

    for (merchant, amount), occurrences in groups.items():
        if len(occurrences) < _MIN_OCCURRENCES:
            continue

        dates = sorted([o[0] for o in occurrences])
        category = occurrences[0][1]
        currency = occurrences[0][2]

        # Compute inter-transaction intervals
        intervals = [
            (dates[i + 1] - dates[i]).days
            for i in range(len(dates) - 1)
        ]

        if not intervals:
            continue

        # Count how many intervals fall within 30 ± 3 days
        matching = sum(
            1
            for iv in intervals
            if abs(iv - _SUBSCRIPTION_INTERVAL_TARGET) <= _SUBSCRIPTION_TOLERANCE_DAYS
        )

        match_ratio = matching / len(intervals)

        # Require at least 50% of intervals to match
        if match_ratio < 0.5:
            continue

        # ── Compute metrics ──────────────────────────────────────
        avg_interval = sum(intervals) / len(intervals) if intervals else 30.0

        # Confidence: weighted by match ratio and occurrence count
        count_factor = min(len(occurrences) / 6, 1.0)  # Caps at 6 months
        confidence = round(0.5 * match_ratio + 0.5 * count_factor, 3)

        first_seen = dates[0]
        last_seen = dates[-1]
        next_expected = last_seen + timedelta(days=round(avg_interval))

        is_active = (today - last_seen).days <= _ACTIVE_WINDOW_DAYS

        subscriptions.append(
            DetectedSubscription(
                merchant_name=merchant.title(),
                amount=amount,
                currency=currency,
                category=category,
                occurrence_count=len(occurrences),
                avg_interval_days=round(avg_interval, 1),
                confidence=confidence,
                first_seen=first_seen,
                last_seen=last_seen,
                next_expected_date=next_expected,
                is_active=is_active,
            )
        )

    # Sort: active first, then by confidence desc, then next date asc
    subscriptions.sort(
        key=lambda s: (not s.is_active, -s.confidence, s.next_expected_date)
    )

    logger.info(
        f"Detected {len(subscriptions)} subscription(s) for user {user_id}"
    )
    return subscriptions


# ═══════════════════════════════════════════════════════════════════════════
#  2. Spending Anomaly Detector
# ═══════════════════════════════════════════════════════════════════════════
_ANOMALY_LOOKBACK_DAYS = 90  # 3-month rolling window
_ANOMALY_ZSCORE_THRESHOLD = 2.0  # Flag at > 2σ
_ANOMALY_MIN_SAMPLES = 3  # Need at least 3 historical txns for a baseline


async def detect_anomaly(
    db: AsyncSession,
    user_id: uuid.UUID,
    new_transaction_amount: float,
    category: str,
) -> DetectedAnomaly | None:
    """
    Evaluate whether a single transaction amount is anomalous relative to
    the user's historical baseline for the given category.

    Algorithm
    ---------
    1. Pull all transactions for this user + category from the last 90 days.
    2. Compute μ (mean) and σ (standard deviation).
    3. Calculate z-score = (amount − μ) / σ.
    4. If z > 2.0, flag as anomaly.

    Returns
    -------
    DetectedAnomaly | None
        The anomaly record if flagged, else None.
    """
    try:
        cat_enum = TransactionCategory(category.lower())
    except ValueError:
        return None

    cutoff = date.today() - timedelta(days=_ANOMALY_LOOKBACK_DAYS)

    # ── Compute aggregate statistics ─────────────────────────────────
    stats_query = (
        select(
            func.avg(Transaction.amount).label("mean"),
            func.stddev_pop(Transaction.amount).label("std"),
            func.count(Transaction.id).label("count"),
        )
        .where(
            Transaction.user_id == user_id,
            Transaction.category == cat_enum,
            Transaction.transaction_type == TransactionType.EXPENSE,
            Transaction.transaction_date >= cutoff,
        )
    )

    result = await db.execute(stats_query)
    row = result.one()

    sample_count = row.count or 0
    baseline_mean = float(row.mean) if row.mean else 0.0
    baseline_std = float(row.std) if row.std else 0.0

    # Not enough historical data for a meaningful baseline
    if sample_count < _ANOMALY_MIN_SAMPLES:
        return None

    # Avoid division by zero (all identical amounts)
    if baseline_std == 0:
        return None

    z_score = (new_transaction_amount - baseline_mean) / baseline_std

    if z_score <= _ANOMALY_ZSCORE_THRESHOLD:
        return None

    severity = "critical" if z_score > 3.0 else "warning"

    logger.info(
        f"Anomaly detected for user {user_id}: "
        f"category={category}, amount={new_transaction_amount}, "
        f"z={z_score:.2f}, severity={severity}"
    )

    return DetectedAnomaly(
        transaction_id=uuid.uuid4(),  # Placeholder — caller can override
        transaction_date=date.today(),
        description=None,
        merchant_name=None,
        category=category,
        amount=new_transaction_amount,
        currency="USD",
        baseline_mean=round(baseline_mean, 2),
        baseline_std=round(baseline_std, 2),
        z_score=round(z_score, 2),
        severity=severity,
    )


async def scan_recent_anomalies(
    db: AsyncSession,
    user_id: uuid.UUID,
    lookback_days: int = 30,
) -> list[DetectedAnomaly]:
    """
    Scan all transactions from the last ``lookback_days`` and retroactively
    flag any that are anomalous relative to the user's per-category baseline.

    This powers the ``GET /insights/anomalies`` dashboard endpoint.

    Algorithm
    ---------
    For each category the user has spent in:
    1. Compute the 90-day rolling baseline (μ, σ).
    2. Pull recent transactions in that category.
    3. Flag any where amount > μ + 2σ.
    """
    cutoff_recent = date.today() - timedelta(days=lookback_days)
    cutoff_baseline = date.today() - timedelta(days=_ANOMALY_LOOKBACK_DAYS)

    # ── Step 1: Get per-category baselines ───────────────────────────
    baseline_query = (
        select(
            Transaction.category,
            func.avg(Transaction.amount).label("mean"),
            func.stddev_pop(Transaction.amount).label("std"),
            func.count(Transaction.id).label("count"),
        )
        .where(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.EXPENSE,
            Transaction.transaction_date >= cutoff_baseline,
        )
        .group_by(Transaction.category)
    )

    baseline_result = await db.execute(baseline_query)
    baselines: dict[str, tuple[float, float, int]] = {}

    for row in baseline_result.all():
        cat_val = row.category.value if hasattr(row.category, "value") else str(row.category)
        mean = float(row.mean) if row.mean else 0.0
        std = float(row.std) if row.std else 0.0
        count = row.count or 0
        if count >= _ANOMALY_MIN_SAMPLES and std > 0:
            baselines[cat_val] = (mean, std, count)

    if not baselines:
        return []

    # ── Step 2: Pull recent transactions ─────────────────────────────
    recent_query = (
        select(Transaction)
        .where(
            Transaction.user_id == user_id,
            Transaction.transaction_type == TransactionType.EXPENSE,
            Transaction.transaction_date >= cutoff_recent,
        )
        .order_by(Transaction.transaction_date.desc())
    )

    recent_result = await db.execute(recent_query)
    recent_txns = list(recent_result.scalars().all())

    # ── Step 3: Flag anomalies ───────────────────────────────────────
    anomalies: list[DetectedAnomaly] = []

    for txn in recent_txns:
        cat_val = txn.category.value if hasattr(txn.category, "value") else str(txn.category)

        if cat_val not in baselines:
            continue

        mean, std, _ = baselines[cat_val]
        amount = float(txn.amount)
        z_score = (amount - mean) / std

        if z_score > _ANOMALY_ZSCORE_THRESHOLD:
            severity = "critical" if z_score > 3.0 else "warning"
            anomalies.append(
                DetectedAnomaly(
                    transaction_id=txn.id,
                    transaction_date=txn.transaction_date,
                    description=txn.description,
                    merchant_name=txn.merchant_name,
                    category=cat_val,
                    amount=amount,
                    currency=txn.currency,
                    baseline_mean=round(mean, 2),
                    baseline_std=round(std, 2),
                    z_score=round(z_score, 2),
                    severity=severity,
                )
            )

    # Sort by severity (critical first), then z-score desc
    anomalies.sort(key=lambda a: (a.severity != "critical", -a.z_score))

    logger.info(
        f"Found {len(anomalies)} anomaly/ies for user {user_id} "
        f"(last {lookback_days} days)"
    )
    return anomalies
