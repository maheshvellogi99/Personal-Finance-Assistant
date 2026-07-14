"""
Password hashing and JWT token utilities.

Uses bcrypt directly for password hashing and HS256 JWTs via python-jose.

Security design
───────────────
• Passwords are never stored in plain text — always bcrypt-hashed.
• JWTs carry ``sub`` (user ID), ``role``, and ``exp`` claims.
• Token verification checks both signature validity and expiration.
• The ``role`` claim enables RBAC enforcement at the dependency layer.

Note: We use the ``bcrypt`` package directly (instead of passlib) because
passlib 1.7.4 has a known compatibility issue with bcrypt >= 4.1.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings


# ── Password Hashing ────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    """Return a bcrypt hash of *plain*."""
    return bcrypt.hashpw(
        plain.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Return ``True`` if *plain* matches *hashed*."""
    try:
        return bcrypt.checkpw(
            plain.encode("utf-8"), hashed.encode("utf-8")
        )
    except (ValueError, TypeError):
        return False


# ── JWT ──────────────────────────────────────────────────────────────────
def create_access_token(
    data: dict[str, Any],
    expires_delta: timedelta | None = None,
) -> str:
    """
    Create a signed JWT containing *data* as claims.

    The token always includes:
    - ``sub``:  User ID (string UUID)
    - ``role``: User role (e.g., "user", "admin")
    - ``exp``:  Expiration timestamp
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    """
    Decode and verify a JWT.

    Returns the claims dict (containing ``sub``, ``role``, ``exp``)
    or ``None`` if the token is invalid or expired.
    """
    try:
        return jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
    except JWTError:
        return None
