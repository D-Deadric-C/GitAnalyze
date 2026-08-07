import { describe, expect, it } from "vitest";

import { normalizeGitHubInput, parseGitHubInput } from "@/lib/github-input";

describe("parseGitHubInput — repositories", () => {
    const repoForms = [
        "facebook/react",
        "  facebook/react  ",
        "facebook/react/",
        "facebook/react.git",
        "github.com/facebook/react",
        "www.github.com/facebook/react",
        "https://github.com/facebook/react",
        "http://github.com/facebook/react",
        "https://www.github.com/facebook/react/",
        "https://github.com/facebook/react.git",
        "git@github.com:facebook/react.git",
        "//github.com/facebook/react",
        // Deep links still identify the repository.
        "https://github.com/facebook/react/tree/main/packages",
        "https://github.com/facebook/react/blob/main/README.md",
        "https://github.com/facebook/react/pull/12345",
        // Query strings and fragments are noise.
        "https://github.com/facebook/react?tab=readme-ov-file",
        "https://github.com/facebook/react#readme",
    ];

    it.each(repoForms)("parses %s", (input) => {
        const parsed = parseGitHubInput(input);
        expect(parsed).toMatchObject({
            kind: "repo",
            owner: "facebook",
            repo: "react",
            slug: "facebook/react",
        });
    });

    it("preserves dots, hyphens and underscores in names", () => {
        expect(parseGitHubInput("my-org/some_repo.js")).toMatchObject({
            kind: "repo",
            slug: "my-org/some_repo.js",
        });
    });
});

describe("parseGitHubInput — profiles", () => {
    const profileForms = [
        "octocat",
        "  octocat ",
        "@octocat",
        "github.com/octocat",
        "https://github.com/octocat",
        "https://github.com/octocat/",
    ];

    it.each(profileForms)("parses %s", (input) => {
        expect(parseGitHubInput(input)).toMatchObject({
            kind: "profile",
            username: "octocat",
            slug: "octocat",
        });
    });
});

describe("parseGitHubInput — empty and invalid", () => {
    it.each(["", "   ", "\n", "https://github.com/", "github.com"])(
        "treats %p as empty",
        (input) => {
            expect(parseGitHubInput(input).kind).toBe("empty");
        },
    );

    it("rejects non-GitHub hosts", () => {
        const parsed = parseGitHubInput("https://gitlab.com/owner/repo");
        expect(parsed.kind).toBe("invalid");
        if (parsed.kind === "invalid") {
            expect(parsed.reason).toMatch(/github\.com/i);
        }
    });

    it("rejects GitHub UI routes that aren't users", () => {
        expect(parseGitHubInput("https://github.com/settings").kind).toBe("invalid");
        expect(parseGitHubInput("marketplace").kind).toBe("invalid");
    });

    it("rejects names containing illegal characters", () => {
        expect(parseGitHubInput("bad name/repo").kind).toBe("invalid");
        expect(parseGitHubInput("owner/bad name").kind).toBe("invalid");
    });
});

describe("normalizeGitHubInput", () => {
    it("returns the canonical slug", () => {
        expect(normalizeGitHubInput("https://github.com/facebook/react/")).toBe("facebook/react");
        expect(normalizeGitHubInput("@octocat")).toBe("octocat");
    });

    it("returns null when there is nothing usable", () => {
        expect(normalizeGitHubInput("")).toBeNull();
        expect(normalizeGitHubInput("https://gitlab.com/a/b")).toBeNull();
    });
});
