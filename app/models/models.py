"""
SQLAlchemy ORM models for the Virtual Personal Finance Assistant.

Relational structure
────────────────────
User  1 ─── ∞  BankAccount
User  1 ─── ∞  Transaction
User  1 ─── ∞  Budget
User  1 ─── ∞  SavingsGoal
BankAccount 1 ── ∞  Transaction

GDPR-specific fields (data_consent, consent_timestamp, anonymized_flag,
data_deletion_requested_at) live on the User model so the platform can
honour consent withdrawal and right-to-erasure requests.
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


# ═══════════════════════════════════════════════════════════════════════════
# Enums
# ═══════════════════════════════════════════════════════════════════════════
class AccountType(str, enum.Enum):
    CHECKING = "checking"
    SAVINGS = "savings"
    CREDIT_CARD = "credit_card"
    INVESTMENT = "investment"
    LOAN = "loan"


class TransactionType(str, enum.Enum):
    INCOME = "income"
    EXPENSE = "expense"
    TRANSFER = "transfer"


class TransactionCategory(str, enum.Enum):
    HOUSING = "housing"
    TRANSPORTATION = "transportation"
    FOOD = "food"
    UTILITIES = "utilities"
    HEALTHCARE = "healthcare"
    ENTERTAINMENT = "entertainment"
    SHOPPING = "shopping"
    EDUCATION = "education"
    SAVINGS = "savings"
    INVESTMENT = "investment"
    DEBT_PAYMENT = "debt_payment"
    INCOME_SALARY = "income_salary"
    INCOME_FREELANCE = "income_freelance"
    INCOME_OTHER = "income_other"
    TRANSFER = "transfer"
    OTHER = "other"


class BudgetPeriod(str, enum.Enum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"


class GoalStatus(str, enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class UserRole(str, enum.Enum):
    USER = "user"
    ADMIN = "admin"


# ═══════════════════════════════════════════════════════════════════════════
# Mixin for common audit columns
# ═══════════════════════════════════════════════════════════════════════════
class TimestampMixin:
    """Adds created_at / updated_at to any model."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


# ═══════════════════════════════════════════════════════════════════════════
# User
# ═══════════════════════════════════════════════════════════════════════════
class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone_number: Mapped[str | None] = mapped_column(String(20))
    currency_preference: Mapped[str] = mapped_column(
        String(3), server_default="USD"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    is_verified: Mapped[bool] = mapped_column(Boolean, server_default="false")
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role_enum"),
        server_default="USER",
        nullable=False,
        comment="RBAC role: 'USER' (default) or 'ADMIN'.",
    )

    # ── GDPR Compliance Fields ───────────────────────────────────────────
    data_consent: Mapped[bool] = mapped_column(
        Boolean,
        server_default="false",
        nullable=False,
        comment="User has given explicit GDPR consent for data processing.",
    )
    consent_timestamp: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        comment="When the user last gave/updated consent.",
    )
    anonymized_flag: Mapped[bool] = mapped_column(
        Boolean,
        server_default="false",
        nullable=False,
        comment="True when PII has been scrubbed (right-to-erasure).",
    )
    data_deletion_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        comment="Timestamp of a GDPR deletion request, if any.",
    )

    # ── MFA Fields ────────────────────────────────────────────────────────
    mfa_secret: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        default=None,
        comment="Base32-encoded TOTP secret for Google Authenticator MFA.",
    )
    mfa_enabled: Mapped[bool] = mapped_column(
        Boolean,
        server_default="false",
        nullable=False,
        comment="Whether TOTP-based MFA is active for this user.",
    )

    # ── Relationships ────────────────────────────────────────────────────
    bank_accounts: Mapped[list[BankAccount]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )
    transactions: Mapped[list[Transaction]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )
    budgets: Mapped[list[Budget]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )
    savings_goals: Mapped[list[SavingsGoal]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<User {self.email}>"


# ═══════════════════════════════════════════════════════════════════════════
# Bank Account
# ═══════════════════════════════════════════════════════════════════════════
class BankAccount(TimestampMixin, Base):
    __tablename__ = "bank_accounts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    account_name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_type: Mapped[AccountType] = mapped_column(
        Enum(AccountType, name="account_type_enum"), nullable=False
    )
    institution_name: Mapped[str | None] = mapped_column(String(255))
    # Last-4 digits only — never store full account numbers
    account_number_last4: Mapped[str | None] = mapped_column(String(4))
    balance: Mapped[float] = mapped_column(
        Numeric(precision=15, scale=2), server_default="0.00"
    )
    currency: Mapped[str] = mapped_column(String(3), server_default="USD")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")

    # ── Relationships ────────────────────────────────────────────────────
    user: Mapped[User] = relationship(back_populates="bank_accounts")
    transactions: Mapped[list[Transaction]] = relationship(
        back_populates="bank_account", cascade="all, delete-orphan", lazy="selectin"
    )

    __table_args__ = (
        Index("ix_bank_accounts_user_type", "user_id", "account_type"),
    )

    def __repr__(self) -> str:
        return f"<BankAccount {self.account_name} ({self.account_type.value})>"


# ═══════════════════════════════════════════════════════════════════════════
# Transaction
# ═══════════════════════════════════════════════════════════════════════════
class Transaction(TimestampMixin, Base):
    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bank_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("bank_accounts.id", ondelete="SET NULL"),
        index=True,
    )
    transaction_type: Mapped[TransactionType] = mapped_column(
        Enum(TransactionType, name="transaction_type_enum"), nullable=False
    )
    category: Mapped[TransactionCategory] = mapped_column(
        Enum(TransactionCategory, name="transaction_category_enum"),
        server_default="OTHER",
    )
    amount: Mapped[float] = mapped_column(
        Numeric(precision=15, scale=2), nullable=False
    )
    currency: Mapped[str] = mapped_column(String(3), server_default="USD")
    description: Mapped[str | None] = mapped_column(String(500))
    merchant_name: Mapped[str | None] = mapped_column(String(255))
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_recurring: Mapped[bool] = mapped_column(Boolean, server_default="false")

    # AI-enrichment placeholder — stores the category predicted by the ML model
    ai_category_suggestion: Mapped[str | None] = mapped_column(String(100))
    ai_confidence_score: Mapped[float | None] = mapped_column(
        Numeric(precision=5, scale=4)
    )

    # ── Relationships ────────────────────────────────────────────────────
    user: Mapped[User] = relationship(back_populates="transactions")
    bank_account: Mapped[BankAccount | None] = relationship(
        back_populates="transactions"
    )

    __table_args__ = (
        Index("ix_transactions_user_date", "user_id", "transaction_date"),
        Index("ix_transactions_user_category", "user_id", "category"),
    )

    def __repr__(self) -> str:
        return f"<Transaction {self.amount} {self.transaction_type.value}>"


# ═══════════════════════════════════════════════════════════════════════════
# Budget
# ═══════════════════════════════════════════════════════════════════════════
class Budget(TimestampMixin, Base):
    __tablename__ = "budgets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category: Mapped[TransactionCategory] = mapped_column(
        Enum(TransactionCategory, name="transaction_category_enum"),
        nullable=False,
    )
    budget_limit: Mapped[float] = mapped_column(
        Numeric(precision=15, scale=2), nullable=False
    )
    spent_amount: Mapped[float] = mapped_column(
        Numeric(precision=15, scale=2), server_default="0.00"
    )
    period: Mapped[BudgetPeriod] = mapped_column(
        Enum(BudgetPeriod, name="budget_period_enum"),
        server_default="MONTHLY",
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    alert_threshold_pct: Mapped[float] = mapped_column(
        Numeric(precision=5, scale=2),
        server_default="80.00",
        comment="Percentage at which the user gets a budget warning.",
    )

    # ── Relationships ────────────────────────────────────────────────────
    user: Mapped[User] = relationship(back_populates="budgets")

    __table_args__ = (
        Index("ix_budgets_user_period", "user_id", "period"),
    )

    def __repr__(self) -> str:
        return f"<Budget {self.category.value} {self.budget_limit}>"


# ═══════════════════════════════════════════════════════════════════════════
# Savings Goal
# ═══════════════════════════════════════════════════════════════════════════
class SavingsGoal(TimestampMixin, Base):
    __tablename__ = "savings_goals"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    goal_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    target_amount: Mapped[float] = mapped_column(
        Numeric(precision=15, scale=2), nullable=False
    )
    current_amount: Mapped[float] = mapped_column(
        Numeric(precision=15, scale=2), server_default="0.00"
    )
    currency: Mapped[str] = mapped_column(String(3), server_default="USD")
    target_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[GoalStatus] = mapped_column(
        Enum(GoalStatus, name="goal_status_enum"),
        server_default="ACTIVE",
    )

    # AI-driven recommendation placeholder
    ai_monthly_suggestion: Mapped[float | None] = mapped_column(
        Numeric(precision=15, scale=2),
        comment="AI-recommended monthly contribution to meet the goal on time.",
    )

    # ── Relationships ────────────────────────────────────────────────────
    user: Mapped[User] = relationship(back_populates="savings_goals")

    def __repr__(self) -> str:
        return f"<SavingsGoal {self.goal_name} {self.status.value}>"
