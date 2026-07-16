"""
Pydantic schemas for request validation and response serialisation.

Naming convention:
  • *Create  — incoming POST body
  • *Update  — incoming PATCH body (all fields optional)
  • *Response — outgoing JSON representation
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ═══════════════════════════════════════════════════════════════════════════
#  Auth
# ═══════════════════════════════════════════════════════════════════════════
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=255)
    phone_number: str | None = Field(None, max_length=20)
    currency_preference: str = Field("USD", max_length=3)
    role: str | None = Field(
        None,
        description="User role: 'user' (default) or 'admin'",
    )
    data_consent: bool = Field(
        ..., description="GDPR: explicit consent for data processing"
    )


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str
    phone_number: str | None
    currency_preference: str
    is_active: bool
    is_verified: bool
    mfa_enabled: bool = False
    role: str = "user"
    data_consent: bool
    consent_timestamp: datetime | None
    anonymized_flag: bool
    created_at: datetime
    updated_at: datetime


class AdminUserResponse(BaseModel):
    """Lightweight user view for admin endpoints — excludes password hashes."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    role: str = "user"
    is_active: bool
    is_verified: bool
    mfa_enabled: bool = False
    data_consent: bool
    created_at: datetime
    updated_at: datetime


class UserLogin(BaseModel):
    email: EmailStr
    password: str
    totp_code: str | None = Field(
        None,
        min_length=6,
        max_length=6,
        description="6-digit TOTP code from authenticator app (required if MFA is enabled)",
    )


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    mfa_enabled: bool = False


class PasswordChangeRequest(BaseModel):
    old_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, description="New password (min 8 characters)")


# ── MFA Schemas ──────────────────────────────────────────────────────────
class MFASetupResponse(BaseModel):
    """Returned when a user initiates MFA setup."""
    secret: str = Field(..., description="Base32-encoded TOTP secret")
    provisioning_uri: str = Field(..., description="otpauth:// URI for QR code scanning")
    qr_code_base64: str = Field(..., description="Base64-encoded PNG of the QR code")
    message: str = "Scan the QR code with your authenticator app, then verify with a code."


class MFAVerifyRequest(BaseModel):
    """Verify MFA setup by providing the secret and a valid 6-digit TOTP code."""
    secret: str = Field(..., description="Base32-encoded TOTP secret from /mfa/setup")
    totp_code: str = Field(..., min_length=6, max_length=6, description="6-digit TOTP code")


class MFADisableRequest(BaseModel):
    """Disable MFA by providing a valid 6-digit TOTP code."""
    totp_code: str = Field(..., min_length=6, max_length=6, description="6-digit TOTP code")


class MFAVerifyResponse(BaseModel):
    message: str
    mfa_enabled: bool


class GoogleAuthRequest(BaseModel):
    """Google OAuth ID token verification request."""
    token: str = Field(..., description="Google OAuth ID token from the frontend")
    totp_code: str | None = Field(
        None,
        min_length=6,
        max_length=6,
        description="6-digit TOTP code (required if MFA is enabled on the account)",
    )


class GDPRConsentUpdate(BaseModel):
    """Allow the user to grant or withdraw GDPR consent."""
    data_consent: bool


class GDPRDeletionRequest(BaseModel):
    """User requests data deletion (right to erasure)."""
    confirm: bool = Field(
        ..., description="Must be True to confirm deletion request"
    )


# ═══════════════════════════════════════════════════════════════════════════
#  Bank Account
# ═══════════════════════════════════════════════════════════════════════════
class BankAccountCreate(BaseModel):
    account_name: str = Field(..., max_length=255)
    account_type: str  # validated against AccountType enum in service layer
    institution_name: str | None = Field(None, max_length=255)
    account_number_last4: str | None = Field(None, min_length=4, max_length=4)
    balance: float = 0.00
    currency: str = Field("USD", max_length=3)


class BankAccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    account_name: str
    account_type: str
    institution_name: str | None
    account_number_last4: str | None
    balance: float
    currency: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ═══════════════════════════════════════════════════════════════════════════
#  Transaction
# ═══════════════════════════════════════════════════════════════════════════
class TransactionCreate(BaseModel):
    bank_account_id: uuid.UUID | None = None
    transaction_type: str
    category: str = "other"
    amount: float = Field(..., gt=0)
    currency: str = Field("USD", max_length=3)
    description: str | None = Field(None, max_length=500)
    merchant_name: str | None = Field(None, max_length=255)
    transaction_date: date
    is_recurring: bool = False


class TransactionUpdate(BaseModel):
    category: str | None = None
    description: str | None = Field(None, max_length=500)
    merchant_name: str | None = Field(None, max_length=255)
    is_recurring: bool | None = None


class TransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    bank_account_id: uuid.UUID | None
    transaction_type: str
    category: str
    amount: float
    currency: str
    description: str | None
    merchant_name: str | None
    transaction_date: date
    is_recurring: bool
    ai_category_suggestion: str | None
    ai_confidence_score: float | None
    created_at: datetime
    updated_at: datetime


class TransactionListResponse(BaseModel):
    """Paginated list wrapper."""
    items: list[TransactionResponse]
    total: int
    page: int
    page_size: int


# ═══════════════════════════════════════════════════════════════════════════
#  Budget
# ═══════════════════════════════════════════════════════════════════════════
class BudgetCreate(BaseModel):
    category: str
    budget_limit: float = Field(..., gt=0)
    period: str = "monthly"
    start_date: date
    end_date: date
    alert_threshold_pct: float = Field(80.0, ge=0, le=100)


class BudgetUpdate(BaseModel):
    budget_limit: float | None = Field(None, gt=0)
    alert_threshold_pct: float | None = Field(None, ge=0, le=100)


class BudgetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    category: str
    budget_limit: float
    spent_amount: float
    period: str
    start_date: date
    end_date: date
    alert_threshold_pct: float
    created_at: datetime
    updated_at: datetime


# ═══════════════════════════════════════════════════════════════════════════
#  Transaction Categorization (Module 3)
# ═══════════════════════════════════════════════════════════════════════════
class CategorizationItem(BaseModel):
    """A single raw transaction to categorize."""
    description: str = Field(..., min_length=1, max_length=500)
    amount: float = Field(..., gt=0)


class CategorizationRequest(BaseModel):
    """Batch categorization request — array of raw transactions."""
    transactions: list[CategorizationItem] = Field(
        ..., min_length=1, max_length=100
    )


class CategorizationResultItem(BaseModel):
    """Category assignment for one transaction."""
    original_description: str
    assigned_category: str
    confidence: float
    matched_keyword: str | None


class CategorizationResponse(BaseModel):
    """Batch categorization response."""
    results: list[CategorizationResultItem]
    engine: str = "rule-based-v1"


# ═══════════════════════════════════════════════════════════════════════════
#  Budget Status (Module 3)
# ═══════════════════════════════════════════════════════════════════════════
class BudgetStatusItem(BaseModel):
    """Status of a single budget category for the current period."""
    budget_id: uuid.UUID
    category: str
    budget_limit: float
    spent_amount: float
    remaining: float
    percentage_used: float
    period: str
    start_date: date
    end_date: date
    alert_threshold_pct: float
    status: str  # "on_track", "warning", "exceeded"


class BudgetStatusResponse(BaseModel):
    """Overall budget status for the authenticated user."""
    month: str  # e.g. "2026-06"
    total_budget: float
    total_spent: float
    total_remaining: float
    overall_percentage: float
    budgets: list[BudgetStatusItem]
    alerts: list[str]


class BudgetRecommendation(BaseModel):
    """AI-powered budget recommendation for a single spending category."""
    category: str = Field(..., description="Spending category")
    historical_average: float = Field(
        ..., description="Raw calculated monthly average spend"
    )
    suggested_limit: float = Field(
        ..., description="Buffered & rounded-up budget recommendation"
    )
    total_spent_90_days: float = Field(
        ..., description="Total raw spend in this category over the analysis window"
    )


class BudgetAutoGenerateResponse(BaseModel):
    """Response from the automated budget recommendation engine."""
    analysis_window_days: int = Field(
        ..., description="Actual number of days of history analyzed"
    )
    month_factor: float = Field(
        ..., description="Number of months used to compute the average (≥ 1.0)"
    )
    recommendations: list[BudgetRecommendation]
    message: str


# ═══════════════════════════════════════════════════════════════════════════
#  Savings Goal
# ═══════════════════════════════════════════════════════════════════════════
class SavingsGoalCreate(BaseModel):
    goal_name: str = Field(..., max_length=255)
    description: str | None = None
    target_amount: float = Field(..., gt=0)
    currency: str = Field("INR", max_length=3)
    target_date: date | None = None
    monthly_contribution: float | None = Field(
        None, ge=0, description="Planned monthly contribution towards this goal"
    )


class SavingsGoalUpdate(BaseModel):
    goal_name: str | None = Field(None, max_length=255)
    description: str | None = None
    target_amount: float | None = Field(None, gt=0)
    current_amount: float | None = Field(None, ge=0)
    target_date: date | None = None
    status: str | None = None
    monthly_contribution: float | None = Field(
        None, ge=0, description="Planned monthly contribution towards this goal"
    )


class SavingsGoalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    goal_name: str
    description: str | None
    target_amount: float
    current_amount: float
    currency: str
    target_date: date | None
    status: str
    ai_monthly_suggestion: float | None
    created_at: datetime
    updated_at: datetime


class GoalFundRequest(BaseModel):
    amount: float = Field(..., gt=0, description="Amount to deposit into the savings goal")


# ═══════════════════════════════════════════════════════════════════════════
#  AI Chatbot (Module 4 — RAG Pipeline)
# ═══════════════════════════════════════════════════════════════════════════
class ChatMessage(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class ChatResponse(BaseModel):
    reply: str
    suggestions: list[str] | None = None


class ChatHistoryItem(BaseModel):
    role: str  # "user" or "assistant"
    content: str
    timestamp: str


class ChatHistoryResponse(BaseModel):
    messages: list[ChatHistoryItem]
    count: int


# ═══════════════════════════════════════════════════════════════════════════
#  Data Ingestion (Module 6 — Staging Pipeline with Human-in-the-Loop)
# ═══════════════════════════════════════════════════════════════════════════
class IngestionTransactionItem(BaseModel):
    """A single parsed/extracted transaction from an ingested source."""
    transaction_date: date
    description: str
    amount: float
    transaction_type: str
    category: str
    merchant_name: str | None = None
    currency: str = "USD"


class StagedTransactionItem(BaseModel):
    """
    A parsed transaction enriched with AI categorization metadata.

    Returned by the upload endpoints for frontend review before commit.
    The user can override ``category`` before calling ``confirm-ingestion``.
    """
    transaction_date: date
    description: str = Field(..., max_length=500)
    amount: float = Field(..., gt=0)
    transaction_type: str  # "income" | "expense" | "transfer"
    category: str  # AI-suggested or user-overridden
    merchant_name: str | None = None
    currency: str = Field("USD", max_length=3)
    ai_category_suggestion: str  # Original AI/engine suggestion
    ai_confidence_score: float = Field(..., ge=0.0, le=1.0)


class StatementUploadResponse(BaseModel):
    """Response from uploading a bank statement (CSV/PDF) — staging only."""
    status: str  # "success" | "partial" | "error"
    message: str
    source_format: str
    total_parsed: int
    skipped_rows: int
    transactions: list[StagedTransactionItem] = []
    errors: list[str] = []


class ScreenshotScanResponse(BaseModel):
    """Response from scanning a transaction screenshot — staging only."""
    status: str  # "success" | "partial" | "error"
    message: str
    total_extracted: int
    transactions: list[StagedTransactionItem] = []
    errors: list[str] = []


class ConfirmIngestionRequest(BaseModel):
    """
    Batch of reviewed transactions submitted by the user for final commit.

    The frontend sends back the (potentially user-edited) staged items.
    """
    transactions: list[StagedTransactionItem] = Field(
        ..., min_length=1, max_length=500,
        description="Array of reviewed transactions to commit to the database.",
    )


class ConfirmIngestionResponse(BaseModel):
    """Result of the atomic batch-commit."""
    status: str  # "success" | "error"
    message: str
    total_confirmed: int
    transactions: list[IngestionTransactionItem] = []


class SandboxConnectRequest(BaseModel):
    """Simulated Open Banking / Account Aggregator connection request."""
    provider: str = Field(
        ...,
        description="Aggregator provider name (e.g., 'setu', 'plaid', 'yodlee')",
        max_length=50,
    )
    consent_id: str = Field(
        ...,
        description="Consent/Authorization token from the aggregator",
        max_length=255,
    )
    account_type: str = Field(
        "checking",
        description="Type of account to link",
    )
    institution_name: str = Field(
        "Sandbox Bank",
        description="Name of the financial institution",
        max_length=255,
    )


class SandboxConnectResponse(BaseModel):
    """Response from the sandbox aggregator connection."""
    status: str  # "connected" | "pending" | "error"
    message: str
    provider: str
    linked_account_id: uuid.UUID | None = None
    sandbox_data: dict | None = None


# ═══════════════════════════════════════════════════════════════════════════
#  ML Insights (Module 7 — Subscription Tracking & Anomaly Detection)
# ═══════════════════════════════════════════════════════════════════════════
class SubscriptionItem(BaseModel):
    """A single detected recurring subscription."""
    merchant_name: str
    amount: float
    currency: str = "USD"
    category: str
    occurrence_count: int
    avg_interval_days: float
    confidence: float = Field(..., ge=0.0, le=1.0)
    first_seen: date
    last_seen: date
    next_expected_date: date
    is_active: bool


class SubscriptionResponse(BaseModel):
    """Response from the subscription detection endpoint."""
    total_detected: int
    active_count: int
    estimated_monthly_cost: float
    subscriptions: list[SubscriptionItem] = []


class AnomalyItem(BaseModel):
    """A single flagged spending anomaly."""
    transaction_id: uuid.UUID
    transaction_date: date
    description: str | None = None
    merchant_name: str | None = None
    category: str
    amount: float
    currency: str = "USD"
    baseline_mean: float
    baseline_std: float
    z_score: float
    severity: str  # "warning" (2–3σ) | "critical" (> 3σ)


class AnomalyResponse(BaseModel):
    """Response from the anomaly detection endpoint."""
    total_flagged: int
    critical_count: int
    warning_count: int
    lookback_days: int
    anomalies: list[AnomalyItem] = []


# ═══════════════════════════════════════════════════════════════════════════
#  Savings "What-If" Projection
# ═══════════════════════════════════════════════════════════════════════════
class WhatIfRequest(BaseModel):
    """Input for the savings what-if projection engine."""
    current_amount: float = Field(..., ge=0, description="Current savings balance")
    target_amount: float = Field(..., gt=0, description="Target savings goal amount")
    monthly_contribution: float = Field(
        ..., ge=0, description="Current baseline monthly savings rate"
    )
    additional_contribution: float = Field(
        ..., ge=0,
        description="Hypothetical extra monthly savings (e.g., by cutting a budget)",
    )


class ProjectionPoint(BaseModel):
    """A single month's data point in the projection timeline."""
    month_label: str = Field(..., description="e.g., 'Aug 2026'")
    base_balance: float
    what_if_balance: float


class WhatIfResponse(BaseModel):
    """Response from the savings what-if projection engine."""
    points: list[ProjectionPoint]
    base_months_to_goal: int = Field(
        ..., description="Months to reach the target on the base timeline (-1 if never)"
    )
    what_if_months_to_goal: int = Field(
        ..., description="Months to reach the target on the what-if timeline (-1 if never)"
    )
    months_saved: int = Field(
        ..., description="How many months sooner the what-if timeline reaches the goal"
    )
    is_unreachable: bool = Field(
        False,
        description="True if neither timeline reaches the target within the simulation horizon",
    )


# ═══════════════════════════════════════════════════════════════════════════
#  Generic
# ═══════════════════════════════════════════════════════════════════════════
class HealthResponse(BaseModel):
    status: str = "healthy"
    version: str

