"""
Bank statement file parser.

Parses uploaded financial documents (CSV and PDF) into a normalised list
of transaction dicts ready for DB insertion.

Supported Formats
─────────────────
• **CSV** — Autodetects column mappings from common bank formats:
    - HDFC Bank (Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance)
    - Generic (Date, Description, Amount, Type)
    - Custom header auto-detection via keyword matching

• **PDF** — Extracts text via pdfplumber and attempts tabular extraction.
    Falls back to line-by-line regex parsing for non-tabular PDFs.

Security
────────
• No user-supplied file paths — files are read from UploadFile byte streams
• Strict size limit enforcement (10 MB default)
• All amounts are sanitised (commas stripped, absolute values)
"""

from __future__ import annotations

import csv
import io
import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────
MAX_FILE_SIZE_MB = 10
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
ALLOWED_CSV_EXTENSIONS = {".csv", ".tsv", ".txt"}
ALLOWED_PDF_EXTENSIONS = {".pdf"}


@dataclass
class ParsedTransaction:
    """A single transaction extracted from a statement file."""

    transaction_date: date
    description: str
    amount: float
    transaction_type: str  # "income" | "expense" | "transfer"
    merchant_name: str | None = None
    currency: str = "USD"
    reference: str | None = None


@dataclass
class ParseResult:
    """Result of parsing an entire statement file."""

    transactions: list[ParsedTransaction] = field(default_factory=list)
    source_format: str = "unknown"
    total_parsed: int = 0
    skipped_rows: int = 0
    errors: list[str] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════════
#  Date Parsing
# ═══════════════════════════════════════════════════════════════════════════
_DATE_FORMATS = [
    "%d/%m/%Y",      # 23/06/2026  (HDFC, Indian banks)
    "%d-%m-%Y",      # 23-06-2026
    "%Y-%m-%d",      # 2026-06-23  (ISO)
    "%m/%d/%Y",      # 06/23/2026  (US format)
    "%m-%d-%Y",      # 06-23-2026
    "%d/%m/%y",      # 23/06/26
    "%d-%m-%y",      # 23-06-26
    "%Y/%m/%d",      # 2026/06/23
    "%b %d, %Y",     # Jun 23, 2026
    "%d %b %Y",      # 23 Jun 2026
    "%d %B %Y",      # 23 June 2026
    "%B %d, %Y",     # June 23, 2026
]


def _parse_date(date_str: str) -> date | None:
    """Attempt to parse a date string using multiple common formats."""
    cleaned = date_str.strip()
    if not cleaned:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


# ═══════════════════════════════════════════════════════════════════════════
#  Amount Parsing
# ═══════════════════════════════════════════════════════════════════════════
def _parse_amount(amount_str: str) -> float | None:
    """Parse an amount string, handling commas and currency symbols."""
    if not amount_str:
        return None
    # Remove currency symbols, commas, spaces
    cleaned = re.sub(r"[₹$€£,\s]", "", amount_str.strip())
    # Handle bracketed negatives: (1234.56)
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = "-" + cleaned[1:-1]
    try:
        return float(cleaned)
    except ValueError:
        return None


# ═══════════════════════════════════════════════════════════════════════════
#  Universal Bank-Agnostic Column Header Synonyms
# ═══════════════════════════════════════════════════════════════════════════
# These synonym arrays cover HDFC, SBI, ICICI, Axis, Kotak, PNB, BoB,
# as well as international formats (Chase, Citi, Revolut) and mobile
# wallets (PhonePe, GPay, Paytm history exports).
_HEADER_KEYWORDS = {
    "date": [
        "date", "txn date", "transaction date", "trans date", "trans. date",
        "value date", "value dt", "posting date", "posted date", "entry date",
        "booking date", "settlement date", "effective date",
    ],
    "description": [
        "narration", "description", "details", "particulars", "memo",
        "remarks", "payee", "transaction details", "trans. particular",
        "transaction description", "paid to", "received from", "beneficiary",
        "name", "merchant", "note", "narrative",
    ],
    "withdrawal": [
        # Expense / Outflow synonyms — all banks
        "withdrawal", "withdrawal amt", "withdrawal amt.", "withdrawal amount",
        "debit", "debit amt", "debit amt.", "debit amount", "amount debited",
        "dr", "dr.", "dr amount", "money out", "out", "outflow",
        "spent", "paid", "sent", "expense", "charges",
    ],
    "deposit": [
        # Income / Inflow synonyms — all banks
        "deposit", "deposit amt", "deposit amt.", "deposit amount",
        "credit", "credit amt", "credit amt.", "credit amount", "amount credited",
        "cr", "cr.", "cr amount", "money in", "in", "inflow",
        "received", "income", "refund",
    ],
    "amount": [
        "amount", "transaction amount", "txn amount", "amt", "amt.",
        "total", "value", "sum", "payment amount",
    ],
    "type": [
        "type", "transaction type", "txn type",
        "dr/cr", "cr/dr", "debit/credit", "credit/debit",
        "direction", "flow", "mode",
    ],
    "reference": [
        "reference", "ref", "ref.", "ref no", "ref no.", "reference no",
        "chq./ref.no.", "chq/ref no", "cheque no", "cheque no.",
        "utr", "utr no", "txn id", "transaction id", "trans id",
        "rrn", "arn", "order id",
    ],
    "balance": [
        "balance", "closing balance", "running balance",
        "available balance", "avl bal", "avl. bal.", "bal",
    ],
}

# Consolidated type-resolution synonyms (used in CSV and PDF row parsing)
_INCOME_MARKERS = frozenset({
    "cr", "cr.", "credit", "credited", "income", "deposit", "deposited",
    "received", "refund", "inflow", "in", "money in", "+",
})
_EXPENSE_MARKERS = frozenset({
    "dr", "dr.", "debit", "debited", "expense", "withdrawal", "withdrawn",
    "paid", "sent", "outflow", "out", "money out", "charges", "-",
})
_TRANSFER_MARKERS = frozenset({
    "transfer", "xfer", "self transfer", "own transfer", "internal",
})


def _resolve_type_from_marker(marker: str, fallback_amount: float = 0) -> str:
    """Resolve transaction type from a type column value or contextual marker."""
    cleaned = marker.strip().lower()
    if cleaned in _INCOME_MARKERS:
        return "income"
    if cleaned in _EXPENSE_MARKERS:
        return "expense"
    if cleaned in _TRANSFER_MARKERS:
        return "transfer"
    # Sign-based fallback
    return "expense" if fallback_amount < 0 else "income"


def _detect_column_mapping(headers: list[str]) -> dict[str, int]:
    """
    Map logical field names to column indices by fuzzy-matching headers
    against known bank statement keywords.
    """
    mapping: dict[str, int] = {}
    normalised = [h.strip().lower() for h in headers]

    for field_name, keywords in _HEADER_KEYWORDS.items():
        for keyword in keywords:
            for idx, header in enumerate(normalised):
                if keyword == header or keyword in header:
                    if field_name not in mapping:
                        mapping[field_name] = idx
                    break

    return mapping


# ═══════════════════════════════════════════════════════════════════════════
#  CSV Parser
# ═══════════════════════════════════════════════════════════════════════════
def parse_csv(file_content: bytes, filename: str = "statement.csv") -> ParseResult:
    """
    Parse a CSV bank statement into normalised transactions.

    Supports:
    - HDFC format (Withdrawal/Deposit columns)
    - Generic format (single Amount column + Type column)
    - Single Amount column (negative = expense, positive = income)
    """
    result = ParseResult(source_format="csv")

    try:
        # Decode with fallback encodings
        for encoding in ["utf-8", "utf-8-sig", "latin-1", "cp1252"]:
            try:
                text = file_content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            result.errors.append("Unable to decode file — unsupported encoding.")
            return result

        # Strip BOM and empty leading lines
        lines = text.strip().splitlines()
        # Skip lines that look like bank metadata (not CSV data)
        data_start = 0
        for i, line in enumerate(lines):
            if "," in line and any(kw in line.lower() for kwlist in _HEADER_KEYWORDS.values() for kw in kwlist):
                data_start = i
                break

        if data_start > 0:
            lines = lines[data_start:]

        reader = csv.reader(io.StringIO("\n".join(lines)))
        rows = list(reader)

        if len(rows) < 2:
            result.errors.append("CSV file has fewer than 2 rows (need header + data).")
            return result

        headers = rows[0]
        mapping = _detect_column_mapping(headers)

        if "date" not in mapping:
            result.errors.append(
                f"Could not detect a date column. Headers found: {headers}"
            )
            return result

        if "description" not in mapping:
            result.errors.append(
                f"Could not detect a description/narration column. Headers found: {headers}"
            )
            return result

        # Determine amount strategy
        has_split_amounts = "withdrawal" in mapping and "deposit" in mapping
        has_single_amount = "amount" in mapping
        has_type_column = "type" in mapping

        if not has_split_amounts and not has_single_amount:
            result.errors.append(
                "Could not detect amount column(s). "
                "Need either 'Amount' or 'Withdrawal'+'Deposit' columns."
            )
            return result

        # Parse data rows
        for row_idx, row in enumerate(rows[1:], start=2):
            try:
                if len(row) < max(mapping.values()) + 1:
                    result.skipped_rows += 1
                    continue

                # Date
                date_val = _parse_date(row[mapping["date"]])
                if not date_val:
                    result.skipped_rows += 1
                    continue

                # Description
                desc = row[mapping["description"]].strip()
                if not desc:
                    result.skipped_rows += 1
                    continue

                # Amount + Type
                if has_split_amounts:
                    withdrawal_str = row[mapping["withdrawal"]].strip()
                    deposit_str = row[mapping["deposit"]].strip()

                    withdrawal = _parse_amount(withdrawal_str)
                    deposit = _parse_amount(deposit_str)

                    if withdrawal and withdrawal > 0:
                        amount = abs(withdrawal)
                        txn_type = "expense"
                    elif deposit and deposit > 0:
                        amount = abs(deposit)
                        txn_type = "income"
                    else:
                        result.skipped_rows += 1
                        continue

                elif has_single_amount:
                    amount_val = _parse_amount(row[mapping["amount"]])
                    if amount_val is None or amount_val == 0:
                        result.skipped_rows += 1
                        continue

                    if has_type_column:
                        txn_type = _resolve_type_from_marker(
                            row[mapping["type"]], fallback_amount=amount_val
                        )
                    else:
                        txn_type = "expense" if amount_val < 0 else "income"

                    amount = abs(amount_val)

                # Reference
                reference = None
                if "reference" in mapping:
                    reference = row[mapping["reference"]].strip() or None

                result.transactions.append(
                    ParsedTransaction(
                        transaction_date=date_val,
                        description=desc[:500],
                        amount=round(amount, 2),
                        transaction_type=txn_type,
                        merchant_name=desc[:255],
                        reference=reference,
                    )
                )

            except Exception as e:
                result.skipped_rows += 1
                logger.debug(f"Skipped CSV row {row_idx}: {e}")

        result.total_parsed = len(result.transactions)

        if result.total_parsed == 0:
            result.errors.append(
                "No transactions could be extracted. Check the file format."
            )

        logger.info(
            f"CSV parse complete: {result.total_parsed} transactions, "
            f"{result.skipped_rows} skipped from '{filename}'"
        )

    except Exception as e:
        result.errors.append(f"CSV parsing failed: {str(e)}")
        logger.error(f"CSV parse error: {e}", exc_info=True)

    return result


# ═══════════════════════════════════════════════════════════════════════════
#  PDF Parser
# ═══════════════════════════════════════════════════════════════════════════
def parse_pdf(
    file_content: bytes,
    filename: str = "statement.pdf",
    password: str | None = None,
) -> ParseResult:
    """
    Parse a PDF bank statement into normalised transactions.

    Uses pdfplumber for table extraction. Falls back to regex line parsing
    if tables cannot be detected.

    Parameters
    ----------
    file_content : bytes
        Raw PDF file bytes.
    filename : str
        Original filename (for logging).
    password : str | None
        Optional decryption password for encrypted bank PDFs.

    Raises
    ------
    PDFPasswordError
        If the PDF is encrypted and no password (or wrong password) is given.
    """
    result = ParseResult(source_format="pdf")

    try:
        import pdfplumber
        # Pre-import the exact exception class for direct catching
        try:
            from pdfplumber.utils.exceptions import PdfminerException as _PdfminerExc
        except ImportError:
            _PdfminerExc = None  # Older pdfplumber versions
    except ImportError:
        result.errors.append(
            "PDF parsing requires pdfplumber. Install with: pip install pdfplumber"
        )
        return result

    try:
        open_kwargs: dict = {}
        if password:
            open_kwargs["password"] = password

        with pdfplumber.open(io.BytesIO(file_content), **open_kwargs) as pdf:
            
            # ── 1. Strategy: Universal Table Extraction ──
            # Try to extract tables and map headers dynamically. 
            # Works best for SBI, ICICI, Canara, and clean grid-based PDFs.
            table_txns: list[ParsedTransaction] = []
            table_skipped_rows = 0
            
            all_rows: list[list[str]] = []
            for page in pdf.pages:
                tables = page.extract_tables()
                if tables:
                    for table in tables:
                        for row in table:
                            if row and any(cell for cell in row if cell):
                                all_rows.append([str(cell or "").strip() for cell in row])
                else:
                    text = page.extract_text()
                    if text:
                        for line in text.splitlines():
                            line = line.strip()
                            if not line:
                                continue
                            parts = re.split(r"\s{2,}", line)
                            if len(parts) >= 3:
                                all_rows.append(parts)

            if all_rows:
                header_idx = -1
                for i, row in enumerate(all_rows[:5]):
                    joined = " ".join(row).lower()
                    if any(kw in joined for kwlist in _HEADER_KEYWORDS.values() for kw in kwlist):
                        header_idx = i
                        break
                
                if header_idx >= 0:
                    headers = all_rows[header_idx]
                    mapping = _detect_column_mapping(headers)
                    data_rows = all_rows[header_idx + 1:]
                    
                    if "date" in mapping and ("amount" in mapping or ("withdrawal" in mapping and "deposit" in mapping)):
                        has_split = "withdrawal" in mapping and "deposit" in mapping
                        has_amount = "amount" in mapping
                        
                        for row in data_rows:
                            try:
                                if len(row) <= max(mapping.values(), default=0):
                                    table_skipped_rows += 1
                                    continue
                                
                                date_val = _parse_date(row[mapping["date"]])
                                if not date_val:
                                    table_skipped_rows += 1
                                    continue
                                
                                desc = row[mapping.get("description", 1)].strip() if "description" in mapping else ""
                                if not desc:
                                    desc = "Bank transaction"
                                
                                if has_split:
                                    w = _parse_amount(row[mapping["withdrawal"]])
                                    d = _parse_amount(row[mapping["deposit"]])
                                    if w and w > 0:
                                        amount, txn_type = abs(w), "expense"
                                    elif d and d > 0:
                                        amount, txn_type = abs(d), "income"
                                    else:
                                        table_skipped_rows += 1
                                        continue
                                elif has_amount:
                                    amt = _parse_amount(row[mapping["amount"]])
                                    if amt is None or amt == 0:
                                        table_skipped_rows += 1
                                        continue
                                    amount = abs(amt)
                                    txn_type = "expense" if amt < 0 else "income"
                                
                                table_txns.append(
                                    ParsedTransaction(
                                        transaction_date=date_val,
                                        description=desc[:500],
                                        amount=round(amount, 2),
                                        transaction_type=txn_type,
                                        merchant_name=desc[:255],
                                    )
                                )
                            except Exception:
                                table_skipped_rows += 1


            # ── 2. Strategy: Text-based Extraction (HDFC-optimized) ──
            # HDFC PDFs merge many transactions into single table rows with
            # '\n'-separated cells. extract_text(layout=True) preserves column
            # positions and gives one transaction per date-line.
            text_txns: list[ParsedTransaction] = []
            text_skipped_rows = 0

            _DATE_LINE_RE = re.compile(r"^\s*(\d{2}/\d{2}/\d{2,4})\b")
            _AMOUNT_RE = re.compile(r"[\d,]+\.\d{2}")

            text_lines: list[str] = []
            for page in pdf.pages:
                page_text = page.extract_text(layout=True)
                if page_text:
                    text_lines.extend(page_text.splitlines())

            if not text_lines:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text_lines.extend(page_text.splitlines())

            if text_lines:
                raw_txns: list[dict] = []
                prev_balance: float | None = None

                for line in text_lines:
                    stripped = line.strip()
                    if not stripped:
                        continue

                    date_match = _DATE_LINE_RE.match(stripped)
                    if date_match:
                        date_str = date_match.group(1)
                        amounts = _AMOUNT_RE.findall(stripped)

                        if len(amounts) >= 2:
                            balance = float(amounts[-1].replace(",", ""))
                            txn_amount = float(amounts[-2].replace(",", ""))

                            if prev_balance is not None:
                                expected_after_deposit = round(prev_balance + txn_amount, 2)
                                expected_after_withdrawal = round(prev_balance - txn_amount, 2)

                                if abs(balance - expected_after_deposit) < 0.05:
                                    txn_type = "income"
                                elif abs(balance - expected_after_withdrawal) < 0.05:
                                    txn_type = "expense"
                                else:
                                    txn_type = "income" if balance > prev_balance else "expense"
                            else:
                                txn_type = "expense"

                            prev_balance = balance

                            narration_part = stripped[date_match.end() :].strip()
                            for a in amounts:
                                narration_part = narration_part.replace(a, "", 1)
                            narration_part = re.sub(r"\b\d{16}\b", "", narration_part)
                            narration_part = re.sub(r"\b\d{2}/\d{2}/\d{2,4}\b", "", narration_part)
                            narration_part = re.sub(r"\s{2,}", " ", narration_part).strip()

                            raw_txns.append({
                                "date": date_str,
                                "narration": narration_part,
                                "amount": txn_amount,
                                "type": txn_type,
                                "balance": balance,
                            })
                        else:
                            text_skipped_rows += 1
                    elif raw_txns and not any(kw in stripped.lower() for kw in (
                        "page no", "page:", "statement of", "hdfc bank",
                        "account", "opening balance", "closing balance",
                        "date", "narration", "chq", "value",
                        "closing balance includes", "funds earmarked",
                        "unclearedfunds", "uncleared funds",
                        "contents of this statement", "considered correct",
                        "making-payments", "online-tax-payment",
                        "goods-and-service", "registered office",
                        "hdfcbankgstin", "gstin", "mumbai",
                        "this statement will be", "receipt of statement",
                        "address on this statement", "the address",
                        "number details are available",
                        "requesting", "lowerparel", "lower parel",
                        "senapati bapat marg", "bapat marg",
                    )):
                        prev = raw_txns[-1]
                        # Skip lines that start with '*' — HDFC disclaimer markers
                        if stripped.startswith("*"):
                            continue
                        clean_continuation = re.sub(r"[\d,]+\.\d{2}", "", stripped)
                        clean_continuation = re.sub(r"\b\d{16}\b", "", clean_continuation).strip()
                        # Cap narration length to prevent footer text bloat
                        if clean_continuation and len(clean_continuation) > 1 and len(prev["narration"]) < 300:
                            prev["narration"] = (prev["narration"] + " " + clean_continuation).strip()[:300]

                for txn in raw_txns:
                    try:
                        date_val = _parse_date(txn["date"])
                        if not date_val:
                            text_skipped_rows += 1
                            continue

                        desc = txn["narration"].strip()
                        if not desc:
                            desc = "Bank transaction"

                        text_txns.append(
                            ParsedTransaction(
                                transaction_date=date_val,
                                description=desc[:500],
                                amount=round(txn["amount"], 2),
                                transaction_type=txn["type"],
                                merchant_name=desc[:255],
                            )
                        )
                    except Exception:
                        text_skipped_rows += 1

            # ── 3. Choose the Best Parsing Result ──
            if len(table_txns) >= len(text_txns) and len(table_txns) > 0:
                result.transactions = table_txns
                result.skipped_rows = table_skipped_rows
            elif len(text_txns) > 0:
                result.transactions = text_txns
                result.skipped_rows = text_skipped_rows
            else:
                result.errors.append("No extractable transactions found in the PDF.")
        
        result.total_parsed = len(result.transactions)
        logger.info(
            f"PDF parse complete: {result.total_parsed} transactions, "
            f"{result.skipped_rows} skipped from '{filename}'"
        )

    except Exception as e:
        # ── Direct catch: pdfplumber's PdfminerException wrapper ─────
        if _PdfminerExc is not None and isinstance(e, _PdfminerExc):
            raise PDFPasswordError(
                "This PDF is encrypted. Please provide the correct password."
            ) from e

        # ── Walk the exception chain for all pdfminer error variants ──
        # pdfminer raises various exception classes depending on version:
        #   - pdfminer.pdfdocument.PDFPasswordIncorrect
        #   - pdfminer.pdfdocument.PDFEncryptionError
        #   - pdfminer.pdfparser.PDFSyntaxError (some encrypted files)
        #   - pdfplumber wraps these in its own PdfminerException
        error_chain = [e]
        cause = e.__cause__
        while cause:
            error_chain.append(cause)
            cause = getattr(cause, "__cause__", None)

        for exc in error_chain:
            exc_name = type(exc).__name__
            exc_str = str(exc).lower()
            if any(kw in exc_name for kw in (
                "PDFPasswordIncorrect", "PDFEncryptionError",
                "PdfminerException", "PDFSyntaxError",
            )):
                raise PDFPasswordError(
                    "This PDF is encrypted. Please provide the correct password."
                ) from e
            if any(kw in exc_str for kw in (
                "not been decrypted", "password", "encrypted",
                "encryption", "security handler",
            )):
                raise PDFPasswordError(
                    "This PDF is password-protected. Please provide the password."
                ) from e

        result.errors.append(f"PDF parsing failed: {str(e)}")
        logger.error(f"PDF parse error: {e}", exc_info=True)

    return result


# ═══════════════════════════════════════════════════════════════════════════
#  Custom Exceptions
# ═══════════════════════════════════════════════════════════════════════════
class PDFPasswordError(Exception):
    """Raised when a PDF is encrypted and the password is missing or wrong."""
    pass


# ═══════════════════════════════════════════════════════════════════════════
#  Unified Parser
# ═══════════════════════════════════════════════════════════════════════════
def parse_statement(
    file_content: bytes,
    filename: str,
    password: str | None = None,
) -> ParseResult:
    """
    Route a file to the correct parser based on its extension.

    Parameters
    ----------
    password : str | None
        Decryption password, forwarded to the PDF parser when applicable.

    Raises
    ------
    PDFPasswordError
        Propagated from ``parse_pdf`` if the PDF is encrypted.
    """
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext in ALLOWED_CSV_EXTENSIONS:
        return parse_csv(file_content, filename)
    elif ext in ALLOWED_PDF_EXTENSIONS:
        return parse_pdf(file_content, filename, password=password)
    else:
        return ParseResult(
            errors=[
                f"Unsupported file format '{ext}'. "
                f"Accepted formats: CSV, TSV, TXT, PDF."
            ]
        )
