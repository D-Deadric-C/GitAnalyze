import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeRepoQuery, executeRepoQueryStream, selectRepoFiles } from "@/lib/services/query-pipeline";
import type { StreamUpdate } from "@/lib/streaming-types";

const {
    getCachedRepoQueryAnswerMock,
    cacheRepoQueryAnswerMock,
    getLatestRepoQueryAnswerMock,
} = vi.hoisted(() => ({
    getCachedRepoQueryAnswerMock: vi.fn(),
    cacheRepoQueryAnswerMock: vi.fn(),
    getLatestRepoQueryAnswerMock: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
    getCachedRepoQueryAnswer: getCachedRepoQueryAnswerMock,
    cacheRepoQueryAnswer: cacheRepoQueryAnswerMock,
    getLatestRepoQueryAnswer: getLatestRepoQueryAnswerMock,
}));

function ndjsonResponse(lines: unknown[]) {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const line of lines) {
                controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
            }
            controller.close();
        },
    });

    return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
    });
}

describe("executeRepoQueryStream", () => {
    beforeEach(() => {
        getCachedRepoQueryAnswerMock.mockReset();
        cacheRepoQueryAnswerMock.mockReset();
        getLatestRepoQueryAnswerMock.mockReset();
    });

    it("short-circuits when a latest cached answer exists", async () => {
        getLatestRepoQueryAnswerMock.mockResolvedValue("recent answer");
        const fetchMock = vi.fn();

        const updates: StreamUpdate[] = [];
        for await (const update of executeRepoQueryStream(
            {
                query: "what does this repo do?",
                owner: "acme",
                repo: "widget",
                filePaths: ["src/index.ts"],
            },
            { fetch: fetchMock, serviceUrl: "http://python-rag" }
        )) {
            updates.push(update);
        }

        expect(updates).toEqual([
            { type: "content", text: "recent answer", append: true },
            { type: "complete", relevantFiles: [] },
        ]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("streams newline-delimited updates from the Python service", async () => {
        getLatestRepoQueryAnswerMock.mockResolvedValue(null);
        const fetchMock = vi.fn().mockResolvedValue(ndjsonResponse([
            { type: "status", message: "Analyzing repository structure...", progress: 15 },
            { type: "files", files: ["src/core.py"] },
            { type: "content", text: "hello", append: true },
            { type: "complete", relevantFiles: ["src/core.py"] },
        ]));

        const updates: StreamUpdate[] = [];
        for await (const update of executeRepoQueryStream(
            {
                query: "summarize",
                owner: "acme",
                repo: "widget",
                filePaths: ["src/core.py"],
                modelPreference: "thinking",
            },
            { fetch: fetchMock, serviceUrl: "http://python-rag/" }
        )) {
            updates.push(update);
        }

        expect(fetchMock).toHaveBeenCalledWith("http://python-rag/repo/query/stream", expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
                query: "summarize",
                repoDetails: { owner: "acme", repo: "widget" },
                filePaths: ["src/core.py"],
                history: [],
                profileData: undefined,
                modelPreference: "thinking",
            }),
        }));
        expect(updates).toEqual([
            { type: "status", message: "Analyzing repository structure...", progress: 15 },
            { type: "files", files: ["src/core.py"] },
            { type: "content", text: "hello", append: true },
            { type: "complete", relevantFiles: ["src/core.py"] },
        ]);
    });
});
describe("executeRepoQuery", () => {
    beforeEach(() => {
        getCachedRepoQueryAnswerMock.mockReset();
        cacheRepoQueryAnswerMock.mockReset();
        getLatestRepoQueryAnswerMock.mockReset();
    });

    it("caches successful non-streaming Python responses", async () => {
        getCachedRepoQueryAnswerMock.mockResolvedValue(null);
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            answer: "Fresh answer",
            relevantFiles: ["src/core.py"],
        }));

        const result = await executeRepoQuery(
            {
                query: "summarize",
                owner: "acme",
                repo: "widget",
                filePaths: ["src/core.py"],
            },
            { fetch: fetchMock, serviceUrl: "http://python-rag" }
        );

        expect(result).toEqual({
            answer: "Fresh answer",
            relevantFiles: ["src/core.py"],
        });
        expect(cacheRepoQueryAnswerMock).toHaveBeenCalledWith(
            "acme",
            "widget",
            "summarize",
            ["src/core.py"],
            "Fresh answer"
        );
    });

    it("returns a cached answer when the Python-selected file set is cached", async () => {
        getCachedRepoQueryAnswerMock.mockResolvedValue("cached-by-selection");
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            answer: "Fresh answer",
            relevantFiles: ["src/core.py"],
        }));

        const result = await executeRepoQuery(
            {
                query: "summarize",
                owner: "acme",
                repo: "widget",
                filePaths: ["src/core.py"],
            },
            { fetch: fetchMock, serviceUrl: "http://python-rag" }
        );

        expect(result).toEqual({
            answer: "cached-by-selection",
            relevantFiles: ["src/core.py"],
        });
        expect(cacheRepoQueryAnswerMock).not.toHaveBeenCalled();
    });
});

describe("selectRepoFiles", () => {
    it("returns file selection results from the Python service", async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            relevantFiles: ["src/core.py"],
            fileCount: 1,
        }));

        const result = await selectRepoFiles(
            {
                query: "where is core logic?",
                owner: "acme",
                repo: "widget",
                filePaths: ["src/core.py"],
            },
            { fetch: fetchMock, serviceUrl: "http://python-rag" }
        );

        expect(result).toEqual({ relevantFiles: ["src/core.py"], fileCount: 1 });
        expect(fetchMock).toHaveBeenCalledWith("http://python-rag/repo/select-files", expect.objectContaining({
            method: "POST",
        }));
    });
});
