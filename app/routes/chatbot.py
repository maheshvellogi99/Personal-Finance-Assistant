"""
RAG-powered AI Chatbot routes.

Pipeline
────────
1.  User sends a natural-language query via POST /chatbot/chat
2.  The query is parsed into a structured intent (rag_retrieval.parse_user_intent)
3.  The intent is routed to the appropriate data retrieval function(s)
    — all queries are scoped to the authenticated user (strict data isolation)
4.  Retrieved data is formatted into an LLM context window
5.  A response is generated (built-in templates or OpenAI GPT-4o-mini)
6.  The response + follow-up suggestions are returned to the client

Security
────────
• All database queries are parameterised and filtered by user_id
• The LLM system prompt explicitly forbids revealing SQL / schema details
• No raw SQL is ever constructed from user input

Endpoints
─────────
POST /chatbot/chat       Send a message and receive an AI response
GET  /chatbot/history    Retrieve chat history (in-memory for now)
GET  /chatbot/suggest    Get contextual suggestion prompts
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rate_limiter import rate_limit
from app.models.models import User
from app.routes.auth import get_current_user
from app.schemas.schemas import ChatMessage, ChatResponse
from app.services.llm_generator import generate_response, get_active_provider
from app.services.rag_retrieval import (
    parse_user_intent,
    retrieve_context_for_intent,
)

router = APIRouter(prefix="/chatbot", tags=["AI Chatbot"])

# In-memory chat history per user (replaced by DB persistence in a future module)
_chat_history: dict[str, list[dict]] = {}

MAX_HISTORY_PER_USER = 50


def _get_user_history(user_id: str) -> list[dict]:
    """Get or initialise in-memory chat history for a user."""
    if user_id not in _chat_history:
        _chat_history[user_id] = []
    return _chat_history[user_id]


def _append_message(user_id: str, role: str, content: str) -> None:
    """Append a message to the user's history, enforcing the max limit."""
    history = _get_user_history(user_id)
    history.append({
        "role": role,
        "content": content,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    # Trim to keep only the last N messages
    if len(history) > MAX_HISTORY_PER_USER:
        _chat_history[user_id] = history[-MAX_HISTORY_PER_USER:]


@router.post(
    "/chat",
    response_model=ChatResponse,
    summary="Send a message to the AI financial assistant (RAG pipeline)",
    dependencies=[Depends(rate_limit(10, 60))],
)
async def chat(
    body: ChatMessage,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Full RAG pipeline:
    1. Parse intent from natural language
    2. Retrieve user-scoped financial data
    3. Generate response (built-in or LLM)
    4. Return with follow-up suggestions
    """
    user_id_str = str(current_user.id)

    # Record the user's message
    _append_message(user_id_str, "user", body.message)

    # ── Step 1: Parse intent ─────────────────────────────────────────
    intent = parse_user_intent(body.message)

    # ── Step 2: Retrieve user-scoped data ────────────────────────────
    context = await retrieve_context_for_intent(
        db=db,
        user_id=current_user.id,
        intent=intent,
    )

    # ── Step 3: Generate response ────────────────────────────────────
    reply, suggestions = await generate_response(
        query=body.message,
        context=context,
        user_name=current_user.full_name,
    )

    # Record the AI's response
    _append_message(user_id_str, "assistant", reply)

    return ChatResponse(reply=reply, suggestions=suggestions)


@router.get(
    "/history",
    summary="Retrieve chat history for the current user",
)
async def chat_history(
    current_user: User = Depends(get_current_user),
):
    """Return the in-memory chat history for the authenticated user."""
    user_id_str = str(current_user.id)
    history = _get_user_history(user_id_str)
    return {
        "messages": history,
        "count": len(history),
    }


@router.get(
    "/suggest",
    summary="Get contextual suggestion prompts",
)
async def chat_suggestions(
    current_user: User = Depends(get_current_user),
):
    """Return a set of starter prompts the user can click to begin a conversation."""
    return {
        "suggestions": [
            "How much did I spend this month?",
            "Show my spending by category",
            "What are my top 5 expenses?",
            "Am I over budget anywhere?",
            "How are my savings goals going?",
            "Show my recurring subscriptions",
            "Compare this month to last month",
            "What's my net worth?",
        ]
    }


@router.get(
    "/provider",
    summary="Show which LLM provider is currently active",
)
async def active_provider(
    current_user: User = Depends(get_current_user),
):
    """Diagnostic endpoint — shows the active LLM provider and its rate limits."""
    return get_active_provider()
