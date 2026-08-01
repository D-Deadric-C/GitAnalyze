/**
 * AdSense configuration.
 *
 * The publisher ID is read from NEXT_PUBLIC_ADSENSE_CLIENT_ID (format: "ca-pub-0000000000000000").
 * When it is unset every ad surface renders nothing, so local development and
 * self-hosted deployments stay ad-free without any code changes.
 */

export const ADSENSE_CLIENT_ID = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID ?? "";

export const isAdSenseEnabled = ADSENSE_CLIENT_ID.startsWith("ca-pub-");

/** Publisher ID without the "ca-" prefix, which is the form ads.txt expects. */
export const adsTxtPublisherId = ADSENSE_CLIENT_ID.replace(/^ca-/, "");

/**
 * Ad unit IDs, each created in the AdSense dashboard and supplied per placement.
 * A slot left unset disables just that placement.
 */
export const ADSENSE_SLOTS = {
    homepage: process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOMEPAGE ?? "",
} as const;

/**
 * Whether a given slot will actually render. Use this to drop surrounding layout
 * (section bands, dividers, spacing) that would otherwise show up empty.
 */
export function isAdSlotEnabled(slot: string): boolean {
    return isAdSenseEnabled && slot.length > 0;
}
