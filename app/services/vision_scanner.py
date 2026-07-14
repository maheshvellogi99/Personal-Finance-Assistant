"""
AI Vision screenshot scanner for transaction extraction.

Uses Google Gemini 1.5 Flash Vision to extract transaction data from
screenshots of UPI apps (PhonePe, GPay, Paytm), bank app snippets,
or digital receipts.

Security
────────
• Image bytes are sent directly to the Gemini API — never written to disk
• Extracted data is validated and sanitised before DB insertion
• All transactions are linked to the authenticated user

Free Tier Usage
───────────────
• Gemini 1.5 Flash Vision: 15 RPM / 1M tokens per day (FREE)
• Each image scan uses ~500-2000 tokens
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────
MAX_IMAGE_SIZE_MB = 5
MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}


@dataclass
class ExtractedTransaction:
    """A single transaction extracted from a screenshot."""

    transaction_date: date
    description: str
    amount: float
    transaction_type: str  # "income" | "expense" | "transfer"
    merchant_name: str | None = None
    currency: str = "INR"
    transaction_id: str | None = None


@dataclass
class VisionScanResult:
    """Result of scanning a screenshot."""

    transactions: list[ExtractedTransaction] = field(default_factory=list)
    total_extracted: int = 0
    raw_llm_response: str | None = None
    errors: list[str] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════════
#  Gemini Vision Extraction Prompt — Universal Bank/Wallet Agnostic
# ═══════════════════════════════════════════════════════════════════════════
EXTRACTION_PROMPT = """You are an expert financial data extraction engine. Extract ALL transactions from the screenshot. Auto-detect the layout:

═══════════════════════════════════
LAYOUT A — Single Receipt / UPI
═══════════════════════════════════
A single payment confirmation (PhonePe, GPay, Paytm, BHIM, bank app). Extract the one visible transaction.

═══════════════════════════════════
LAYOUT B — Tabular Bank Statement
═══════════════════════════════════
A bank statement grid (HDFC, SBI, ICICI, Axis, Kotak, Chase, etc.) with columns like Date | Narration | Withdrawal | Deposit | Balance. Extract EVERY data row. Ignore headers, totals, opening/closing balance rows.

⚠️ CRITICAL — COLUMN POSITION PRIORITY (highest-confidence signal):
When the table has SEPARATE columns for outflows and inflows:
  • The column header determines the type, NOT the amount value.
  • If the amount appears under a column titled Withdrawal/Debit/DR/Money Out → type = "expense"
  • If the amount appears under a column titled Deposit/Credit/CR/Money In → type = "income"
  • NEVER classify a Deposit-column amount as an expense. This is the #1 misclassification to avoid.
  • An empty cell or "-" or "0.00" means no value for that direction — look at the OTHER column.

═══════════════════════════════════
LAYOUT C — Vertical History Feed
═══════════════════════════════════
A scrollable list of past transactions (PhonePe History, GPay Activity, Paytm Passbook, bank app feed). Each card/row shows one transaction stacked vertically. Extract ALL visible transactions — do NOT stop at the first one. Each card typically shows: name/merchant, amount, and a directional label.

═══════════════════════════════════
LAYOUT D — Mixed / Other
═══════════════════════════════════
Any financial screenshot not matching the above — invoices, receipts, email confirmations. Extract whatever transactions are identifiable.

═══════════════════════════════════════════════
HOW TO DETERMINE transaction_type — CONTEXTUAL NLP MARKERS:
═══════════════════════════════════════════════

INCOME markers (set type = "income"):
  Text cues: "Received", "Credited", "CR", "Deposit", "Deposited", "Refund", "Cashback", "Received from", "Money In", "Inflow"
  Visual cues: GREEN colored text/icon, green ↓ arrow, "+" prefix on amount
  Column position: Amount in the Deposit / Credit / CR / Money In column

EXPENSE markers (set type = "expense"):
  Text cues: "Paid", "Sent", "Debited", "DR", "Withdrawal", "Withdrawn", "Paid to", "Money Out", "Outflow", "Charged"
  Visual cues: RED colored text/icon, red ↑ arrow, "−" or "-" prefix on amount
  Column position: Amount in the Withdrawal / Debit / DR / Money Out column

TRANSFER markers (set type = "transfer"):
  Text cues: "Transfer to own", "Self Transfer", "Internal Transfer", "Between Accounts"
  Visual cues: BLUE colored text, bidirectional arrows

PRIORITY ORDER: Column position > Text cues > Visual cues > Default.
If none of the above markers are present, default to "expense".

═══════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════
Return ONLY a valid JSON array (no markdown fences, no explanation):
[
  {
    "date": "YYYY-MM-DD",
    "description": "Merchant/receiver name or narration text",
    "amount": 123.45,
    "type": "expense" or "income" or "transfer",
    "merchant_name": "Merchant/payee name",
    "currency": "INR" or "USD" or appropriate code,
    "transaction_id": "UPI/Bank ref ID if visible, otherwise null"
  }
]

CRITICAL RULES:
1. Return ONLY the JSON array — no markdown, no backticks, no commentary.
2. If the date is not visible, use today's date.
3. Determine type using the PRIORITY ORDER above — column position is the strongest signal.
4. Strip commas and currency symbols from amounts; keep decimals.
5. If no transactions can be identified, return: []
6. For vertical history feeds: extract EVERY visible transaction card/row.
7. For tabular statements: extract ALL data rows. Skip header/footer/total rows.
8. For split Withdrawal/Deposit columns: non-empty Withdrawal = expense, non-empty Deposit = income. NEVER reverse this.
9. If a single Amount column has DR/CR suffixes, parse them using the text markers above.
10. Amounts are always positive in the output — the type field encodes direction.
"""


# ═══════════════════════════════════════════════════════════════════════════
#  Date Parsing Helpers
# ═══════════════════════════════════════════════════════════════════════════
_DATE_FORMATS = [
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%m/%d/%Y",
    "%d %b %Y",
    "%d %B %Y",
    "%b %d, %Y",
]


def _parse_date(date_str: str) -> date:
    """Parse a date string, falling back to today on failure."""
    if not date_str:
        return date.today()
    cleaned = date_str.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return date.today()


# ═══════════════════════════════════════════════════════════════════════════
#  JSON Response Sanitiser
# ═══════════════════════════════════════════════════════════════════════════
def _extract_json_from_response(raw_text: str) -> list[dict] | None:
    """
    Extract a JSON array from the LLM response, handling:
    - Clean JSON responses
    - JSON wrapped in markdown code blocks
    - Extra text before/after the JSON
    """
    text = raw_text.strip()

    # Try direct parse first
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            return [parsed]
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code block
    code_block_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if code_block_match:
        try:
            parsed = json.loads(code_block_match.group(1))
            if isinstance(parsed, list):
                return parsed
            if isinstance(parsed, dict):
                return [parsed]
        except json.JSONDecodeError:
            pass

    # Try finding an array in the text
    array_match = re.search(r"\[.*\]", text, re.DOTALL)
    if array_match:
        try:
            parsed = json.loads(array_match.group(0))
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass

    return None


# ═══════════════════════════════════════════════════════════════════════════
#  Gemini Vision Scanner
# ═══════════════════════════════════════════════════════════════════════════
async def scan_screenshot(
    image_bytes: bytes,
    content_type: str = "image/jpeg",
) -> VisionScanResult:
    """
    Send a transaction screenshot to Gemini 1.5 Flash Vision and extract
    structured transaction data.

    Parameters
    ----------
    image_bytes : bytes
        Raw image file content.
    content_type : str
        MIME type of the image.

    Returns
    -------
    VisionScanResult
    """
    result = VisionScanResult()

    # ── Validate API key ─────────────────────────────────────────────
    if not settings.GEMINI_API_KEY:
        result.errors.append(
            "GEMINI_API_KEY is not configured. "
            "Screenshot scanning requires a Gemini API key. "
            "Get one free at https://aistudio.google.com/apikey"
        )
        return result

    # ── Validate image size ──────────────────────────────────────────
    if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
        result.errors.append(
            f"Image file too large ({len(image_bytes) / 1024 / 1024:.1f} MB). "
            f"Maximum allowed: {MAX_IMAGE_SIZE_MB} MB."
        )
        return result

    # ── Validate MIME type ───────────────────────────────────────────
    if content_type not in ALLOWED_IMAGE_TYPES:
        result.errors.append(
            f"Unsupported image type: {content_type}. "
            f"Allowed: {', '.join(ALLOWED_IMAGE_TYPES)}"
        )
        return result

    # ── Call Gemini Vision ───────────────────────────────────────────
    try:
        import google.generativeai as genai

        genai.configure(api_key=settings.GEMINI_API_KEY)

        model = genai.GenerativeModel(
            model_name="gemini-2.5-flash",
            generation_config=genai.GenerationConfig(
                temperature=0.1,  # Low temp for precise extraction
                max_output_tokens=4096,  # Higher for dense tabular statements
            ),
        )

        # Build the image part
        image_part = {
            "mime_type": content_type,
            "data": image_bytes,
        }

        response = model.generate_content(
            [EXTRACTION_PROMPT, image_part]
        )

        if not response or not response.text:
            result.errors.append("Gemini returned an empty response.")
            return result

        result.raw_llm_response = response.text
        logger.info(f"Gemini Vision response received ({len(response.text)} chars)")

        # ── Parse JSON response ──────────────────────────────────────
        extracted = _extract_json_from_response(response.text)

        if extracted is None:
            result.errors.append(
                "Could not parse transaction data from the image. "
                "The screenshot may not contain recognisable transaction information."
            )
            return result

        if not extracted:
            result.errors.append(
                "No transactions were detected in the screenshot."
            )
            return result

        # ── Validate and convert each transaction ────────────────────
        for item in extracted:
            try:
                txn_date = _parse_date(item.get("date", ""))
                description = str(item.get("description", "")).strip()
                amount = float(item.get("amount", 0))
                txn_type = str(item.get("type", "expense")).lower()
                merchant = str(item.get("merchant_name", "")).strip() or None
                currency = str(item.get("currency", "INR")).strip().upper()
                txn_id = str(item.get("transaction_id", "")).strip() or None

                if not description or amount <= 0:
                    result.errors.append(
                        f"Skipped invalid transaction: {item}"
                    )
                    continue

                if txn_type not in ("income", "expense", "transfer"):
                    txn_type = "expense"

                if len(currency) != 3:
                    currency = "INR"

                result.transactions.append(
                    ExtractedTransaction(
                        transaction_date=txn_date,
                        description=description[:500],
                        amount=round(amount, 2),
                        transaction_type=txn_type,
                        merchant_name=merchant[:255] if merchant else None,
                        currency=currency,
                        transaction_id=txn_id,
                    )
                )

            except Exception as e:
                result.errors.append(f"Error processing extracted item: {e}")
                logger.debug(f"Vision extraction item error: {e}")

        result.total_extracted = len(result.transactions)
        logger.info(f"Vision scan complete: {result.total_extracted} transactions extracted")

    except Exception as e:
        error_msg = f"Vision scanning failed: {type(e).__name__}: {str(e)}"
        result.errors.append(error_msg)
        logger.error(error_msg, exc_info=True)

    return result
