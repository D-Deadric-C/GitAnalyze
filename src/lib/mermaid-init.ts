/**
 * Centralized Mermaid initialization
 * Light theme aligned with GitPulse app (cream background, black text, orange accent)
 *
 * Mermaid is ~500KB minified and is only needed once a diagram actually renders,
 * so it is loaded on demand. Callers must go through `getMermaid()` rather than
 * importing the package at module scope, otherwise it lands in the main bundle
 * for every visitor.
 */

type MermaidApi = (typeof import("mermaid"))["default"];
type MermaidConfig = Parameters<MermaidApi["initialize"]>[0];

const MERMAID_CONFIG: MermaidConfig = {
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    suppressErrorRendering: true,
    themeVariables: {
        primaryColor: '#FCFAF5',
        primaryTextColor: '#000000',
        primaryBorderColor: '#1f2937',
        lineColor: '#6b7280',
        secondaryColor: '#F0EDE8',
        tertiaryColor: '#F0EDE8',
        background: '#FCFAF5',
        mainBkg: '#FFFFFF',
        secondBkg: '#F0EDE8',
        border1: '#d1d5db',
        border2: '#9ca3af',
        arrowheadColor: '#374151',
        fontFamily: '"Iosevka Charon Mono", "Iosevka", ui-monospace, monospace',
    }
};

/** Cached so the chunk is fetched and initialized at most once per session. */
let mermaidPromise: Promise<MermaidApi> | null = null;

/**
 * Loads Mermaid on demand and applies the shared theme. Repeated calls reuse the
 * same in-flight or resolved promise.
 */
export function getMermaid(): Promise<MermaidApi> {
    if (!mermaidPromise) {
        mermaidPromise = import("mermaid").then((module) => {
            const mermaid = module.default;
            mermaid.initialize(MERMAID_CONFIG);
            return mermaid;
        });
    }
    return mermaidPromise;
}

/** Renders a diagram to SVG, loading Mermaid first if needed. */
export async function renderMermaidToSvg(code: string, id: string): Promise<string> {
    const mermaid = await getMermaid();
    const { svg } = await mermaid.render(id, code);
    return svg;
}
