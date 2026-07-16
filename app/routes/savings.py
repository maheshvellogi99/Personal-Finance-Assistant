"""
Savings routes.

Endpoints
─────────
POST   /savings/                  Create a new savings goal.
GET    /savings/                  List all savings goals for the user.
PATCH  /savings/{goal_id}         Update a savings goal.
DELETE /savings/{goal_id}         Delete a savings goal.
POST   /savings/{goal_id}/fund    Fund a savings goal (with ledger sync).
POST   /savings/what-if           Run a "What-If" savings projection.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import (
    SavingsGoal,
    Transaction,
    TransactionCategory,
    TransactionType,
    User,
)
from app.routes.auth import get_current_user
from app.schemas.schemas import (
    GoalFundRequest,
    ProjectionPoint,
    SavingsGoalCreate,
    SavingsGoalResponse,
    SavingsGoalUpdate,
    WhatIfRequest,
    WhatIfResponse,
)

router = APIRouter(prefix="/savings", tags=["Savings"])

# Maximum projection horizon (30 years) to prevent infinite loops
MAX_MONTHS = 360


# ── Helper ───────────────────────────────────────────────────────────────
async def _get_user_goal(
    db: AsyncSession,
    goal_id: uuid.UUID,
    user_id: uuid.UUID,
) -> SavingsGoal:
    """Fetch a savings goal and verify ownership; raise 404 if not found."""
    result = await db.execute(
        select(SavingsGoal).where(
            SavingsGoal.id == goal_id,
            SavingsGoal.user_id == user_id,
        )
    )
    goal = result.scalar_one_or_none()
    if goal is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Savings goal not found.",
        )
    return goal


# ═══════════════════════════════════════════════════════════════════════════
#  POST /savings/ — Create a Savings Goal
# ═══════════════════════════════════════════════════════════════════════════
@router.post(
    "/",
    response_model=SavingsGoalResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new savings goal",
)
async def create_savings_goal(
    body: SavingsGoalCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new savings goal for the authenticated user.

    The goal is initialized with ``current_amount = 0`` and ``status = ACTIVE``.
    If a ``monthly_contribution`` is provided, it is stored as the
    ``ai_monthly_suggestion`` field for the savings projection engine.
    """
    goal = SavingsGoal(
        user_id=current_user.id,
        goal_name=body.goal_name,
        description=body.description,
        target_amount=body.target_amount,
        currency=body.currency,
        target_date=body.target_date,
        ai_monthly_suggestion=body.monthly_contribution,
    )
    db.add(goal)
    await db.commit()
    await db.refresh(goal)
    return goal


# ═══════════════════════════════════════════════════════════════════════════
#  GET /savings/ — List All Savings Goals
# ═══════════════════════════════════════════════════════════════════════════
@router.get(
    "/",
    response_model=list[SavingsGoalResponse],
    summary="List all savings goals for the current user",
)
async def list_savings_goals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all savings goals belonging to the authenticated user, newest first."""
    result = await db.execute(
        select(SavingsGoal)
        .where(SavingsGoal.user_id == current_user.id)
        .order_by(SavingsGoal.created_at.desc())
    )
    return result.scalars().all()


# ═══════════════════════════════════════════════════════════════════════════
#  PATCH /savings/{goal_id} — Update a Savings Goal
# ═══════════════════════════════════════════════════════════════════════════
@router.patch(
    "/{goal_id}",
    response_model=SavingsGoalResponse,
    summary="Update a savings goal",
)
async def update_savings_goal(
    goal_id: uuid.UUID,
    body: SavingsGoalUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Partially update a savings goal owned by the authenticated user.

    Only the fields included in the request body are updated;
    omitted fields remain unchanged.  ``monthly_contribution`` maps
    to the ``ai_monthly_suggestion`` column in the database.
    """
    goal = await _get_user_goal(db, goal_id, current_user.id)

    # Map payload fields → ORM columns
    field_map = {
        "goal_name": "goal_name",
        "description": "description",
        "target_amount": "target_amount",
        "current_amount": "current_amount",
        "target_date": "target_date",
        "status": "status",
        "monthly_contribution": "ai_monthly_suggestion",
    }

    update_data = body.model_dump(exclude_unset=True)
    for field_name, value in update_data.items():
        orm_attr = field_map.get(field_name, field_name)
        setattr(goal, orm_attr, value)

    await db.commit()
    await db.refresh(goal)
    return goal


# ═══════════════════════════════════════════════════════════════════════════
#  DELETE /savings/{goal_id} — Delete a Savings Goal
# ═══════════════════════════════════════════════════════════════════════════
@router.delete(
    "/{goal_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a savings goal",
)
async def delete_savings_goal(
    goal_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a savings goal owned by the authenticated user."""
    goal = await _get_user_goal(db, goal_id, current_user.id)
    await db.delete(goal)
    await db.commit()


# ═══════════════════════════════════════════════════════════════════════════
#  POST /savings/{goal_id}/fund — Fund a Savings Goal
# ═══════════════════════════════════════════════════════════════════════════
@router.post(
    "/{goal_id}/fund",
    response_model=SavingsGoalResponse,
    summary="Fund a savings goal and log ledger transaction",
)
async def fund_savings_goal(
    goal_id: uuid.UUID,
    body: GoalFundRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Inject money into a savings goal.

    This performs a dual-write in a single DB transaction:

    1. **Balance mutation** — Increments the goal's ``current_amount``.
    2. **Ledger synchronisation** — Creates a ``Transaction`` record of type
       ``TRANSFER`` / category ``TRANSFER`` so the funding appears in the
       user's transaction history and budget tracking.
    """
    # Step A: Validate ownership
    goal = await _get_user_goal(db, goal_id, current_user.id)

    # Step B: Increment balance
    goal.current_amount = float(goal.current_amount) + body.amount

    # Step C: Create ledger entry
    txn = Transaction(
        user_id=current_user.id,
        transaction_type=TransactionType.TRANSFER,
        category=TransactionCategory.SAVINGS,
        amount=body.amount,
        currency=goal.currency,
        description=f"Fund Allocation: {goal.goal_name}",
        merchant_name="Internal Savings Transfer",
        transaction_date=datetime.now(timezone.utc).date(),
    )
    db.add(txn)

    # Step D: Commit & return
    await db.commit()
    await db.refresh(goal)
    return goal


#  POST /savings/what-if — Savings "What-If" Projection Engine
# ═══════════════════════════════════════════════════════════════════════════
@router.post(
    "/what-if",
    response_model=WhatIfResponse,
    summary="Run a What-If savings projection",
)
async def what_if_projection(
    body: WhatIfRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Calculate two parallel savings timelines and return time-series data:

    - **Base Timeline:**  Adds ``monthly_contribution`` each month.
    - **What-If Timeline:** Adds ``monthly_contribution + additional_contribution``
      each month (simulating cutting an expense category).

    The projection runs month-by-month until **both** timelines exceed
    ``target_amount``, or a hard cap of 360 months (30 years) is reached.
    If neither timeline reaches the goal, ``is_unreachable`` is set to True.

    Returns the exact month each timeline hits the goal and how many
    months sooner the what-if scenario reaches it.
    """
    # ── Validation ──────────────────────────────────────────────────
    if body.current_amount >= body.target_amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="current_amount must be less than target_amount.",
        )

    base_total = body.monthly_contribution
    what_if_total = body.monthly_contribution + body.additional_contribution

    if base_total <= 0 and what_if_total <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one contribution (base or additional) must be > 0.",
        )

    # ── Run the projection ──────────────────────────────────────────
    current_base = body.current_amount
    current_what_if = body.current_amount

    base_months_to_goal = -1      # -1 = not reached within horizon
    what_if_months_to_goal = -1

    points: list[ProjectionPoint] = []
    start_date = date.today().replace(day=1)

    # Add the starting point (Month 0)
    points.append(
        ProjectionPoint(
            month_label=start_date.strftime("%b %Y"),
            base_balance=round(current_base, 2),
            what_if_balance=round(current_what_if, 2),
        )
    )

    for month_idx in range(1, MAX_MONTHS + 1):
        current_base += base_total
        current_what_if += what_if_total

        month_date = start_date + relativedelta(months=month_idx)
        label = month_date.strftime("%b %Y")

        points.append(
            ProjectionPoint(
                month_label=label,
                base_balance=round(current_base, 2),
                what_if_balance=round(current_what_if, 2),
            )
        )

        # Record the first month each timeline hits the target
        if base_months_to_goal == -1 and current_base >= body.target_amount:
            base_months_to_goal = month_idx

        if what_if_months_to_goal == -1 and current_what_if >= body.target_amount:
            what_if_months_to_goal = month_idx

        # Stop once both have reached the goal (or one is unreachable)
        if base_months_to_goal != -1 and what_if_months_to_goal != -1:
            break

    # ── Detect unreachable goals ─────────────────────────────────────
    is_unreachable = (
        base_months_to_goal == -1 and what_if_months_to_goal == -1
    )

    # ── Calculate months saved ──────────────────────────────────────
    if base_months_to_goal != -1 and what_if_months_to_goal != -1:
        months_saved = base_months_to_goal - what_if_months_to_goal
    elif what_if_months_to_goal != -1 and base_months_to_goal == -1:
        # What-if reaches it but base never does within the horizon
        months_saved = MAX_MONTHS - what_if_months_to_goal
    else:
        months_saved = 0

    return WhatIfResponse(
        points=points,
        base_months_to_goal=base_months_to_goal,
        what_if_months_to_goal=what_if_months_to_goal,
        months_saved=months_saved,
        is_unreachable=is_unreachable,
    )
