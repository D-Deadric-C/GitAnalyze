import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_CLIENT_ID = "ca-pub-1234567890123456";

/** The publisher ID is captured at module load, so each case needs a fresh module graph. */
async function loadWithClientId(clientId: string) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_ADSENSE_CLIENT_ID", clientId);
    const [{ default: AdSlot }, route, lib] = await Promise.all([
        import("@/components/AdSlot"),
        import("@/app/ads.txt/route"),
        import("@/lib/adsense"),
    ]);
    return { AdSlot, route, lib };
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("AdSlot", () => {
    it("renders nothing when AdSense is unconfigured", async () => {
        const { AdSlot } = await loadWithClientId("");
        expect(renderToStaticMarkup(<AdSlot slot="9876543210" />)).toBe("");
    });

    it("ignores a malformed publisher ID rather than emitting a broken unit", async () => {
        const { AdSlot } = await loadWithClientId("pub-1234567890123456");
        expect(renderToStaticMarkup(<AdSlot slot="9876543210" />)).toBe("");
    });

    it("renders an ins unit carrying the publisher and slot IDs", async () => {
        const { AdSlot } = await loadWithClientId(TEST_CLIENT_ID);
        const html = renderToStaticMarkup(<AdSlot slot="9876543210" />);

        expect(html).toContain('class="adsbygoogle"');
        expect(html).toContain(`data-ad-client="${TEST_CLIENT_ID}"`);
        expect(html).toContain('data-ad-slot="9876543210"');
        expect(html).toContain('data-ad-format="auto"');
        expect(html).toContain('data-full-width-responsive="true"');
    });

    it("renders nothing when the unit ID is unset even if the publisher is configured", async () => {
        const { AdSlot } = await loadWithClientId(TEST_CLIENT_ID);
        expect(renderToStaticMarkup(<AdSlot slot="" />)).toBe("");
    });

    it("passes through format and responsive overrides", async () => {
        const { AdSlot } = await loadWithClientId(TEST_CLIENT_ID);
        const html = renderToStaticMarkup(
            <AdSlot slot="9876543210" format="rectangle" responsive={false} className="my-8" />
        );

        expect(html).toContain('data-ad-format="rectangle"');
        expect(html).toContain('data-full-width-responsive="false"');
        expect(html).toContain("my-8");
    });

    it("renders a label so the unit is distinguishable from content", async () => {
        const { AdSlot } = await loadWithClientId(TEST_CLIENT_ID);
        const html = renderToStaticMarkup(<AdSlot slot="9876543210" label="Advertisement" />);
        expect(html).toContain("Advertisement");
    });
});

describe("isAdSlotEnabled", () => {
    it("is false unless both the publisher and unit IDs are set", async () => {
        const unconfigured = await loadWithClientId("");
        expect(unconfigured.lib.isAdSlotEnabled("9876543210")).toBe(false);

        const configured = await loadWithClientId(TEST_CLIENT_ID);
        expect(configured.lib.isAdSlotEnabled("")).toBe(false);
        expect(configured.lib.isAdSlotEnabled("9876543210")).toBe(true);
    });
});

describe("/ads.txt", () => {
    it("404s while AdSense is unconfigured", async () => {
        const { route } = await loadWithClientId("");
        expect((await route.GET()).status).toBe(404);
    });

    it("serves the publisher line with the ca- prefix stripped", async () => {
        const { route } = await loadWithClientId(TEST_CLIENT_ID);
        const response = await route.GET();

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("text/plain");
        expect(await response.text()).toBe(
            "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n"
        );
    });
});
