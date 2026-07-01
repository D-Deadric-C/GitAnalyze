from __future__ import annotations

import json
import re
from typing import Any, AsyncIterator

from google import genai
from google.genai import types

from .config import Settings
from .models import ChatHistoryItem, ModelPreference, RepoDetails
from .prompt_builder import build_gitpulse_prompt, format_history_text


def _json_from_text(text: str) -> Any:
    cleaned = text.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", text)
        if not match:
            raise
        return json.loads(match.group(0))


def _string_list(value: Any) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


class GeminiClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.gemini_api_key:
            raise RuntimeError(
                "[GitPulse] GEMINI_API_KEY environment variable is not set. "
                "Add it to .env.local or your deployment environment."
            )
        self._settings = settings
        self._client = genai.Client(api_key=settings.gemini_api_key)

    def _generation_config(self, preference: ModelPreference, include_thoughts: bool = False) -> types.GenerateContentConfig:
        return types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                include_thoughts=include_thoughts,
                thinking_level="HIGH" if preference == "thinking" else "LOW",
            )
        )

    async def prune_file_tree_hierarchically(self, question: str, file_tree: list[str]) -> list[str]:
        top_level_paths: set[str] = set()
        for path in file_tree:
            parts = path.split("/")
            top_level_paths.add("/".join(parts[:2]) if len(parts) > 1 else parts[0])

        prompt = f"""
Identify the 5-10 most relevant directories or modules for this query.
Query: "{question}"

Directories:
{chr(10).join(list(top_level_paths)[:500])}

Return JSON: {{ "directories": ["path/to/dir"] }}
NO EXPLANATION.
"""
        try:
            result = await self._client.aio.models.generate_content(
                model=self._settings.gemini_model,
                contents=prompt,
                config=self._generation_config("flash"),
            )
            parsed = _json_from_text(result.text or "")
            target_dirs = _string_list(parsed.get("directories") if isinstance(parsed, dict) else [])
            return [
                path
                for path in file_tree
                if "/" not in path or any(path.startswith(directory) for directory in target_dirs)
            ]
        except Exception:
            return file_tree[:1000]

    async def analyze_file_selection(
        self,
        question: str,
        file_tree: list[str],
        owner: str,
        repo: str,
        model_preference: ModelPreference,
        history: list[ChatHistoryItem],
    ) -> list[str]:
        mentioned_files = []
        for path in file_tree:
            filename = path.split("/")[-1]
            if not filename:
                continue
            pattern = re.compile(rf"(?<![\w.]){re.escape(filename)}(?![\w])", re.IGNORECASE)
            if pattern.search(question):
                mentioned_files.append(path)

        if mentioned_files:
            common_files = {"package.json", "README.md", "tsconfig.json", "next.config.js", "next.config.mjs"}
            additional = [path for path in file_tree if path in common_files and path not in mentioned_files]
            cap = 30 if model_preference == "thinking" else 20
            return [*mentioned_files, *additional][:cap]

        candidates = file_tree
        if len(file_tree) > 1000:
            candidates = await self.prune_file_tree_hierarchically(question, file_tree)

        is_deep_thinking = model_preference == "thinking"
        history_text = format_history_text(history[-4:]) if history else "No previous history."
        prompt = f"""
Select relevant files for this query from the list below.
Query: "{question}"

Recent Chat History:
{history_text}

Files:
{chr(10).join(candidates[:500])}

Rules:
- Return JSON: {{ "files": ["path/to/file"] }}
- If the query is a follow-up that can be answered entirely from Recent Chat History, return {{ "files": [] }}.
- Max {"50" if is_deep_thinking else "25"} files.
- Select the minimum number of files necessary to answer the query.
- Prioritize source code over documentation for technical questions.
- Only pick README.md for high-level, installation, or overview questions.
- NO EXPLANATION. JSON ONLY.
"""
        if is_deep_thinking:
            prompt += "\n- Deep thinking mode: prioritize source code, application logic, routes, schemas, and configuration.\n"

        try:
            result = await self._client.aio.models.generate_content(
                model=self._settings.gemini_model,
                contents=prompt,
                config=self._generation_config(model_preference, include_thoughts=model_preference == "thinking"),
            )
            parsed = _json_from_text(result.text or "")
            return _string_list(parsed.get("files") if isinstance(parsed, dict) else [])
        except Exception:
            fallback_names = {"readme.md", "package.json", "go.mod", "cargo.toml"}
            return [path for path in file_tree if path.lower() in fallback_names]

    async def answer_with_context_stream(
        self,
        question: str,
        context: str,
        repo_details: RepoDetails,
        history: list[ChatHistoryItem],
        model_preference: ModelPreference,
    ) -> AsyncIterator[str]:
        history_text = format_history_text(history)
        prompt = build_gitpulse_prompt(question, context, repo_details, history_text)
        config = self._generation_config(
            model_preference,
            include_thoughts=model_preference == "thinking",
        )

        stream = await self._client.aio.models.generate_content_stream(
            model=self._settings.gemini_model,
            contents=prompt,
            config=config,
        )
        async for chunk in stream:
            for candidate in chunk.candidates or []:
                content = candidate.content
                if not content:
                    continue
                for part in content.parts or []:
                    text = getattr(part, "text", None)
                    if not text:
                        continue
                    if getattr(part, "thought", False):
                        yield f"THOUGHT:{text}"
                    else:
                        yield text

