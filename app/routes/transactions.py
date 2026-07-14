"""
Transaction management routes.

Endpoints
─────────
POST   /transactions/           Create a new transaction
GET    /transactions/           List transactions (paginated, filterable)
GET    /transactions/{id}       Get a single transaction
PATCH  /transactions/{id}       Update a transaction
DELETE /transactions/{id}       Delete a transaction
GET    /transactions/summary    Spending summary by category
"""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import Transaction, TransactionCategory, TransactionType
from app.routes.auth import get_current_user
from app.models.models import User
from app.schemas.schemas import (
    CategorizationRequest,
    CategorizationResponse,
    CategorizationResultItem,
    TransactionCreate,
    TransactionListResponse,
    TransactionResponse,
    TransactionUpdate,
)
from app.services.categorization import categorize_batch

router = APIRouter(prefix="/transactions", tags=["Transactions"])


# ── Categorization Endpoint ──────────────────────────────────────────────
@router.post(
    "/categorize",
    response_model=CategorizationResponse,
    summary="Categorize raw transaction descriptions using the rule-based engine",
)
async def categorize_transactions(
    body: CategorizationRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Accept an array of raw transaction descriptions + amounts and return
    predicted categories.  Currently uses a rule-based keyword engine;
    will be swapped for an ML model in a future module.
    """
    items = [item.model_dump() for item in body.transactions]
    results = categorize_batch(items)
    return CategorizationResponse(
        results=[
            CategorizationResultItem(
                original_description=r.original_description,
                assigned_category=r.assigned_category,
                confidence=r.confidence,
                matched_keyword=r.matched_keyword,
            )
            for r in results
        ],
        engine="rule-based-v1",
    )


@router.post(
    "/",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a new transaction (with auto-categorization)",
)
async def create_transaction(
    body: TransactionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new transaction bound to the authenticated user.

    **Auto-categorization:** If the user submits the default category
    ``"other"`` and provides a description, the Module 3 categorization
    engine will automatically suggest a category. The AI suggestion and
    its confidence score are always stored regardless of override.
    """
    # Validate enums
    try:
        txn_type = TransactionType(body.transaction_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid transaction_type. Must be one of: {[e.value for e in TransactionType]}",
        )
    try:
        category = TransactionCategory(body.category)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid category. Must be one of: {[e.value for e in TransactionCategory]}",
        )

    # ── Auto-categorization via Module 3 engine ──────────────────────
    ai_suggestion: str | None = None
    ai_confidence: float | None = None

    if body.description:
        from app.services.categorization import categorize

        cat_result = categorize(
            description=body.description,
            amount=body.amount,
        )
        ai_suggestion = cat_result.assigned_category
        ai_confidence = cat_result.confidence

        # Auto-apply if the user left category as default "other"
        if body.category == "other" and cat_result.confidence >= 0.5:
            try:
                category = TransactionCategory(cat_result.assigned_category)
            except ValueError:
                pass  # Keep the user's original category

    txn = Transaction(
        user_id=current_user.id,
        bank_account_id=body.bank_account_id,
        transaction_type=txn_type,
        category=category,
        amount=body.amount,
        currency=body.currency,
        description=body.description,
        merchant_name=body.merchant_name,
        transaction_date=body.transaction_date,
        is_recurring=body.is_recurring,
        ai_category_suggestion=ai_suggestion,
        ai_confidence_score=ai_confidence,
    )
    db.add(txn)
    await db.flush()
    await db.refresh(txn)
    return txn


@router.get(
    "/",
    response_model=TransactionListResponse,
    summary="List transactions with pagination and optional filters",
)
async def list_transactions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category: str | None = None,
    transaction_type: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Transaction).where(Transaction.user_id == current_user.id)

    # Apply filters
    if category:
        query = query.where(Transaction.category == TransactionCategory(category))
    if transaction_type:
        query = query.where(
            Transaction.transaction_type == TransactionType(transaction_type)
        )
    if start_date:
        query = query.where(Transaction.transaction_date >= start_date)
    if end_date:
        query = query.where(Transaction.transaction_date <= end_date)

    # Total count
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Paginate
    query = (
        query.order_by(Transaction.transaction_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(query)
    items = list(result.scalars().all())

    return TransactionListResponse(
        items=items, total=total, page=page, page_size=page_size
    )


@router.get(
    "/summary",
    summary="Spending summary grouped by category",
)
async def spending_summary(
    start_date: date | None = None,
    end_date: date | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(
            Transaction.category,
            func.sum(Transaction.amount).label("total"),
            func.count(Transaction.id).label("count"),
        )
        .where(
            Transaction.user_id == current_user.id,
            Transaction.transaction_type == TransactionType.EXPENSE,
        )
        .group_by(Transaction.category)
    )
    if start_date:
        query = query.where(Transaction.transaction_date >= start_date)
    if end_date:
        query = query.where(Transaction.transaction_date <= end_date)

    result = await db.execute(query)
    rows = result.all()

    return {
        "summary": [
            {"category": row.category.value, "total": float(row.total), "count": row.count}
            for row in rows
        ]
    }


@router.get(
    "/{transaction_id}",
    response_model=TransactionResponse,
    summary="Get a single transaction",
)
async def get_transaction(
    transaction_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.user_id == current_user.id,
        )
    )
    txn = result.scalar_one_or_none()
    if txn is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found"
        )
    return txn


@router.patch(
    "/{transaction_id}",
    response_model=TransactionResponse,
    summary="Update a transaction",
)
async def update_transaction(
    transaction_id: uuid.UUID,
    body: TransactionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.user_id == current_user.id,
        )
    )
    txn = result.scalar_one_or_none()
    if txn is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found"
        )

    update_data = body.model_dump(exclude_unset=True)
    if "category" in update_data:
        update_data["category"] = TransactionCategory(update_data["category"])
    for field, value in update_data.items():
        setattr(txn, field, value)

    await db.flush()
    await db.refresh(txn)
    return txn


@router.delete(
    "/{transaction_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a transaction",
)
async def delete_transaction(
    transaction_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.user_id == current_user.id,
        )
    )
    txn = result.scalar_one_or_none()
    if txn is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found"
        )
    await db.delete(txn)
