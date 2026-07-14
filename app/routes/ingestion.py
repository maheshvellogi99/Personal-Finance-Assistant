"""
Financial data ingestion routes — Staging Pipeline with Human-in-the-Loop.

Architecture
────────────
Upload endpoints **stage** parsed transactions (no DB writes) and return
them enriched with AI categorization metadata.  The user reviews/edits
the staged items in the frontend, then submits them to the
``confirm-ingestion`` endpoint for a single atomic batch-commit.

Endpoints
─────────
POST /data/upload-statement     Parse CSV/PDF → return staged transactions
POST /data/upload-screenshot    AI Vision extraction → return staged transactions
POST /data/confirm-ingestion    Atomic batch-commit of reviewed transactions
POST /data/sandbox-connect      Simulated Open Banking aggregator (auto-inserts)

Security
────────
• All transactions are linked to the authenticated user's ID at commit time
• user_id is NEVER accepted from the client — it is always derived from JWT
• File size limits enforced at the application layer
• No user-supplied file paths — files read from UploadFile streams
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import (
    AccountType,
    BankAccount,
    Transaction,
    TransactionCategory,
    TransactionType,
    User,
)
from app.routes.auth import get_current_user
from app.schemas.schemas import (
    ConfirmIngestionRequest,
    ConfirmIngestionResponse,
    IngestionTransactionItem,
    SandboxConnectRequest,
    SandboxConnectResponse,
    ScreenshotScanResponse,
    StagedTransactionItem,
    StatementUploadResponse,
)
from app.services.categorization import categorize
from app.services.statement_parser import (
    MAX_FILE_SIZE_BYTES,
    PDFPasswordError,
    ParsedTransaction,
    parse_statement,
)
from app.services.vision_scanner import (
    MAX_IMAGE_SIZE_BYTES,
    ExtractedTransaction,
    scan_screenshot,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data", tags=["Data Ingestion"])


# ═══════════════════════════════════════════════════════════════════════════
#  Shared helpers
# ═══════════════════════════════════════════════════════════════════════════
def _resolve_transaction_type(type_str: str) -> TransactionType:
    """Map string type to the TransactionType enum."""
    mapping = {
        "income": TransactionType.INCOME,
        "expense": TransactionType.EXPENSE,
        "transfer": TransactionType.TRANSFER,
    }
    return mapping.get(type_str.lower(), TransactionType.EXPENSE)


def _resolve_category(category_str: str) -> TransactionCategory:
    """Map the categorization engine output to the DB enum, with fallback."""
    try:
        return TransactionCategory(category_str.lower())
    except ValueError:
        return TransactionCategory.OTHER


def _stage_transactions(
    parsed_transactions: list[ParsedTransaction | ExtractedTransaction],
) -> list[StagedTransactionItem]:
    """
    Run each parsed/extracted transaction through the Module 3 categorization
    engine and return enriched ``StagedTransactionItem`` objects.

    **No database writes happen here** — this is purely a staging step.
    """
    staged_items: list[StagedTransactionItem] = []

    for txn in parsed_transactions:
        # ── Run through Module 3 categorization engine ────────────
        cat_result = categorize(
            description=txn.description,
            amount=txn.amount,
        )

        staged_items.append(
            StagedTransactionItem(
                transaction_date=txn.transaction_date,
                description=txn.description,
                amount=txn.amount,
                transaction_type=txn.transaction_type,
                category=cat_result.assigned_category,
                merchant_name=getattr(txn, "merchant_name", None),
                currency=getattr(txn, "currency", "USD"),
                ai_category_suggestion=cat_result.assigned_category,
                ai_confidence_score=cat_result.confidence,
            )
        )

    return staged_items


# ═══════════════════════════════════════════════════════════════════════════
#  POST /data/upload-statement  (STAGING ONLY — no DB writes)
# ═══════════════════════════════════════════════════════════════════════════
@router.post(
    "/upload-statement",
    response_model=StatementUploadResponse,
    summary="Upload a bank statement (CSV/PDF) — returns staged transactions for review",
)
async def upload_statement(
    file: UploadFile = File(..., description="Bank statement file (CSV, TSV, TXT, or PDF)"),
    password: str | None = Form(
        None, description="Optional password for encrypted PDF statements"
    ),
    current_user: User = Depends(get_current_user),
):
    """
    Parse a bank statement file and return **staged** transactions enriched
    with AI categorization metadata for frontend review.

    **No records are inserted into the database.**  The user must review
    the staged items and submit them via ``POST /data/confirm-ingestion``.

    **Supported formats:**
    - CSV / TSV / TXT — Auto-detects HDFC, generic, and common bank layouts
    - PDF — Table extraction via pdfplumber + regex fallback

    **Encrypted PDFs:**
    If the PDF is password-protected, pass the password via the ``password``
    form field.  Returns 401 with ``detail: "PDF_PASSWORD_REQUIRED"`` if the
    password is missing or incorrect.
    """
    # ── Validate file ────────────────────────────────────────────────
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    content = await file.read()

    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(content) / 1024 / 1024:.1f} MB). Maximum: 10 MB.",
        )

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    # ── Parse (with optional password for encrypted PDFs) ────────────
    try:
        result = parse_statement(content, file.filename, password=password)
    except PDFPasswordError:
        raise HTTPException(
            status_code=401,
            detail="PDF_PASSWORD_REQUIRED",
        )
    except Exception as e:
        # Belt-and-suspenders: catch any pdfminer exception that wasn't
        # wrapped by our parser (varies across pdfplumber/pdfminer versions)
        err_name = type(e).__name__
        err_str = str(e).lower()
        if any(kw in err_name for kw in (
            "PDFPasswordIncorrect", "PDFEncryptionError",
            "PdfminerException", "PDFSyntaxError",
        )) or any(kw in err_str for kw in (
            "password", "encrypted", "not been decrypted",
        )):
            raise HTTPException(
                status_code=401,
                detail="PDF_PASSWORD_REQUIRED",
            )
        raise  # Re-raise unexpected errors

    if result.errors and not result.transactions:
        return StatementUploadResponse(
            status="error",
            message="Failed to parse the statement.",
            source_format=result.source_format,
            total_parsed=0,
            skipped_rows=result.skipped_rows,
            errors=result.errors,
        )

    # ── Stage (NO database insert) ───────────────────────────────────
    staged_items = _stage_transactions(result.transactions)

    status_str = "success" if not result.errors else "partial"
    msg = (
        f"Parsed {result.total_parsed} transactions from "
        f"{result.source_format.upper()} file. "
        f"Review below and confirm to save."
    )
    if result.skipped_rows > 0:
        msg += f" {result.skipped_rows} rows skipped."

    return StatementUploadResponse(
        status=status_str,
        message=msg,
        source_format=result.source_format,
        total_parsed=result.total_parsed,
        skipped_rows=result.skipped_rows,
        transactions=staged_items,
        errors=result.errors,
    )


# ═══════════════════════════════════════════════════════════════════════════
#  POST /data/upload-screenshot  (STAGING ONLY — no DB writes)
# ═══════════════════════════════════════════════════════════════════════════
@router.post(
    "/upload-screenshot",
    response_model=ScreenshotScanResponse,
    summary="Upload a transaction screenshot for AI Vision extraction — returns staged transactions",
)
async def upload_screenshot(
    file: UploadFile = File(
        ...,
        description="Screenshot of a UPI app, bank app, or digital receipt (JPEG/PNG/WebP)",
    ),
    current_user: User = Depends(get_current_user),
):
    """
    Send a screenshot to Gemini 2.5 Flash Vision to extract transaction data.
    Returns **staged** transactions enriched with AI metadata for review.

    **No records are inserted into the database.**  The user must review
    the staged items and submit them via ``POST /data/confirm-ingestion``.

    **Supported sources:**
    - UPI apps: PhonePe, Google Pay, Paytm, BHIM
    - Bank app transaction screens
    - Digital payment receipts

    **Requires:** ``GEMINI_API_KEY`` in environment configuration.
    """
    # ── Validate file ────────────────────────────────────────────────
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    content = await file.read()

    if len(content) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large ({len(content) / 1024 / 1024:.1f} MB). Maximum: 5 MB.",
        )

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    content_type = file.content_type or "image/jpeg"

    # ── Scan with Gemini Vision ──────────────────────────────────────
    scan_result = await scan_screenshot(
        image_bytes=content,
        content_type=content_type,
    )

    if scan_result.errors and not scan_result.transactions:
        return ScreenshotScanResponse(
            status="error",
            message="Failed to extract transactions from screenshot.",
            total_extracted=0,
            errors=scan_result.errors,
        )

    # ── Stage (NO database insert) ───────────────────────────────────
    staged_items = _stage_transactions(scan_result.transactions)

    status_str = "success" if not scan_result.errors else "partial"
    msg = (
        f"Extracted {scan_result.total_extracted} transactions from screenshot. "
        f"Review below and confirm to save."
    )

    return ScreenshotScanResponse(
        status=status_str,
        message=msg,
        total_extracted=scan_result.total_extracted,
        transactions=staged_items,
        errors=scan_result.errors,
    )


# ═══════════════════════════════════════════════════════════════════════════
#  POST /data/confirm-ingestion  (Atomic batch-commit)
# ═══════════════════════════════════════════════════════════════════════════
@router.post(
    "/confirm-ingestion",
    response_model=ConfirmIngestionResponse,
    summary="Batch-commit reviewed transactions to the database",
)
async def confirm_ingestion(
    body: ConfirmIngestionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Receive the user-reviewed (and optionally edited) array of staged
    transactions and batch-commit them to the ``Transaction`` table in a
    **single atomic transaction**.

    **Security:** ``user_id`` is strictly derived from the JWT token —
    it is never accepted from the request body.  Every row is bound to
    ``current_user.id`` regardless of what the client sends.
    """
    committed_items: list[IngestionTransactionItem] = []

    try:
        for staged in body.transactions:
            db_type = _resolve_transaction_type(staged.transaction_type)
            db_category = _resolve_category(staged.category)

            db_txn = Transaction(
                user_id=current_user.id,  # STRICTLY from JWT — never from client
                transaction_type=db_type,
                category=db_category,
                amount=staged.amount,
                currency=staged.currency,
                description=staged.description[:500] if staged.description else None,
                merchant_name=(
                    staged.merchant_name[:255]
                    if staged.merchant_name
                    else None
                ),
                transaction_date=staged.transaction_date,
                ai_category_suggestion=staged.ai_category_suggestion,
                ai_confidence_score=staged.ai_confidence_score,
            )
            db.add(db_txn)

            committed_items.append(
                IngestionTransactionItem(
                    transaction_date=staged.transaction_date,
                    description=staged.description,
                    amount=staged.amount,
                    transaction_type=staged.transaction_type,
                    category=staged.category,
                    merchant_name=staged.merchant_name,
                    currency=staged.currency,
                )
            )

        # ── Single atomic commit ─────────────────────────────────────
        await db.commit()

        count = len(committed_items)
        logger.info(
            f"Batch-committed {count} transactions for user {current_user.id}"
        )

        return ConfirmIngestionResponse(
            status="success",
            message=f"Successfully committed {count} transaction(s) to the database.",
            total_confirmed=count,
            transactions=committed_items,
        )

    except Exception as e:
        await db.rollback()
        logger.error(f"Batch-commit failed for user {current_user.id}: {e}", exc_info=True)
        return ConfirmIngestionResponse(
            status="error",
            message=f"Failed to commit transactions: {str(e)}",
            total_confirmed=0,
        )


# ═══════════════════════════════════════════════════════════════════════════
#  POST /data/sandbox-connect  (unchanged — auto-inserts for dev convenience)
# ═══════════════════════════════════════════════════════════════════════════
# Sandbox transaction templates for realistic test data
_SANDBOX_TRANSACTIONS: list[dict] = [
    {"date": "2026-06-01", "desc": "Salary Direct Deposit - ACME Corp", "amount": 5200.00, "type": "income"},
    {"date": "2026-06-02", "desc": "Rent Payment - Apartment Complex", "amount": 1200.00, "type": "expense"},
    {"date": "2026-06-03", "desc": "Whole Foods Market", "amount": 87.45, "type": "expense"},
    {"date": "2026-06-04", "desc": "Netflix Subscription", "amount": 15.99, "type": "expense"},
    {"date": "2026-06-05", "desc": "Uber Ride", "amount": 24.50, "type": "expense"},
    {"date": "2026-06-06", "desc": "Starbucks Coffee", "amount": 6.75, "type": "expense"},
    {"date": "2026-06-07", "desc": "AT&T Internet Bill", "amount": 59.99, "type": "expense"},
    {"date": "2026-06-08", "desc": "Amazon Purchase - Electronics", "amount": 149.99, "type": "expense"},
    {"date": "2026-06-09", "desc": "Gym Membership - FitLife", "amount": 29.99, "type": "expense"},
    {"date": "2026-06-10", "desc": "Freelance Payment - Design Project", "amount": 750.00, "type": "income"},
    {"date": "2026-06-11", "desc": "Chipotle Mexican Grill", "amount": 12.85, "type": "expense"},
    {"date": "2026-06-12", "desc": "Shell Gas Station", "amount": 45.00, "type": "expense"},
    {"date": "2026-06-13", "desc": "Spotify Premium", "amount": 9.99, "type": "expense"},
    {"date": "2026-06-14", "desc": "CVS Pharmacy - Prescription", "amount": 18.50, "type": "expense"},
    {"date": "2026-06-15", "desc": "Zelle Transfer to Savings", "amount": 500.00, "type": "transfer"},
    {"date": "2026-06-16", "desc": "DoorDash Delivery", "amount": 32.45, "type": "expense"},
    {"date": "2026-06-17", "desc": "AWS Cloud Services", "amount": 89.20, "type": "expense"},
    {"date": "2026-06-18", "desc": "Target - Home Supplies", "amount": 67.30, "type": "expense"},
    {"date": "2026-06-19", "desc": "Student Loan Payment", "amount": 350.00, "type": "expense"},
    {"date": "2026-06-20", "desc": "Interest Earned - Savings Account", "amount": 12.50, "type": "income"},
]


async def _insert_transactions_direct(
    db: AsyncSession,
    user_id: uuid.UUID,
    parsed_transactions: list[ParsedTransaction | ExtractedTransaction],
) -> tuple[list[IngestionTransactionItem], int]:
    """
    Direct-insert helper used ONLY by sandbox-connect.
    Categorizes and inserts a list of parsed transactions into the DB.
    Returns (response_items, insert_count).
    """
    response_items: list[IngestionTransactionItem] = []
    inserted = 0

    for txn in parsed_transactions:
        cat_result = categorize(
            description=txn.description,
            amount=txn.amount,
        )

        db_category = _resolve_category(cat_result.assigned_category)
        db_type = _resolve_transaction_type(txn.transaction_type)

        db_txn = Transaction(
            user_id=user_id,
            transaction_type=db_type,
            category=db_category,
            amount=txn.amount,
            currency=getattr(txn, "currency", "USD"),
            description=txn.description[:500] if txn.description else None,
            merchant_name=(
                txn.merchant_name[:255]
                if getattr(txn, "merchant_name", None)
                else None
            ),
            transaction_date=txn.transaction_date,
            ai_category_suggestion=cat_result.assigned_category,
            ai_confidence_score=cat_result.confidence,
        )
        db.add(db_txn)
        inserted += 1

        response_items.append(
            IngestionTransactionItem(
                transaction_date=txn.transaction_date,
                description=txn.description,
                amount=txn.amount,
                transaction_type=txn.transaction_type,
                category=cat_result.assigned_category,
                merchant_name=getattr(txn, "merchant_name", None),
                currency=getattr(txn, "currency", "USD"),
            )
        )

    if inserted > 0:
        await db.commit()
        logger.info(f"Inserted {inserted} transactions for user {user_id}")

    return response_items, inserted


@router.post(
    "/sandbox-connect",
    response_model=SandboxConnectResponse,
    summary="Simulate an Open Banking / Account Aggregator connection (sandbox)",
)
async def sandbox_connect(
    body: SandboxConnectRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Simulate a standard Open Banking / Account Aggregator token-exchange
    handshake (e.g., Setu, Plaid, Yodlee sandbox workflow).

    **What this does:**
    1. Simulates consent verification with the aggregator provider
    2. Creates a sandbox bank account linked to the user
    3. Generates 20 realistic test transactions for the past month
    4. Auto-categorizes all transactions via Module 3

    This is for **testing and development only**.
    """
    try:
        # ── Step 1: Simulate consent verification ────────────────────
        provider = body.provider.lower()
        supported_providers = {"setu", "plaid", "yodlee", "finvu", "onemoney"}

        if provider not in supported_providers:
            return SandboxConnectResponse(
                status="error",
                message=(
                    f"Unsupported provider '{body.provider}'. "
                    f"Supported sandbox providers: {', '.join(sorted(supported_providers))}"
                ),
                provider=body.provider,
            )

        # ── Step 2: Create sandbox bank account ──────────────────────
        try:
            acct_type = AccountType(body.account_type.lower())
        except ValueError:
            acct_type = AccountType.CHECKING

        sandbox_account = BankAccount(
            user_id=current_user.id,
            account_name=f"{body.institution_name} - Sandbox",
            account_type=acct_type,
            institution_name=body.institution_name,
            account_number_last4="0000",
            balance=8500.00,
            currency=current_user.currency_preference or "USD",
            is_active=True,
        )
        db.add(sandbox_account)
        await db.flush()  # Get the account ID

        # ── Step 3: Generate sandbox transactions ────────────────────
        sandbox_parsed: list[ParsedTransaction] = []
        for txn_data in _SANDBOX_TRANSACTIONS:
            txn_date = datetime.strptime(txn_data["date"], "%Y-%m-%d").date()
            sandbox_parsed.append(
                ParsedTransaction(
                    transaction_date=txn_date,
                    description=txn_data["desc"],
                    amount=txn_data["amount"],
                    transaction_type=txn_data["type"],
                    merchant_name=txn_data["desc"].split(" - ")[0] if " - " in txn_data["desc"] else txn_data["desc"],
                    currency=current_user.currency_preference or "USD",
                )
            )

        # ── Step 4: Categorize and insert ────────────────────────────
        response_items, inserted = await _insert_transactions_direct(
            db=db,
            user_id=current_user.id,
            parsed_transactions=sandbox_parsed,
        )

        return SandboxConnectResponse(
            status="connected",
            message=(
                f"Successfully connected to {body.institution_name} via {body.provider.title()} sandbox. "
                f"Linked account created with {inserted} transactions."
            ),
            provider=body.provider,
            linked_account_id=sandbox_account.id,
            sandbox_data={
                "provider": provider,
                "consent_id": body.consent_id,
                "account_name": sandbox_account.account_name,
                "account_type": acct_type.value,
                "balance": 8500.00,
                "transactions_imported": inserted,
                "note": "This is sandbox/test data. Replace with real aggregator integration for production.",
            },
        )

    except Exception as e:
        logger.error(f"Sandbox connect failed: {e}", exc_info=True)
        await db.rollback()
        return SandboxConnectResponse(
            status="error",
            message=f"Sandbox connection failed: {str(e)}",
            provider=body.provider,
        )
