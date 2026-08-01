"use client";

import { useEffect, useRef } from "react";
import { ADSENSE_CLIENT_ID, isAdSenseEnabled } from "@/lib/adsense";

declare global {
    interface Window {
        adsbygoogle?: Record<string, unknown>[];
    }
}

interface AdSlotProps {
    /** Ad unit ID from the AdSense dashboard (the data-ad-slot value, digits only). */
    slot: string;
    /** AdSense format hint. "auto" adapts to the container. */
    format?: "auto" | "fluid" | "rectangle" | "horizontal" | "vertical";
    /** Let the unit expand to the full container width on mobile. */
    responsive?: boolean;
    /**
     * Caption above the unit. AdSense requires ads to be distinguishable from
     * surrounding content; on content pages a neutral label is the usual way.
     */
    label?: string;
    className?: string;
    style?: React.CSSProperties;
}

/**
 * A single AdSense unit.
 *
 * Renders nothing when NEXT_PUBLIC_ADSENSE_CLIENT_ID is unset, so pages using it
 * stay clean in local development and in ad-free deployments.
 */
export default function AdSlot({
    slot,
    format = "auto",
    responsive = true,
    label,
    className = "",
    style,
}: AdSlotProps) {
    // An unconfigured publisher or unit ID means there is nothing to render.
    const enabled = isAdSenseEnabled && slot.length > 0;

    // AdSense throws "already have ads in them" if the same <ins> is pushed twice.
    // React Strict Mode remounts effects in development, so guard with a ref.
    const pushed = useRef(false);

    useEffect(() => {
        if (!enabled || pushed.current) return;
        pushed.current = true;

        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (error) {
            console.warn("AdSense slot failed to initialise (gracefully degrading):", error);
        }
    }, [enabled]);

    if (!enabled) return null;

    return (
        <div className={className}>
            {label && (
                <p className="text-[10px] uppercase tracking-[0.2em] text-foreground-muted mb-2 text-center">
                    {label}
                </p>
            )}
            <ins
                className="adsbygoogle"
                style={{ display: "block", ...style }}
                data-ad-client={ADSENSE_CLIENT_ID}
                data-ad-slot={slot}
                data-ad-format={format}
                data-full-width-responsive={responsive ? "true" : "false"}
            />
        </div>
    );
}
