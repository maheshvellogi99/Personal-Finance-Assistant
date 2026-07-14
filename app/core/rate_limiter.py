"""
Centralised rate-limiter configuration.

Provides two mechanisms:

1. **Global middleware** — ``SlowAPIMiddleware`` + ``limiter`` for app-wide
   rate limiting (registered in ``main.py``).

2. **Per-endpoint dependencies** — ``rate_limit(n, window)`` returns a
   FastAPI ``Depends``-compatible callable that enforces a per-IP,
   per-endpoint rate limit without interfering with body parsing.

Usage in route modules::

    from app.core.rate_limiter import rate_limit

    @router.post("/login", dependencies=[Depends(rate_limit(5, 60))])
    async def login(body: UserLogin, ...):
        ...
"""

from __future__ import annotations

import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

from slowapi import Limiter
from slowapi.util import get_remote_address

# Global limiter instance — attached to app.state in main.py for SlowAPIMiddleware
limiter = Limiter(key_func=get_remote_address)

# ── Per-endpoint sliding-window rate limiter ─────────────────────────────
_request_log: dict[str, list[float]] = defaultdict(list)


def rate_limit(max_requests: int, window_seconds: int = 60):
    """
    Return a FastAPI dependency that enforces a sliding-window rate limit.

    Parameters
    ----------
    max_requests : int
        Maximum number of requests allowed within the window.
    window_seconds : int
        Length of the sliding window in seconds (default 60).

    Raises
    ------
    HTTPException (429)
        When the client exceeds the allowed rate.
    """

    async def _check(request: Request) -> None:
        client_ip = request.client.host if request.client else "unknown"
        key = f"{client_ip}:{request.url.path}"
        now = time.time()

        # Prune expired timestamps
        _request_log[key] = [
            t for t in _request_log[key] if now - t < window_seconds
        ]

        if len(_request_log[key]) >= max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Rate limit exceeded: {max_requests} requests "
                    f"per {window_seconds}s. Please try again later."
                ),
                headers={"Retry-After": str(window_seconds)},
            )

        _request_log[key].append(now)

    return _check
