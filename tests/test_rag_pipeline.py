from __future__ import annotations

from typing import AsyncIterator

import pytest

from gitpulse_rag.file_filters import prune_file_paths
from gitpulse_rag.github_client import FileContent
from gitpulse_rag.models import RepoDetails, RepoQueryRequest
from gitpulse_rag.pipeline import build_context, execute_repo_query, execute_repo_query_stream


def test_prune_file_paths_filters_binary_and_generated_files() -> None:
    paths = [
        "src/index.ts",
        "public/logo.png",
        "dist/bundle.min.js",
        "package-lock.json",
        "src/styles.css",
        "assets/font.woff2",
    ]

    assert prune_file_paths(paths) == ["src/index.ts", "src/styles.css"]


def test_build_context_respects_token_budget() -> None:
    context = build_context(
        [
            FileContent(path="src/a.py", content="a" * 20),
            FileContent(path="src/b.py", content="b" * 80),
        ],
        max_tokens=10,
    )

    assert "--- FILE: src/a.py ---" in context
    assert "--- FILE: src/b.py ---" not in context
    assert "Context truncated" in context


@pytest.mark.asyncio
async def test_execute_repo_query_stream_emits_expected_events() -> None:
    async def analyze_files(query: str, file_paths: list[str], owner: str, repo: str) -> list[str]:
        return ["src/core.py"]

    async def fetch_files(owner: str, repo: str, paths: list[str]) -> list[FileContent]:
        return [FileContent(path="src/core.py", content="print('ok')")]

    async def stream_answer(query: str, context: str) -> AsyncIterator[str]:
        yield "Hello "
        yield "world"

    request = RepoQueryRequest(
        query="summarize",
        repoDetails=RepoDetails(owner="acme", repo="widget"),
        filePaths=["src/core.py", "public/logo.png"],
    )

    updates = [
        update.model_dump(exclude_none=True)
        async for update in execute_repo_query_stream(
            request,
            analyze_files=analyze_files,
            fetch_files=fetch_files,
            stream_answer=stream_answer,
        )
    ]

    assert updates[0]["type"] == "status"
    assert {"type": "files", "files": ["src/core.py"]} in updates
    assert {"type": "content", "text": "Hello ", "append": True} in updates
    assert updates[-1] == {"type": "complete", "relevantFiles": ["src/core.py"]}


@pytest.mark.asyncio
async def test_execute_repo_query_collects_content() -> None:
    async def analyze_files(query: str, file_paths: list[str], owner: str, repo: str) -> list[str]:
        return ["src/core.py"]

    async def fetch_files(owner: str, repo: str, paths: list[str]) -> list[FileContent]:
        return [FileContent(path="src/core.py", content="print('ok')")]

    async def stream_answer(query: str, context: str) -> AsyncIterator[str]:
        yield "First "
        yield "Second"

    request = RepoQueryRequest(
        query="summarize",
        repoDetails=RepoDetails(owner="acme", repo="widget"),
        filePaths=["src/core.py"],
    )

    answer, files = await execute_repo_query(
        request,
        analyze_files=analyze_files,
        fetch_files=fetch_files,
        stream_answer=stream_answer,
    )

    assert answer == "First Second"
    assert files == ["src/core.py"]

