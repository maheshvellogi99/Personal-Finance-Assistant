"""
Authentication, user management, RBAC, MFA, & Google OAuth routes.

Endpoints
─────────
POST /auth/register       Register a new user (requires GDPR consent)
POST /auth/login          Obtain a JWT access token (JSON body)
POST /auth/token          Obtain a JWT access token (OAuth2 form-encoded)
POST /auth/google         Verify Google OAuth ID token & issue JWT
GET  /auth/me             Current user profile
PATCH /auth/me/consent    Update GDPR consent
POST /auth/me/deletion    Request GDPR data deletion
POST /auth/mfa/setup      Generate TOTP secret + QR code for MFA
POST /auth/mfa/verify     Verify TOTP code to activate MFA
POST /auth/mfa/disable    Disable MFA (requires valid TOTP code)

Dependencies (importable by other routers)
──────────────────────────────────────────
get_current_user   — Validates JWT and returns the User ORM instance
get_current_admin  — Same + enforces role == "admin" (RBAC)
"""

from __future__ import annotations

import base64
import io
import logging
import secrets
import uuid
from datetime import datetime, timezone

import pyotp
import qrcode
import requests as http_requests
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.models.models import User, UserRole
from app.core.rate_limiter import rate_limit
from app.schemas.schemas import (
    GDPRConsentUpdate,
    GDPRDeletionRequest,
    GoogleAuthRequest,
    MFADisableRequest,
    MFASetupResponse,
    MFAVerifyRequest,
    MFAVerifyResponse,
    TokenResponse,
    UserCreate,
    UserLogin,
    UserResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token", auto_error=False)


# ═══════════════════════════════════════════════════════════════════════════
#  Dependency: get_current_user  (JWT validation + DB lookup)
# ═══════════════════════════════════════════════════════════════════════════
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Decode JWT and return the corresponding ``User`` ORM instance.

    **Security enforcement:**
    - Token must be present and non-empty
    - Token must have a valid signature (HS256)
    - Token must not be expired
    - ``sub`` claim must map to an active user in the database

    **Sandbox bypass (development only):**
    During development, if no valid token is provided, a demo sandbox user
    is returned to allow frontend testing. This bypass should be disabled
    in production by removing the fallback block.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # ── Sandbox bypass for development ───────────────────────────────
    # TODO: Remove this block before production deployment
    if not token or token in ("null", "undefined", ""):
        # Check if the demo user exists in the DB
        result = await db.execute(
            select(User).where(
                User.id == uuid.UUID("00000000-0000-0000-0000-000000000000")
            )
        )
        demo_user = result.scalar_one_or_none()
        if demo_user:
            return demo_user
        # If no demo user in DB, return an in-memory stub
        return User(
            id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
            email="demo@sandbox.local",
            full_name="Demo User",
            is_active=True,
            role=UserRole.USER,
        )

    # ── Strict JWT validation ────────────────────────────────────────
    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception

    user_id: str | None = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    return user


# ═══════════════════════════════════════════════════════════════════════════
#  Dependency: get_current_admin  (RBAC enforcement)
# ═══════════════════════════════════════════════════════════════════════════
async def get_current_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """
    Enforce admin-level access.

    Wraps ``get_current_user`` and additionally checks that the user's
    role is ``admin``.  Returns 403 if the user is authenticated but
    lacks admin privileges.

    Usage in any router:
        ``current_user: User = Depends(get_current_admin)``
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required. Your role: "
                   f"'{current_user.role.value}'.",
        )
    return current_user


# ═══════════════════════════════════════════════════════════════════════════
#  Helper: build JWT with role claim
# ═══════════════════════════════════════════════════════════════════════════
def _build_token(user: User) -> str:
    """Create a JWT embedding user ID and role as claims."""
    return create_access_token(
        data={
            "sub": str(user.id),
            "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        }
    )


# ═══════════════════════════════════════════════════════════════════════════
#  Endpoints
# ═══════════════════════════════════════════════════════════════════════════

# ── POST /auth/register ─────────────────────────────────────────────────
@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
)
async def register(body: UserCreate, db: AsyncSession = Depends(get_db)):
    """
    Create a new user account.

    **Requirements:**
    - Valid email address (unique)
    - Password: 8–128 characters
    - GDPR data-processing consent must be explicitly given

    **Optional fields:**
    - ``role``: defaults to ``"user"``, can be ``"admin"`` (for setup)
    """
    # Check GDPR consent
    if not body.data_consent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="GDPR data-processing consent is required to register.",
        )

    # Check for duplicate email
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        )

    # Resolve role
    try:
        role = UserRole(body.role) if body.role else UserRole.USER
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role. Must be one of: {[r.value for r in UserRole]}",
        )

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        phone_number=body.phone_number,
        currency_preference=body.currency_preference,
        role=role,
        data_consent=True,
        consent_timestamp=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


# ── POST /auth/login  (JSON body) ───────────────────────────────────────
@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Authenticate and receive a JWT (JSON body)",
    dependencies=[Depends(rate_limit(5, 60))],
)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    """
    Authenticate via email + password and receive a JWT access token.

    Accepts a JSON body: ``{ "email": "...", "password": "...", "totp_code": "..." }``

    If the user has MFA enabled, a valid 6-digit TOTP code is required.
    """
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    # ── MFA gate ─────────────────────────────────────────────────────
    if user.mfa_enabled and user.mfa_secret:
        if not body.totp_code:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="MFA_REQUIRED",
            )
        totp = pyotp.TOTP(user.mfa_secret)
        if not totp.verify(body.totp_code, valid_window=1):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="INVALID_MFA",
            )

    token = _build_token(user)
    return TokenResponse(access_token=token, mfa_enabled=user.mfa_enabled)


# ── POST /auth/token  (OAuth2 form-encoded) ─────────────────────────────
@router.post(
    "/token",
    response_model=TokenResponse,
    summary="Authenticate via OAuth2 form (Swagger UI compatible)",
)
async def token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """
    OAuth2-compatible token endpoint for Swagger UI's "Authorize" button.

    Accepts ``application/x-www-form-urlencoded`` with:
    - ``username``: user's email address
    - ``password``: user's password

    Returns a JWT ``access_token`` with ``token_type: "bearer"``.
    """
    result = await db.execute(
        select(User).where(User.email == form_data.username)
    )
    user = result.scalar_one_or_none()

    if user is None or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    token = _build_token(user)
    return TokenResponse(access_token=token)


# ── POST /auth/google  (Google OAuth ID Token) ─────────────────────────
@router.post(
    "/google",
    response_model=TokenResponse,
    summary="Authenticate via Google OAuth token (access token or ID token)",
)
async def google_auth(
    body: GoogleAuthRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Verify a Google OAuth token and issue a JWT.

    Supports **two** Google token formats:
    - **ID Token** (JWT, 3 dot-separated segments): Verified locally using
      Google's public keys via ``verify_oauth2_token``.
    - **Access Token** (``ya29...`` opaque string): Verified by calling
      Google's ``/oauth2/v3/userinfo`` API.

    **Flow:**
    1. Detect token type and resolve user profile (email, name).
    2. If the user does NOT exist in the database, auto-register them.
    3. If the user has MFA enabled, enforce TOTP verification.
    4. Issue and return a standard JWT access token.
    """
    email: str | None = None
    given_name: str = ""
    family_name: str = ""

    # ── Detect token type and verify ────────────────────────────────
    token_segments = body.token.count(".")
    if token_segments == 2:
        # This looks like a JWT ID token (header.payload.signature)
        if not settings.GOOGLE_CLIENT_ID:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Google OAuth is not configured. Set GOOGLE_CLIENT_ID in .env.",
            )
        try:
            id_info = google_id_token.verify_oauth2_token(
                body.token,
                google_requests.Request(),
                settings.GOOGLE_CLIENT_ID,
            )
        except ValueError as e:
            logger.warning("Google ID token verification failed: %s", e)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Google ID token.",
            )
        email = id_info.get("email")
        given_name = id_info.get("given_name", "")
        family_name = id_info.get("family_name", "")
    else:
        # This is an access token (ya29...) — call Google's userinfo API
        try:
            resp = http_requests.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {body.token}"},
                timeout=10,
            )
            if resp.status_code != 200:
                logger.warning(
                    "Google userinfo API returned %s: %s",
                    resp.status_code,
                    resp.text,
                )
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid Google access token.",
                )
            user_info = resp.json()
        except http_requests.exceptions.RequestException as e:
            logger.error("Failed to contact Google userinfo API: %s", e)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not verify Google token. Please try again.",
            )
        email = user_info.get("email")
        given_name = user_info.get("given_name", "")
        family_name = user_info.get("family_name", "")

    # ── Validate email was extracted ────────────────────────────────
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google token does not contain an email address.",
        )

    full_name = f"{given_name} {family_name}".strip() or email.split("@")[0]

    # ── Check if user exists ────────────────────────────────────────
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        # Auto-register: create a new user with a secure random password
        random_password = secrets.token_urlsafe(32)
        user = User(
            email=email,
            hashed_password=hash_password(random_password),
            full_name=full_name,
            is_active=True,
            is_verified=True,
            role=UserRole.USER,
            data_consent=True,
            consent_timestamp=datetime.now(timezone.utc),
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)
        logger.info("Auto-registered new Google OAuth user: %s", email)

    # ── Check account status ────────────────────────────────────────
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    # ── MFA gate ────────────────────────────────────────────────────
    if user.mfa_enabled and user.mfa_secret:
        if not body.totp_code:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="MFA_REQUIRED",
            )
        totp = pyotp.TOTP(user.mfa_secret)
        if not totp.verify(body.totp_code, valid_window=1):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="INVALID_MFA",
            )

    # ── Issue JWT ───────────────────────────────────────────────────
    token = _build_token(user)
    return TokenResponse(access_token=token, mfa_enabled=user.mfa_enabled)


# ── GET /auth/me ─────────────────────────────────────────────────────────
@router.get("/me", response_model=UserResponse, summary="Get current user profile")
async def me(current_user: User = Depends(get_current_user)):
    """Return the profile of the currently authenticated user."""
    return current_user


# ── PATCH /auth/me/consent ───────────────────────────────────────────────
@router.patch(
    "/me/consent",
    response_model=UserResponse,
    summary="Update GDPR consent",
)
async def update_consent(
    body: GDPRConsentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Grant or withdraw GDPR data-processing consent."""
    current_user.data_consent = body.data_consent
    current_user.consent_timestamp = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(current_user)
    return current_user


# ── POST /auth/me/deletion ──────────────────────────────────────────────
@router.post(
    "/me/deletion",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Request GDPR data deletion (right to erasure)",
)
async def request_deletion(
    body: GDPRDeletionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Record a GDPR data-deletion request.

    Data will be anonymised/erased within 30 days per GDPR Article 17.
    """
    if not body.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must confirm the deletion request.",
        )
    current_user.data_deletion_requested_at = datetime.now(timezone.utc)
    await db.flush()
    return {
        "message": "Deletion request recorded. Your data will be erased within 30 days per GDPR requirements."
    }


# ═══════════════════════════════════════════════════════════════════════════
#  MFA Endpoints
# ═══════════════════════════════════════════════════════════════════════════

def _generate_qr_base64(uri: str) -> str:
    """Generate a base64-encoded PNG QR code from a provisioning URI."""
    img = qrcode.make(uri)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode("utf-8")


# ── POST /auth/mfa/setup  (STATELESS — no DB write) ────────────────────
@router.post(
    "/mfa/setup",
    response_model=MFASetupResponse,
    summary="Generate TOTP secret and QR code for MFA setup",
)
async def mfa_setup(
    current_user: User = Depends(get_current_user),
):
    """
    Generate a new TOTP secret and return it to the client.

    **This endpoint does NOT modify the database.**  The secret is
    only persisted when the user successfully calls ``/mfa/verify``
    with the correct 6-digit code, preventing the "ghost secret"
    overwrite bug where an aborted setup locks the user out.
    """
    secret = pyotp.random_base32()

    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(
        name=current_user.email,
        issuer_name="AWS Personal Finance Assistant",
    )
    qr_b64 = _generate_qr_base64(provisioning_uri)

    return MFASetupResponse(
        secret=secret,
        provisioning_uri=provisioning_uri,
        qr_code_base64=qr_b64,
    )


# ── POST /auth/mfa/verify ───────────────────────────────────────────────
@router.post(
    "/mfa/verify",
    response_model=MFAVerifyResponse,
    summary="Verify a TOTP code to activate MFA",
)
async def mfa_verify(
    body: MFAVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Verify the 6-digit code against the secret from ``/mfa/setup``.

    The client sends back the ``secret`` it received from ``/mfa/setup``
    along with the ``totp_code`` the user entered from their authenticator.
    **Only if the code is valid**, the secret is persisted to the database
    and MFA is activated.  This prevents the "ghost secret" bug.
    """
    totp = pyotp.TOTP(body.secret)
    if not totp.verify(body.totp_code, valid_window=1):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid TOTP code. Please try again.",
        )

    # ── Only NOW commit the secret to the database ──────────────────
    current_user.mfa_secret = body.secret
    current_user.mfa_enabled = True
    await db.flush()
    await db.refresh(current_user)

    return MFAVerifyResponse(
        message="MFA has been successfully enabled on your account.",
        mfa_enabled=True,
    )


# ── POST /auth/mfa/disable ──────────────────────────────────────────────
@router.post(
    "/mfa/disable",
    response_model=MFAVerifyResponse,
    summary="Disable MFA (requires a valid TOTP code)",
)
async def mfa_disable(
    body: MFADisableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Disable MFA on the user's account. Requires a valid TOTP code as
    confirmation to prevent accidental or unauthorized deactivation.
    """
    if not current_user.mfa_enabled or not current_user.mfa_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA is not currently enabled on your account.",
        )

    totp = pyotp.TOTP(current_user.mfa_secret)
    if not totp.verify(body.totp_code, valid_window=1):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid TOTP code. Cannot disable MFA.",
        )

    current_user.mfa_enabled = False
    current_user.mfa_secret = None
    await db.flush()
    await db.refresh(current_user)

    return MFAVerifyResponse(
        message="MFA has been disabled on your account.",
        mfa_enabled=False,
    )
