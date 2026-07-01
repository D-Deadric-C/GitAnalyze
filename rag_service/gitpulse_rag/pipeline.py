from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable

from .config import get_settings
from .file_filters import prune_file_paths
from .gemini_client import GeminiClient
from .github_client import FileContent, GitHubClient
from .models import RepoQueryRequest, StreamUpdate
from .tokens import count_tokens

AnalyzeFiles = Callable[[str, list[str], str, str], Awaitable[list[str]]]
FetchFiles = Callable[[str, str, list[str]], Awaitable[list[FileContent]]]
StreamAnswer = Callable[[str, str], AsyncIterator[str]]


def build_context(files: list[FileContent], max_tokens: int) -> str:
    context = ""
    token_total = 0

    for file in files:
        if not file.content:
            continue
        tokens = count_tokens(file.content)
        if token_total + tokens > max_tokens:
            context += f"\n--- NOTE: Context truncated at {max_tokens:,} token limit ---\n"
            break
        context += f"\n--- FILE: {file.path} ---\n{file.content}\n"
        token_total += tokens

    return context or "No file content could be retrieved for the selected files."


async def execute_repo_query_stream(
    request: RepoQueryRequest,
    *,
    analyze_files: AnalyzeFiles | None = None,
    fetch_files: FetchFiles | None = None,
    stream_answer: StreamAnswer | None = None,
) -> AsyncIterator[StreamUpdate]:
    settings = get_settings()
    owner = request.repoDetails.owner
    repo = request.repoDetails.repo
    is_thinking = request.modelPreference == "thinking"

    try:
        gemini = None if analyze_files and stream_answer else GeminiClient(settings)
        github = None if fetch_files else GitHubClient(settings)

        yield StreamUpdate(
            type="status",
            message=(
                f'Reasoning: Identifying files relevant to "{request.query[:60]}{"..." if len(request.query) > 60 else ""}"...'
                if is_thinking
                else "Analyzing repository structure..."
            ),
            progress=15,
        )

        pruned_paths = prune_file_paths(request.filePaths)
        relevant_files = (
            await analyze_files(request.query, pruned_paths, owner, repo)
            if analyze_files
            else await gemini.analyze_file_selection(  # type: ignore[union-attr]
                request.query,
                pruned_paths,
                owner,
                repo,
                request.modelPreference,
                request.history,
            )
        )

        yield StreamUpdate(type="files", files=relevant_files)
        yield StreamUpdate(
            type="status",
            message=(
                f"Process: Loading {len(relevant_files)} file{'s' if len(relevant_files) != 1 else ''} for context analysis..."
                if is_thinking
                else "Reading selected files..."
            ),
            progress=40,
        )

        file_results = (
            await fetch_files(owner, repo, relevant_files)
            if fetch_files
            else await github.get_file_content_batch(owner, repo, relevant_files)  # type: ignore[union-attr]
        )
        context = build_context(file_results, settings.max_context_tokens)

        yield StreamUpdate(
            type="status",
            message=(
                "Process: Formulating a detailed response based on the code context..."
                if is_thinking
                else "Thinking..."
            ),
            progress=70,
        )

        answer_stream = (
            stream_answer(request.query, context)
            if stream_answer
            else gemini.answer_with_context_stream(  # type: ignore[union-attr]
                request.query,
                context,
                request.repoDetails,
                request.history,
                request.modelPreference,
            )
        )

        async for chunk in answer_stream:
            if chunk.startswith("THOUGHT:"):
                yield StreamUpdate(type="thought", text=chunk.removeprefix("THOUGHT:"))
            elif chunk.startswith("STATUS:"):
                yield StreamUpdate(type="status", message=chunk.removeprefix("STATUS:"), progress=70)
            else:
                yield StreamUpdate(type="content", text=chunk, append=True)

        yield StreamUpdate(type="complete", relevantFiles=relevant_files)
    except Exception as error:
        yield StreamUpdate(type="error", message=str(error))


async def select_relevant_files(request: RepoQueryRequest) -> list[str]:
    settings = get_settings()
    gemini = GeminiClient(settings)
    return await gemini.analyze_file_selection(
        request.query,
        prune_file_paths(request.filePaths),
        request.repoDetails.owner,
        request.repoDetails.repo,
        request.modelPreference,
        request.history,
    )


async def execute_repo_query(
    request: RepoQueryRequest,
    **deps: object,
) -> tuple[str, list[str]]:
    answer = ""
    relevant_files: list[str] = []

    async for update in execute_repo_query_stream(request, **deps):
        if update.type == "content" and update.text:
            answer += update.text
        elif update.type == "complete":
            relevant_files = update.relevantFiles or []
        elif update.type == "error":
            raise RuntimeError(update.message or "RAG pipeline failed")

    return answer, relevant_files
