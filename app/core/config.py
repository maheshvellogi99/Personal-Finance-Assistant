"""
Application configuration using Pydantic Settings.

All secrets and environment-specific values are loaded from environment
variables (or a .env file in development). Never commit real credentials.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration — every field maps to an environment variable."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Application ──────────────────────────────────────────────────────
    APP_NAME: str = "Virtual Personal Finance Assistant"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # ── Database ─────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/finance_db"

    # ── Auth / JWT ───────────────────────────────────────────────────────
    SECRET_KEY: str = "CHANGE-ME-IN-PRODUCTION"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # ── CORS ─────────────────────────────────────────────────────────────
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000"]

    # ── AI / Chatbot LLM Providers ──────────────────────────────────────
    # Priority: GEMINI (free) → GROQ (free) → OPENAI (paid) → Built-in
    # Only set the key for the provider you want to use.
    GEMINI_API_KEY: str = ""   # Google AI Studio: https://aistudio.google.com/apikey
    GROQ_API_KEY: str = ""     # Groq Console: https://console.groq.com/keys
    OPENAI_API_KEY: str = ""   # OpenAI Platform: https://platform.openai.com/api-keys

    # ── Google OAuth ────────────────────────────────────────────────────
    GOOGLE_CLIENT_ID: str = ""  # Google Cloud Console: https://console.cloud.google.com/apis/credentials


settings = Settings()
