from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

from .models import FileSelectionResponse, RepoQueryRequest, RepoQueryResponse
from .pipeline import execute_repo_query, execute_repo_query_stream, select_relevant_files


app = FastAPI(title="GitPulse RAG Pipeline", version="0.1.0")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/repo/query", response_model=RepoQueryResponse)
async def query_repo(request: RepoQueryRequest) -> RepoQueryResponse:
    answer, relevant_files = await execute_repo_query(request)
    return RepoQueryResponse(answer=answer, relevantFiles=relevant_files)


@app.post("/repo/select-files", response_model=FileSelectionResponse)
async def select_files(request: RepoQueryRequest) -> FileSelectionResponse:
    relevant_files = await select_relevant_files(request)
    return FileSelectionResponse(relevantFiles=relevant_files, fileCount=len(relevant_files))


@app.post("/repo/query/stream")
async def stream_query_repo(request: RepoQueryRequest) -> StreamingResponse:
    async def event_lines() -> AsyncIterator[str]:
        async for update in execute_repo_query_stream(request):
            yield json.dumps(update.model_dump(exclude_none=True), separators=(",", ":")) + "\n"

    return StreamingResponse(event_lines(), media_type="application/x-ndjson")
