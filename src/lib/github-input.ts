/**
 * Parses whatever a user types into the search box into a canonical form.
 *
 * Accepts every shape people actually paste:
 *   https://github.com/owner/repo        github.com/owner/repo
 *   http://www.github.com/owner/repo/    owner/repo
 *   git@github.com:owner/repo.git        owner/repo.git
 *   github.com/owner/repo/tree/main/src  @username
 *
 * Downstream code (the chat route, the repo loader) splits on "/" to tell a
 * profile from a repository, so everything must be normalised to either
 * "owner/repo" or "username" before it is routed anywhere.
 */

export type ParsedGitHubInput =
    | { kind: "repo"; owner: string; repo: string; slug: string }
    | { kind: "profile"; username: string; slug: string }
    | { kind: "empty" }
    | { kind: "invalid"; reason: string };

/** GitHub allows alphanumerics, hyphen, underscore and period in these names. */
const NAME = /^[A-Za-z0-9._-]+$/;

/** Repository paths that are really GitHub UI routes, not a repo name. */
const RESERVED_OWNERS = new Set([
    "settings", "notifications", "explore", "marketplace", "sponsors",
    "topics", "trending", "collections", "events", "codespaces", "pulls",
    "issues", "new", "login", "join", "about", "pricing", "features",
]);

function stripDecorations(value: string): string {
    return value
        // Query string and fragment: ?tab=readme-ov-file, #readme
        .replace(/[?#].*$/, "")
        // Trailing ".git" from clone URLs
        .replace(/\.git$/i, "")
        // Leading and trailing slashes
        .replace(/^\/+|\/+$/g, "");
}

export function parseGitHubInput(raw: string): ParsedGitHubInput {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) return { kind: "empty" };

    // SSH clone form: git@github.com:owner/repo.git
    let working = trimmed.replace(/^git@github\.com:/i, "");

    // Strip protocol and host so URL and bare forms converge on the same path.
    working = working
        .replace(/^[a-z]+:\/\//i, "")
        .replace(/^\/\//, "")
        .replace(/^www\./i, "");

    if (/^github\.com(\/|$)/i.test(working)) {
        working = working.replace(/^github\.com/i, "");
    } else if (working.includes("://") || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(working)) {
        // A URL pointing somewhere that is not GitHub.
        return { kind: "invalid", reason: "Only github.com links are supported" };
    }

    working = stripDecorations(working);
    if (!working) return { kind: "empty" };

    // A leading @ is a common way to write a username.
    working = working.replace(/^@/, "");

    const segments = working.split("/").filter(Boolean);
    if (segments.length === 0) return { kind: "empty" };

    const [owner, repo] = segments;

    if (!NAME.test(owner)) {
        return { kind: "invalid", reason: "That doesn't look like a GitHub URL or username" };
    }

    if (segments.length === 1) {
        if (RESERVED_OWNERS.has(owner.toLowerCase())) {
            return { kind: "invalid", reason: "That's a GitHub page, not a user or repository" };
        }
        return { kind: "profile", username: owner, slug: owner };
    }

    if (!NAME.test(repo)) {
        return { kind: "invalid", reason: "That doesn't look like a GitHub URL or username" };
    }

    // Deeper paths (/tree/main/src, /blob/..., /pull/1) still identify the repo,
    // so anything past the second segment is simply ignored.
    return { kind: "repo", owner, repo, slug: `${owner}/${repo}` };
}

/**
 * Convenience wrapper for callers that only need the canonical string.
 * Returns null when the input is empty or unusable.
 */
export function normalizeGitHubInput(raw: string): string | null {
    const parsed = parseGitHubInput(raw);
    return parsed.kind === "repo" || parsed.kind === "profile" ? parsed.slug : null;
}
