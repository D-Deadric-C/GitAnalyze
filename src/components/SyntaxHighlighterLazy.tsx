"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

/**
 * react-syntax-highlighter plus its Prism theme is a large dependency that is
 * only needed once a fenced code block renders. Loading it through next/dynamic
 * keeps it out of the main bundle for visitors who never open a code block.
 *
 * The fallback matches the highlighted block's padding and background so the
 * layout does not shift when the real component arrives.
 */

interface Props {
    language: string;
    children: ReactNode;
}

const PLACEHOLDER_STYLE: React.CSSProperties = {
    margin: 0,
    padding: "1rem",
    background: "transparent",
    fontSize: "0.875rem",
    lineHeight: "1.5",
    whiteSpace: "pre",
    overflowX: "auto",
};

const Highlighter = dynamic(
    async () => {
        const [{ Prism }, { vscDarkPlus }] = await Promise.all([
            import("react-syntax-highlighter"),
            import("react-syntax-highlighter/dist/esm/styles/prism"),
        ]);

        function Inner({ language, children }: Props) {
            return (
                <Prism
                    language={language}
                    style={vscDarkPlus}
                    customStyle={{
                        margin: 0,
                        padding: "1rem",
                        background: "transparent",
                        fontSize: "0.875rem",
                        lineHeight: "1.5",
                        whiteSpace: "pre",
                    }}
                    wrapLines={false}
                    wrapLongLines={false}
                >
                    {String(children)}
                </Prism>
            );
        }

        return Inner;
    },
    {
        ssr: false,
        loading: () => <pre style={PLACEHOLDER_STYLE} />,
    },
);

export function LazySyntaxHighlighter({ language, children }: Props) {
    return <Highlighter language={language}>{children}</Highlighter>;
}
