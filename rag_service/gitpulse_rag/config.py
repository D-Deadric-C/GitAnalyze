from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str | None
    github_token: str | None
    gemini_model: str = "gemini-3-flash-preview"
    max_context_tokens: int = 200_000
    github_api_base_url: str = "https://api.github.com"


def get_settings() -> Settings:
    return Settings(
        gemini_api_key=os.getenv("GEMINI_API_KEY"),
        github_token=os.getenv("GITHUB_TOKEN"),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-3-flash-preview"),
        max_context_tokens=int(os.getenv("RAG_MAX_CONTEXT_TOKENS", "200000")),
        github_api_base_url=os.getenv("GITHUB_API_BASE_URL", "https://api.github.com"),
    )

