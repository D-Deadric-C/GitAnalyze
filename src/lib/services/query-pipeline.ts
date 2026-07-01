/**
 * Python-backed repository query pipeline.
 *
 * The RAG pipeline now lives in rag_service/gitpulse_rag. This module keeps the
 * existing TypeScript public API stable for Next.js callers and streams the
 * Python service's newline-delimited StreamUpdate events.
 */
import { getCachedRepoQueryAnswer, cacheRepoQueryAnswer, getLatestRepoQueryAnswer } from "@/lib/cache";
import type { StreamUpdate } from "@/lib/streaming-types";
import type { GitHubProfile } from "@/lib/github";
import type { ModelPreference } from "@/lib/ai-client";

export interface RepoQueryParams {
    query: string;
    owner: string;
    repo: string;
    filePaths: string[];
    history?: { role: "user" | "model"; content: string }[];
    profileData?: GitHubProfile;
    modelPreference?: ModelPreference;
}

export interface QueryPipelineDeps {
    fetch?: typeof fetch;
    serviceUrl?: string;
}

const SKIP_PATTERN =
    /(\.(png|jpg|jpeg|gif|svg|ico|lock|pdf|zip|tar|gz|map|wasm|min\.js|min\.css|woff|woff2|ttf|otf|eot)|package-lock\.json|yarn\.lock)$/i;

export function pruneFilePaths(paths: string[]): string[] {
    return paths.filter(
        (p) =>
            !SKIP_PATTERN.test(p) &&
            !p.includes("node_modules/") &&
            !p.includes(".git/")
    );
}

function getPipelineServiceUrl(explicitUrl?: string): string {
    return (explicitUrl ?? process.env.RAG_PIPELINE_URL ?? "http://127.0.0.1:8008").replace(/\/+$/, "");
}

function buildRequestBody(params: RepoQueryParams) {
    return {
        query: params.query,
        repoDetails: {
            owner: params.owner,
            repo: params.repo,
        },
        filePaths: params.filePaths,
        history: params.history ?? [],
        profileData: params.profileData,
        modelPreference: params.modelPreference ?? "flash",
    };
}

function isStreamUpdate(value: unknown): value is StreamUpdate {
    if (!value || typeof value !== "object" || !("type" in value)) return false;
    const type = (value as { type?: unknown }).type;
    return (
        type === "status" ||
        type === "thought" ||
        type === "content" ||
        type === "files" ||
        type === "complete" ||
        type === "error"
    );
}

async function* parseNdjsonStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamUpdate> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const parsed: unknown = JSON.parse(trimmed);
            if (isStreamUpdate(parsed)) {
                yield parsed;
            }
        }
    }

    buffer += decoder.decode();
    const trimmed = buffer.trim();
    if (trimmed) {
        const parsed: unknown = JSON.parse(trimmed);
        if (isStreamUpdate(parsed)) {
            yield parsed;
        }
    }
}

export async function selectRepoFiles(
    params: RepoQueryParams,
    deps: QueryPipelineDeps = {}
): Promise<{ relevantFiles: string[]; fileCount: number }> {
    const requestFetch = deps.fetch ?? fetch;
    const serviceUrl = getPipelineServiceUrl(deps.serviceUrl);

    const response = await requestFetch(`${serviceUrl}/repo/select-files`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(buildRequestBody(params)),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Python RAG pipeline returned ${response.status}${text ? `: ${text}` : ""}`);
    }

    const result = await response.json() as { relevantFiles?: unknown; fileCount?: unknown };
    const relevantFiles = Array.isArray(result.relevantFiles)
        ? result.relevantFiles.filter((file): file is string => typeof file === "string")
        : [];

    return {
        relevantFiles,
        fileCount: typeof result.fileCount === "number" ? result.fileCount : relevantFiles.length,
    };
}

export async function* executeRepoQueryStream(
    params: RepoQueryParams,
    deps: QueryPipelineDeps = {}
): AsyncGenerator<StreamUpdate> {
    const requestFetch = deps.fetch ?? fetch;
    const serviceUrl = getPipelineServiceUrl(deps.serviceUrl);

    try {
        const shortCircuit = await getLatestRepoQueryAnswer(params.owner, params.repo, params.query);
        if (shortCircuit) {
            yield { type: "content", text: shortCircuit, append: true };
            yield { type: "complete", relevantFiles: [] };
            return;
        }

        const response = await requestFetch(`${serviceUrl}/repo/query/stream`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(buildRequestBody(params)),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Python RAG pipeline returned ${response.status}${text ? `: ${text}` : ""}`);
        }

        if (!response.body) {
            throw new Error("Python RAG pipeline response did not include a stream body.");
        }

        for await (const update of parseNdjsonStream(response.body)) {
            yield update;
        }
    } catch (error: unknown) {
        console.error("Python query pipeline error:", {
            owner: params.owner,
            repo: params.repo,
            modelPreference: params.modelPreference ?? "flash",
            filePathCount: params.filePaths.length,
            queryPreview: params.query.slice(0, 160),
            error,
        });
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        yield { type: "error", message };
    }
}

export async function executeRepoQuery(
    params: RepoQueryParams,
    deps: QueryPipelineDeps = {}
): Promise<{ answer: string; relevantFiles: string[] }> {
    const requestFetch = deps.fetch ?? fetch;
    const serviceUrl = getPipelineServiceUrl(deps.serviceUrl);

    const shortCircuit = await getLatestRepoQueryAnswer(params.owner, params.repo, params.query);
    if (shortCircuit) {
        return { answer: shortCircuit, relevantFiles: [] };
    }

    const directResponse = await requestFetch(`${serviceUrl}/repo/query`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(buildRequestBody(params)),
    });

    if (!directResponse.ok) {
        const text = await directResponse.text().catch(() => "");
        throw new Error(`Python RAG pipeline returned ${directResponse.status}${text ? `: ${text}` : ""}`);
    }

    const result = await directResponse.json() as { answer?: unknown; relevantFiles?: unknown };
    const answer = typeof result.answer === "string" ? result.answer : "";
    const relevantFiles = Array.isArray(result.relevantFiles)
        ? result.relevantFiles.filter((file): file is string => typeof file === "string")
        : [];

    const cached = await getCachedRepoQueryAnswer(params.owner, params.repo, params.query, relevantFiles);
    if (cached) {
        return { answer: cached, relevantFiles };
    }

    if (answer) {
        await cacheRepoQueryAnswer(params.owner, params.repo, params.query, relevantFiles, answer);
    }

    return { answer, relevantFiles };
}
