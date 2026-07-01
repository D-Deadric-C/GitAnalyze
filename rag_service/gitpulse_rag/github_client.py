from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings


@dataclass(frozen=True)
class FileContent:
    path: str
    content: str | None


class GitHubClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self._settings.github_token:
            headers["Authorization"] = f"Bearer {self._settings.github_token}"
        return headers

    async def get_file_content(self, owner: str, repo: str, path: str) -> FileContent:
        url = f"{self._settings.github_api_base_url}/repos/{owner}/{repo}/contents/{path}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=self._headers())

        if response.status_code == 404:
            return FileContent(path=path, content=None)
        response.raise_for_status()
        payload: dict[str, Any] = response.json()

        if payload.get("type") != "file":
            return FileContent(path=path, content=None)

        raw_content = payload.get("content")
        if not isinstance(raw_content, str):
            return FileContent(path=path, content=None)

        encoding = payload.get("encoding")
        if encoding == "base64":
            try:
                cleaned = raw_content.replace("\n", "")
                decoded = base64.b64decode(cleaned)
                return FileContent(path=path, content=decoded.decode("utf-8", errors="replace"))
            except Exception:
                return FileContent(path=path, content=None)

        return FileContent(path=path, content=raw_content)

    async def get_file_content_batch(
        self,
        owner: str,
        repo: str,
        paths: list[str],
    ) -> list[FileContent]:
        tasks = [self.get_file_content(owner, repo, path) for path in paths]
        if not tasks:
            return []
        return await asyncio.gather(*tasks)

