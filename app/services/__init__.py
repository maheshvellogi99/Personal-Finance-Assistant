"""
Rule-based transaction categorization engine.

This module acts as the placeholder for a future ML-based classifier.
It uses keyword matching against transaction descriptions to assign
categories from the TransactionCategory enum.

Architecture note:  The ``categorize()`` function is designed with the
same input/output contract an ML model would use, making the swap
seamless when the AI module is implemented.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.models.models import TransactionCategory


@dataclass(frozen=True)
class CategorizationResult:
    """Result of categorizing a single transaction description."""

    original_description: str
    assigned_category: str
    confidence: float  # 0.0 – 1.0  (rule-based = 0.85 max, ML will be higher)
    matched_keyword: str | None


# ── Keyword → Category mapping ──────────────────────────────────────────
# Keys are compiled regex patterns; values are (category, base_confidence).
# Order matters — first match wins.  More specific patterns come first.
_CATEGORY_RULES: list[tuple[re.Pattern[str], TransactionCategory, float]] = [
    # ── Housing ──────────────────────────────────────────────────────
    (re.compile(r"rent|mortgage|lease|hoa|property\s*tax", re.I),
     TransactionCategory.HOUSING, 0.90),

    # ── Utilities ────────────────────────────────────────────────────
    (re.compile(r"electric|gas\s*bill|water\s*bill|sewage|internet|wifi|broadband|comcast|at&t|verizon|t-mobile|sprint|phone\s*bill|utility", re.I),
     TransactionCategory.UTILITIES, 0.88),

    # ── Food / Groceries ────────────────────────────────────────────
    (re.compile(r"whole\s*foods|trader\s*joe|walmart\s*grocery|kroger|safeway|aldi|costco|publix|grocery|supermarket|farmers?\s*market", re.I),
     TransactionCategory.FOOD, 0.90),

    # ── Dining / Restaurants ─────────────────────────────────────────
    (re.compile(r"starbucks|mcdonald|burger\s*king|chipotle|subway|wendy|taco\s*bell|pizza|doordash|uber\s*eats|grubhub|restaurant|dine|dining|cafe|coffee|brunch|lunch|dinner", re.I),
     TransactionCategory.FOOD, 0.85),

    # ── Transportation ───────────────────────────────────────────────
    (re.compile(r"uber(?!\s*eats)|lyft|taxi|cab\s*fare|gas\s*station|shell\s*gas|chevron|bp\s*gas|exxon|parking|toll|metro\s*card|transit|bus\s*pass|train|amtrak|airline|flight|delta|united|southwest|american\s*air", re.I),
     TransactionCategory.TRANSPORTATION, 0.87),

    # ── Healthcare ───────────────────────────────────────────────────
    (re.compile(r"doctor|hospital|clinic|pharmacy|cvs|walgreens|medical|dental|optometrist|health\s*insurance|copay|prescription|lab\s*work", re.I),
     TransactionCategory.HEALTHCARE, 0.88),

    # ── Entertainment ────────────────────────────────────────────────
    (re.compile(r"netflix|hulu|disney\+?|spotify|apple\s*music|youtube\s*premium|hbo|amazon\s*prime|movie|theater|concert|gaming|steam|playstation|xbox|nintendo|twitch|cinema", re.I),
     TransactionCategory.ENTERTAINMENT, 0.90),

    # ── Shopping ─────────────────────────────────────────────────────
    (re.compile(r"amazon(?!\s*prime)|ebay|target|walmart(?!\s*grocery)|best\s*buy|ikea|home\s*depot|lowe|zara|h&m|nike|adidas|clothing|apparel|online\s*shopping|retail", re.I),
     TransactionCategory.SHOPPING, 0.85),

    # ── Education ────────────────────────────────────────────────────
    (re.compile(r"tuition|university|college|school|course|udemy|coursera|textbook|student\s*loan|education|training|workshop|bootcamp", re.I),
     TransactionCategory.EDUCATION, 0.88),

    # ── Subscriptions / Recurring (map to utilities or entertainment)
    (re.compile(r"subscription|membership|monthly\s*fee|annual\s*fee|recurring|aws|cloud\s*bill|hosting|digital\s*ocean|heroku", re.I),
     TransactionCategory.UTILITIES, 0.80),

    # ── Debt Payments ────────────────────────────────────────────────
    (re.compile(r"loan\s*payment|credit\s*card\s*payment|debt|installment|emi|payoff|balance\s*transfer", re.I),
     TransactionCategory.DEBT_PAYMENT, 0.88),

    # ── Savings / Investment ─────────────────────────────────────────
    (re.compile(r"savings?\s*deposit|401k|ira|roth|investment|stock|etf|mutual\s*fund|brokerage|robinhood|vanguard|fidelity|schwab|dividend", re.I),
     TransactionCategory.INVESTMENT, 0.87),

    # ── Income ───────────────────────────────────────────────────────
    (re.compile(r"salary|payroll|paycheck|direct\s*deposit|wage", re.I),
     TransactionCategory.INCOME_SALARY, 0.92),

    (re.compile(r"freelance|contract|gig|side\s*hustle|fiverr|upwork|consulting\s*fee", re.I),
     TransactionCategory.INCOME_FREELANCE, 0.88),

    (re.compile(r"refund|cashback|rebate|reimbursement|bonus|gift|reward|interest\s*earned", re.I),
     TransactionCategory.INCOME_OTHER, 0.82),

    # ── Transfer ─────────────────────────────────────────────────────
    (re.compile(r"transfer|zelle|venmo|paypal|wire|ach", re.I),
     TransactionCategory.TRANSFER, 0.80),
]


def categorize(description: str, amount: float | None = None) -> CategorizationResult:
    """
    Categorize a single transaction description.

    Parameters
    ----------
    description : str
        The raw merchant/transaction description string.
    amount : float, optional
        The transaction amount (reserved for future ML features that
        consider amount ranges).

    Returns
    -------
    CategorizationResult
    """
    description_clean = description.strip()

    for pattern, category, confidence in _CATEGORY_RULES:
        match = pattern.search(description_clean)
        if match:
            return CategorizationResult(
                original_description=description_clean,
                assigned_category=category.value,
                confidence=confidence,
                matched_keyword=match.group(0),
            )

    # Fallback — no rule matched
    return CategorizationResult(
        original_description=description_clean,
        assigned_category=TransactionCategory.OTHER.value,
        confidence=0.50,
        matched_keyword=None,
    )


def categorize_batch(
    items: list[dict],
) -> list[CategorizationResult]:
    """
    Categorize a batch of transactions.

    Parameters
    ----------
    items : list[dict]
        Each dict must have ``description`` (str) and optionally ``amount`` (float).

    Returns
    -------
    list[CategorizationResult]
    """
    return [
        categorize(
            description=item["description"],
            amount=item.get("amount"),
        )
        for item in items
    ]
