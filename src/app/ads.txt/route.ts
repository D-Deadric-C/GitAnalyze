import { adsTxtPublisherId, isAdSenseEnabled } from "@/lib/adsense";

/**
 * Serves /ads.txt from the configured publisher ID rather than a checked-in file,
 * so the ID lives in exactly one place (NEXT_PUBLIC_ADSENSE_CLIENT_ID).
 *
 * AdSense requires this file to be reachable at the domain root before it will
 * serve ads. Returns 404 while AdSense is unconfigured.
 */
export const dynamic = "force-static";

export async function GET() {
    if (!isAdSenseEnabled) {
        return new Response("Not found", { status: 404 });
    }

    return new Response(`google.com, ${adsTxtPublisherId}, DIRECT, f08c47fec0942fa0\n`, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
        },
    });
}
