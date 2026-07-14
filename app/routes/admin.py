"""
Administrative routes — RBAC-protected endpoints for platform management.

All endpoints require the ``admin`` role. Regular users receive ``403 Forbidden``.

Endpoints
─────────
GET  /admin/users              List all registered users (paginated)
GET  /admin/users/{user_id}    Get a specific user's details
PATCH /admin/users/{user_id}   Update a user's role or active status
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User, UserRole
from app.routes.auth import get_current_admin
from app.schemas.schemas import AdminUserResponse

router = APIRouter(prefix="/admin", tags=["Admin"])


# ═══════════════════════════════════════════════════════════════════════════
#  GET /admin/users — List all users (paginated)
# ═══════════════════════════════════════════════════════════════════════════
@router.get(
    "/users",
    response_model=dict,
    summary="List all registered users (admin only)",
)
async def list_users(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Results per page"),
    role: str | None = Query(None, description="Filter by role (user/admin)"),
    is_active: bool | None = Query(None, description="Filter by active status"),
    current_admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Return a paginated list of all registered users.

    Only accessible to users with the ``admin`` role. Password hashes
    and other sensitive fields are excluded from the response via the
    ``AdminUserResponse`` schema.
    """
    query = select(User)
    count_query = select(func.count(User.id))

    # ── Optional filters ────────────────────────────────────────────
    if role is not None:
        try:
            role_enum = UserRole(role)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid role: '{role}'. Valid roles: {[r.value for r in UserRole]}",
            )
        query = query.where(User.role == role_enum)
        count_query = count_query.where(User.role == role_enum)

    if is_active is not None:
        query = query.where(User.is_active == is_active)
        count_query = count_query.where(User.is_active == is_active)

    # ── Get total count ─────────────────────────────────────────────
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # ── Paginate ────────────────────────────────────────────────────
    offset = (page - 1) * page_size
    query = query.order_by(User.created_at.desc()).offset(offset).limit(page_size)

    result = await db.execute(query)
    users = result.scalars().all()

    return {
        "users": [AdminUserResponse.model_validate(u) for u in users],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


# ═══════════════════════════════════════════════════════════════════════════
#  GET /admin/users/{user_id} — Get a specific user
# ═══════════════════════════════════════════════════════════════════════════
@router.get(
    "/users/{user_id}",
    response_model=AdminUserResponse,
    summary="Get a specific user's details (admin only)",
)
async def get_user(
    user_id: uuid.UUID,
    current_admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return the details of a specific user by their UUID."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )
    return user


# ═══════════════════════════════════════════════════════════════════════════
#  PATCH /admin/users/{user_id} — Update user role or status
# ═══════════════════════════════════════════════════════════════════════════
@router.patch(
    "/users/{user_id}",
    response_model=AdminUserResponse,
    summary="Update a user's role or active status (admin only)",
)
async def update_user(
    user_id: uuid.UUID,
    role: str | None = Query(None, description="New role: 'user' or 'admin'"),
    is_active: bool | None = Query(None, description="Set active status"),
    current_admin: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a user's role or active status.

    Admins cannot deactivate their own account through this endpoint
    to prevent accidental self-lockout.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    # Prevent self-lockout
    if user.id == current_admin.id and is_active is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account.",
        )

    if role is not None:
        try:
            user.role = UserRole(role)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid role: '{role}'. Valid roles: {[r.value for r in UserRole]}",
            )

    if is_active is not None:
        user.is_active = is_active

    await db.flush()
    await db.refresh(user)
    return user
