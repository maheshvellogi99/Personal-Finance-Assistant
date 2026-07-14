"""
Financial Report Generation — PDF & CSV export.

Endpoints
─────────
GET /reports/export?format=pdf   Download a formatted PDF financial report
GET /reports/export?format=csv   Download a CSV of all transactions

The PDF report includes:
- Header with app branding, user name, and generation date
- Net Worth summary (total across all active bank accounts)
- Budget status table (category, limit, spent, remaining, %)
- Recent transactions table (last 100)
- Footer with page numbers

Security
────────
All queries are scoped to the authenticated user via ``get_current_user``.
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import (
    BankAccount,
    Budget,
    Transaction,
    TransactionType,
)
from app.models.models import User
from app.routes.auth import get_current_user

router = APIRouter(prefix="/reports", tags=["Reports"])


# ═══════════════════════════════════════════════════════════════════════════
#  CSV Export
# ═══════════════════════════════════════════════════════════════════════════
async def _generate_csv(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> io.StringIO:
    """Build an in-memory CSV of the user's transactions."""
    result = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == user_id)
        .order_by(Transaction.transaction_date.desc())
    )
    txns = result.scalars().all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)

    # Header row
    writer.writerow([
        "Date", "Description", "Category", "Type", "Amount", "Currency",
    ])

    for t in txns:
        writer.writerow([
            t.transaction_date.isoformat() if t.transaction_date else "",
            t.description or t.merchant_name or "",
            t.category.value if hasattr(t.category, "value") else str(t.category),
            t.transaction_type.value if hasattr(t.transaction_type, "value") else str(t.transaction_type),
            f"{float(t.amount):.2f}",
            t.currency or "USD",
        ])

    buffer.seek(0)
    return buffer


# ═══════════════════════════════════════════════════════════════════════════
#  PDF Export (reportlab)
# ═══════════════════════════════════════════════════════════════════════════
async def _generate_pdf(
    db: AsyncSession,
    user: User,
) -> io.BytesIO:
    """Build an in-memory PDF financial health report."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch, mm
    from reportlab.platypus import (
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )

    styles = getSampleStyleSheet()
    elements: list = []

    # ── Custom styles ────────────────────────────────────────────────
    title_style = ParagraphStyle(
        "ReportTitle",
        parent=styles["Heading1"],
        fontSize=22,
        textColor=colors.HexColor("#232F3E"),
        spaceAfter=6,
    )
    subtitle_style = ParagraphStyle(
        "ReportSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#666666"),
        spaceAfter=20,
    )
    section_style = ParagraphStyle(
        "SectionHeader",
        parent=styles["Heading2"],
        fontSize=14,
        textColor=colors.HexColor("#FF9900"),
        spaceBefore=16,
        spaceAfter=8,
    )

    # ── Header ───────────────────────────────────────────────────────
    elements.append(Paragraph("AWS Personal Finance Assistant", title_style))
    elements.append(Paragraph(
        f"Financial Health Report for <b>{user.full_name}</b> &bull; "
        f"Generated on {datetime.now(timezone.utc).strftime('%B %d, %Y at %H:%M UTC')}",
        subtitle_style,
    ))

    # ── Net Worth Section ────────────────────────────────────────────
    elements.append(Paragraph("Net Worth Summary", section_style))

    accounts_result = await db.execute(
        select(BankAccount).where(
            BankAccount.user_id == user.id,
            BankAccount.is_active == True,
        )
    )
    accounts = accounts_result.scalars().all()
    total_balance = sum(float(a.balance) for a in accounts)

    if accounts:
        acct_data = [["Account Name", "Type", "Balance"]]
        for a in accounts:
            acct_data.append([
                a.account_name,
                a.account_type.value.replace("_", " ").title() if hasattr(a.account_type, "value") else str(a.account_type),
                f"${float(a.balance):,.2f}",
            ])
        acct_data.append(["", "Total Net Worth", f"${total_balance:,.2f}"])

        acct_table = Table(acct_data, colWidths=[200, 150, 120])
        acct_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#232F3E")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 10),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F5F5F5")),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#FAFAFA")]),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        elements.append(acct_table)
    else:
        elements.append(Paragraph("No active bank accounts found.", styles["Normal"]))

    elements.append(Spacer(1, 12))

    # ── Budget Status Section ────────────────────────────────────────
    elements.append(Paragraph("Budget Status (Current Month)", section_style))

    today = date.today()
    budgets_result = await db.execute(
        select(Budget).where(
            Budget.user_id == user.id,
            Budget.start_date <= today,
            Budget.end_date >= today,
        )
    )
    budgets = budgets_result.scalars().all()

    if budgets:
        # Get spending per category this month
        spending_result = await db.execute(
            select(
                Transaction.category,
                func.coalesce(func.sum(Transaction.amount), 0).label("total"),
            )
            .where(
                Transaction.user_id == user.id,
                Transaction.transaction_type == TransactionType.EXPENSE,
                Transaction.transaction_date >= today.replace(day=1),
                Transaction.transaction_date <= today,
            )
            .group_by(Transaction.category)
        )
        spending_map = {
            (row.category.value if hasattr(row.category, "value") else str(row.category)): float(row.total)
            for row in spending_result.all()
        }

        budget_data = [["Category", "Limit", "Spent", "Remaining", "Status"]]
        for b in budgets:
            cat = b.category.value if hasattr(b.category, "value") else str(b.category)
            limit_val = float(b.budget_limit)
            spent = spending_map.get(cat, 0.0)
            remaining = max(limit_val - spent, 0)
            pct = (spent / limit_val * 100) if limit_val > 0 else 0
            status_text = "EXCEEDED" if pct >= 100 else ("WARNING" if pct >= 80 else "ON TRACK")
            budget_data.append([
                cat.replace("_", " ").title(),
                f"${limit_val:,.2f}",
                f"${spent:,.2f}",
                f"${remaining:,.2f}",
                status_text,
            ])

        budget_table = Table(budget_data, colWidths=[120, 90, 90, 90, 80])
        budget_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#232F3E")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 10),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("ALIGN", (1, 0), (3, -1), "RIGHT"),
            ("ALIGN", (4, 0), (4, -1), "CENTER"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        elements.append(budget_table)
    else:
        elements.append(Paragraph("No active budgets for the current period.", styles["Normal"]))

    elements.append(Spacer(1, 12))

    # ── Transactions Section ─────────────────────────────────────────
    elements.append(Paragraph("Recent Transactions (Last 100)", section_style))

    txn_result = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == user.id)
        .order_by(Transaction.transaction_date.desc())
        .limit(100)
    )
    txns = txn_result.scalars().all()

    if txns:
        txn_data = [["Date", "Description", "Category", "Type", "Amount"]]
        for t in txns:
            desc = (t.description or t.merchant_name or "Unknown")
            # Truncate long descriptions for PDF readability
            if len(desc) > 40:
                desc = desc[:37] + "..."
            txn_data.append([
                t.transaction_date.strftime("%Y-%m-%d") if t.transaction_date else "",
                desc,
                (t.category.value if hasattr(t.category, "value") else str(t.category)).replace("_", " ").title(),
                t.transaction_type.value.upper() if hasattr(t.transaction_type, "value") else str(t.transaction_type),
                f"${float(t.amount):,.2f}",
            ])

        txn_table = Table(txn_data, colWidths=[70, 190, 90, 60, 80])
        txn_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#232F3E")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("FONTSIZE", (0, 1), (-1, -1), 8),
            ("ALIGN", (4, 0), (4, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(txn_table)
    else:
        elements.append(Paragraph("No transactions found.", styles["Normal"]))

    # ── Monthly Summary ──────────────────────────────────────────────
    elements.append(Spacer(1, 16))
    elements.append(Paragraph("Monthly Summary (Current Month)", section_style))

    income_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .where(
            Transaction.user_id == user.id,
            Transaction.transaction_type == TransactionType.INCOME,
            Transaction.transaction_date >= today.replace(day=1),
            Transaction.transaction_date <= today,
        )
    )
    total_income = float(income_result.scalar_one())

    expense_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .where(
            Transaction.user_id == user.id,
            Transaction.transaction_type == TransactionType.EXPENSE,
            Transaction.transaction_date >= today.replace(day=1),
            Transaction.transaction_date <= today,
        )
    )
    total_expenses = float(expense_result.scalar_one())

    summary_data = [
        ["Metric", "Amount"],
        ["Total Income", f"${total_income:,.2f}"],
        ["Total Expenses", f"${total_expenses:,.2f}"],
        ["Net Savings", f"${total_income - total_expenses:,.2f}"],
    ]
    summary_table = Table(summary_data, colWidths=[200, 150])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#232F3E")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CCCCCC")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F5F5F5")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(summary_table)

    # ── Footer ───────────────────────────────────────────────────────
    elements.append(Spacer(1, 24))
    footer_style = ParagraphStyle(
        "Footer",
        parent=styles["Normal"],
        fontSize=8,
        textColor=colors.HexColor("#999999"),
        alignment=1,  # center
    )
    elements.append(Paragraph(
        "This report is auto-generated by AWS Personal Finance Assistant. "
        "All data is user-scoped and GDPR-compliant. Confidential.",
        footer_style,
    ))

    doc.build(elements)
    buffer.seek(0)
    return buffer


# ═══════════════════════════════════════════════════════════════════════════
#  Export Endpoint
# ═══════════════════════════════════════════════════════════════════════════
@router.get(
    "/export",
    summary="Export financial report as PDF or CSV",
    responses={
        200: {
            "description": "Downloadable PDF or CSV file",
            "content": {
                "application/pdf": {},
                "text/csv": {},
            },
        },
    },
)
async def export_report(
    format: str = Query(
        ...,
        regex="^(pdf|csv)$",
        description="Export format: 'pdf' or 'csv'",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate and download a financial report.

    - **CSV**: A complete export of all transactions as a comma-separated file.
    - **PDF**: A formatted financial health report with net worth, budgets,
      monthly summary, and recent transactions.
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    if format == "csv":
        csv_buffer = await _generate_csv(db, current_user.id)
        return StreamingResponse(
            iter([csv_buffer.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="finance_report_{timestamp}.csv"'
            },
        )

    elif format == "pdf":
        pdf_buffer = await _generate_pdf(db, current_user)
        return StreamingResponse(
            iter([pdf_buffer.read()]),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="finance_report_{timestamp}.pdf"'
            },
        )

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid format. Must be 'pdf' or 'csv'.",
        )
