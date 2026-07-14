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
    (re.compile(r"rent|mortgage|lease|hoa|property\s*tax|house\s*tax|society\s*maintenance|pg\s*rent|hostel", re.I),
     TransactionCategory.HOUSING, 0.90),

    # ── Utilities & Bills ────────────────────────────────────────────
    (re.compile(
        r"electric|gas\s*bill|water\s*bill|sewage|internet|wifi|broadband|"
        r"comcast|at&t|verizon|t-mobile|sprint|phone\s*bill|utility|"
        # Indian utilities
        r"adani|tata\s*power|bescom|bses|cesc|msedcl|tneb|"
        r"jio|airtel|vodafone|vi\s*prepaid|bsnl|"
        r"gas\s*cylinder|lpg|indane|bharat\s*gas|hp\s*gas|"
        r"water\s*board|dth|dish\s*tv|tata\s*sky|d2h|sun\s*direct|"
        r"recharge|prepaid|postpaid|"
        # Subscriptions
        r"subscription|membership|monthly\s*fee|annual\s*fee|recurring|"
        r"aws|cloud\s*bill|hosting|digital\s*ocean|heroku|"
        r"apple\s*media|apple\s*service|icloud|google\s*storage|autopay",
        re.I),
     TransactionCategory.UTILITIES, 0.88),

    # ── Food / Groceries ────────────────────────────────────────────
    (re.compile(
        r"whole\s*foods|trader\s*joe|walmart\s*grocery|kroger|safeway|aldi|costco|publix|"
        r"grocery|supermarket|farmers?\s*market|"
        # Indian grocery & food delivery
        r"swiggy|zomato|zepto|blinkit|bigbasket|dunzo|jiomart|"
        r"dmart|more\s*supermarket|reliance\s*fresh|nature.?s\s*basket|"
        r"grofers|country\s*delight|milk\s*basket|licious|"
        # Indian restaurant/food keywords
        r"restaurant|bakery|chicken|biryani|hotel|mess|dhaba|canteen|"
        r"cafe|coffee|sweet|meat|fish|mutton|egg|paneer|pizza|"
        r"domino|kfc|burger|mcdonald|subway|"
        r"spicy|kitchen|foods|eatery|juice|chaiwala|tea\s*stall|"
        r"starbucks|chipotle|wendy|taco\s*bell|doordash|uber\s*eats|grubhub|"
        r"dine|dining|brunch|lunch|dinner|breakfast",
        re.I),
     TransactionCategory.FOOD, 0.88),

    # ── Transportation ───────────────────────────────────────────────
    (re.compile(
        r"uber(?!\s*eats)|lyft|taxi|cab\s*fare|gas\s*station|shell\s*gas|chevron|bp\s*gas|exxon|"
        r"parking|toll|metro\s*card|transit|bus\s*pass|train|amtrak|"
        r"airline|flight|delta|united|southwest|american\s*air|"
        # Indian transport
        r"ola|rapido|porter|redbus|makemytrip|ixigo|goibibo|cleartrip|"
        r"irctc|indian\s*railway|railwayuts|bdpg2\.ir|"
        r"petrol|diesel|filling\s*station|fuel|hp\s*petrol|bharat\s*petroleum|iocl|"
        r"metro|bmtc|ksrtc|apsrtc|tsrtc|upsrtc|rsrtc|msrtc|"
        r"fastag|nhai|auto\s*rickshaw|"
        r"indigo|spicejet|air\s*india|vistara|akasa|go\s*first",
        re.I),
     TransactionCategory.TRANSPORTATION, 0.87),

    # ── Healthcare ───────────────────────────────────────────────────
    (re.compile(
        r"doctor|hospital|clinic|pharmacy|cvs|walgreens|medical|dental|"
        r"optometrist|health\s*insurance|copay|prescription|lab\s*work|"
        # Indian healthcare
        r"apollo|medplus|pharmeasy|1mg|netmeds|tata\s*health|"
        r"practo|cult\.fit|healthian|thyrocare|lal\s*path|"
        r"fortis|max\s*hospital|aiims|manipal|narayana|"
        r"diagnostic|pathlab|blood\s*test|scan|xray|mri",
        re.I),
     TransactionCategory.HEALTHCARE, 0.88),

    # ── Entertainment ────────────────────────────────────────────────
    (re.compile(
        r"netflix|hulu|disney\+?|spotify|apple\s*music|youtube\s*premium|"
        r"hbo|amazon\s*prime|movie|theater|concert|gaming|"
        r"steam|playstation|xbox|nintendo|twitch|cinema|"
        # Indian entertainment
        r"hotstar|jio\s*cinema|zee5|sonyliv|mxplayer|"
        r"inox|pvr|bookmyshow|paytm\s*insider|"
        r"dream11|mpl|winzo",
        re.I),
     TransactionCategory.ENTERTAINMENT, 0.90),

    # ── Shopping ─────────────────────────────────────────────────────
    (re.compile(
        r"amazon(?!\s*prime)|ebay|target|walmart(?!\s*grocery)|best\s*buy|"
        r"ikea|home\s*depot|lowe|zara|h&m|nike|adidas|"
        r"clothing|apparel|online\s*shopping|retail|"
        # Indian shopping
        r"flipkart|myntra|meesho|ajio|nykaa|purplle|"
        r"croma|reliance\s*digital|vijay\s*sales|"
        r"snapdeal|shopclues|tatacliq|firstcry|"
        r"pepperfry|urban\s*ladder|fabindia",
        re.I),
     TransactionCategory.SHOPPING, 0.85),

    # ── Education ────────────────────────────────────────────────────
    (re.compile(
        r"tuition|university|college|school|course|udemy|coursera|"
        r"textbook|student\s*loan|education|training|workshop|bootcamp|"
        # Indian education
        r"byju|unacademy|vedantu|physics\s*wallah|toppr|"
        r"upgrad|simplilearn|great\s*learning|scaler|"
        r"exam\s*fee|board\s*fee|semester|coaching",
        re.I),
     TransactionCategory.EDUCATION, 0.88),

    # ── Debt Payments ────────────────────────────────────────────────
    (re.compile(
        r"loan\s*payment|credit\s*card\s*payment|debt|installment|payoff|balance\s*transfer|"
        # Indian EMI & loans
        r"\bemi\b|bajaj\s*finserv|hdfc\s*loan|sbi\s*loan|icici\s*loan|"
        r"home\s*loan|car\s*loan|personal\s*loan|gold\s*loan|"
        r"muthoot|manappuram|shriram|iifl",
        re.I),
     TransactionCategory.DEBT_PAYMENT, 0.88),

    # ── Savings / Investment ─────────────────────────────────────────
    (re.compile(
        r"savings?\s*deposit|401k|ira|roth|investment|stock|etf|mutual\s*fund|"
        r"brokerage|robinhood|vanguard|fidelity|schwab|dividend|"
        # Indian investments
        r"zerodha|groww|upstox|angel\s*one|paytm\s*money|"
        r"sip|ppf|nps|nsc|fd\s*deposit|fixed\s*deposit|"
        r"kuvera|coin|smallcase",
        re.I),
     TransactionCategory.INVESTMENT, 0.87),

    # ── Income ───────────────────────────────────────────────────────
    (re.compile(r"salary|payroll|paycheck|direct\s*deposit|wage", re.I),
     TransactionCategory.INCOME_SALARY, 0.92),

    (re.compile(r"freelance|contract|gig|side\s*hustle|fiverr|upwork|consulting\s*fee", re.I),
     TransactionCategory.INCOME_FREELANCE, 0.88),

    (re.compile(r"refund|cashback|rebate|reimbursement|bonus|gift|reward|interest\s*earned", re.I),
     TransactionCategory.INCOME_OTHER, 0.82),

    # ── Cash Deposits ────────────────────────────────────────────────
    (re.compile(r"cash\s*deposit|cdm\s*deposit|atm\s*deposit|neft|imps|rtgs|wire\s*transfer", re.I),
     TransactionCategory.INCOME_OTHER, 0.85),

    # ── Transfer ─────────────────────────────────────────────────────
    (re.compile(r"transfer|zelle|venmo|paypal|wire|ach", re.I),
     TransactionCategory.TRANSFER, 0.80),
]


def _extract_upi_merchant(description: str) -> str:
    """
    Extract the core merchant name from Indian UPI descriptions.

    UPI descriptions typically follow:
      "UPI-MERCHANT NAME-MERCHANTID@BANK-IFSC-REF-REMARKS"
    This extracts "MERCHANT NAME" for better keyword matching.
    """
    desc = description.strip()
    # Pattern: UPI-MERCHANTNAME-...
    m = re.match(r"^UPI[-\s]+(.+?)(?:[-\s]+\w+@\w+|[-\s]+\d{10,}|$)", desc, re.I)
    if m:
        merchant = m.group(1).strip()
        # Remove trailing alphanumeric IDs
        merchant = re.sub(r"[-\s]+\w+@\w+.*$", "", merchant).strip()
        return merchant
    return desc


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

    # First pass — try matching against the full description
    for pattern, category, confidence in _CATEGORY_RULES:
        match = pattern.search(description_clean)
        if match:
            return CategorizationResult(
                original_description=description_clean,
                assigned_category=category.value,
                confidence=confidence,
                matched_keyword=match.group(0),
            )

    # Second pass — extract the UPI merchant name and try again
    merchant_name = _extract_upi_merchant(description_clean)
    if merchant_name != description_clean:
        for pattern, category, confidence in _CATEGORY_RULES:
            match = pattern.search(merchant_name)
            if match:
                return CategorizationResult(
                    original_description=description_clean,
                    assigned_category=category.value,
                    confidence=round(confidence * 0.95, 2),  # slightly lower confidence
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
