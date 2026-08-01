import Script from "next/script";
import { ADSENSE_CLIENT_ID, isAdSenseEnabled } from "@/lib/adsense";

/**
 * Loads the AdSense library once per page. Rendered from the root layout so every
 * route that mounts an <AdSlot /> already has the library available.
 *
 * Renders nothing when NEXT_PUBLIC_ADSENSE_CLIENT_ID is unset.
 */
export default function AdSenseScript() {
    if (!isAdSenseEnabled) return null;

    return (
        <Script
            id="adsbygoogle-init"
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
        />
    );
}
