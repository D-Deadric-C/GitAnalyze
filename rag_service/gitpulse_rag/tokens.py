from __future__ import annotations


def count_tokens(text: str) -> int:
    # Gemini tokenization is service-side. This conservative approximation keeps
    # the context builder dependency-light while preserving the old budget shape.
    return max(1, (len(text) + 3) // 4)

