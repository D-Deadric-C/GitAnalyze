from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


ModelPreference = Literal["flash", "thinking"]


class ChatHistoryItem(BaseModel):
    role: Literal["user", "model"]
    content: str


class RepoDetails(BaseModel):
    owner: str
    repo: str


class GitHubProfile(BaseModel):
    login: str | None = None
    avatar_url: str | None = None
    html_url: str | None = None
    name: str | None = None
    bio: str | None = None
    location: str | None = None
    blog: str | None = None
    public_repos: int | None = None
    followers: int | None = None
    following: int | None = None
    created_at: str | None = None


class RepoQueryRequest(BaseModel):
    query: str
    repoDetails: RepoDetails
    filePaths: list[str] = Field(default_factory=list)
    history: list[ChatHistoryItem] = Field(default_factory=list)
    profileData: GitHubProfile | None = None
    modelPreference: ModelPreference = "flash"


class RepoQueryResponse(BaseModel):
    answer: str
    relevantFiles: list[str]


class FileSelectionResponse(BaseModel):
    relevantFiles: list[str]
    fileCount: int


StreamUpdateType = Literal["status", "thought", "content", "files", "complete", "error"]


class StreamUpdate(BaseModel):
    type: StreamUpdateType
    message: str | None = None
    progress: int | None = None
    text: str | None = None
    append: bool | None = None
    files: list[str] | None = None
    relevantFiles: list[str] | None = None
