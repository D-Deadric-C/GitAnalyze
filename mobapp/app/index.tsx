/**
 * GitPulse mobile shell.
 *
 * Renders the deployed web app inside a WebView so the mobile client stays in
 * lockstep with the site - same UI, same features, same GitHub sign-in, no
 * backend changes. The native layer supplies the things a bare WebView lacks:
 * hardware back navigation, pull-to-refresh, offline handling and a branded
 * loading state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    BackHandler,
    Linking,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import NetInfo from "@react-native-community/netinfo";
import Constants from "expo-constants";

const APP_URL: string =
    (Constants.expoConfig?.extra?.apiBaseUrl as string) ||
    "https://gitpulse-web.yellowstone-745f9fa6.centralindia.azurecontainerapps.io";

/** Host the WebView owns. Anything else opens in the system browser. */
const APP_HOST = (() => {
    try {
        return new URL(APP_URL).host;
    } catch {
        return "";
    }
})();

const BRAND = {
    background: "#FCFAF5",
    foreground: "#000000",
    muted: "#5A5A5A",
    accent: "#DD9651",
    peach: "#F9C79A",
};

export default function AppShell() {
    const webViewRef = useRef<WebView>(null);
    const [loading, setLoading] = useState(true);
    const [canGoBack, setCanGoBack] = useState(false);
    const [online, setOnline] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener((state) => {
            setOnline(Boolean(state.isConnected));
        });
        return unsubscribe;
    }, []);

    // Hardware back navigates the web history before leaving the app.
    useEffect(() => {
        if (Platform.OS !== "android") return;
        const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
            if (canGoBack) {
                webViewRef.current?.goBack();
                return true;
            }
            return false;
        });
        return () => subscription.remove();
    }, [canGoBack]);

    const hasLoadedOnce = useRef(false);
    const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const hideOverlay = useCallback(() => {
        if (loadingTimer.current) {
            clearTimeout(loadingTimer.current);
            loadingTimer.current = null;
        }
        setLoading(false);
    }, []);

    /**
     * The overlay is only for the very first document load.
     *
     * The web app is a single-page app, so in-app navigation happens via the
     * History API. That fires onLoadStart without a matching onLoadEnd, which
     * previously left the overlay up forever. After the first load the site
     * renders its own loading states, so the native overlay is not needed.
     */
    const showOverlay = useCallback(() => {
        if (hasLoadedOnce.current) return;
        setLoading(true);
        if (loadingTimer.current) clearTimeout(loadingTimer.current);
        // Failsafe: never let the overlay outlive a genuinely slow first load.
        loadingTimer.current = setTimeout(() => setLoading(false), 20000);
    }, []);

    const markLoaded = useCallback(() => {
        hasLoadedOnce.current = true;
        hideOverlay();
    }, [hideOverlay]);

    useEffect(() => {
        return () => {
            if (loadingTimer.current) clearTimeout(loadingTimer.current);
        };
    }, []);

    const reload = useCallback(() => {
        setFailed(false);
        webViewRef.current?.reload();
    }, []);

    const onNavigationStateChange = useCallback(
        (event: WebViewNavigation) => {
            setCanGoBack(event.canGoBack);
            // Authoritative signal: fires for SPA navigations too, unlike onLoadEnd.
            if (!event.loading) markLoaded();
        },
        [markLoaded],
    );

    /**
     * Keeps in-app navigation inside the WebView but sends anything off-host to
     * the system browser. GitHub OAuth is deliberately allowed through, otherwise
     * sign-in would bounce out of the app and lose the session.
     */
    const onShouldStartLoadWithRequest = useCallback((request: { url: string }) => {
        try {
            const { host, protocol } = new URL(request.url);
            if (protocol !== "http:" && protocol !== "https:") return true;
            if (host === APP_HOST || host === "github.com" || host.endsWith(".github.com")) {
                return true;
            }
            Linking.openURL(request.url).catch(() => undefined);
            return false;
        } catch {
            return true;
        }
    }, []);

    if (!online) {
        return (
            <Message
                title="No connection"
                body="GitPulse needs an internet connection. Reconnect and pull down to retry."
                onRetry={reload}
            />
        );
    }

    if (failed) {
        return (
            <Message
                title="Couldn't load GitPulse"
                body="The server didn't respond. It may be starting up — try again in a moment."
                onRetry={reload}
            />
        );
    }

    return (
        <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
            <WebView
                ref={webViewRef}
                source={{ uri: APP_URL }}
                style={styles.webview}
                onNavigationStateChange={onNavigationStateChange}
                onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
                onLoadStart={showOverlay}
                onLoadEnd={markLoaded}
                onError={() => {
                    hideOverlay();
                    setFailed(true);
                }}
                // Fires when the page itself finishes; covers SPA route changes
                // that never produce an onLoadEnd.
                onLoadProgress={({ nativeEvent }) => {
                    if (nativeEvent.progress >= 1) markLoaded();
                }}
                // Sign-in depends on cookies surviving across requests and restarts.
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                domStorageEnabled
                javaScriptEnabled
                // Lets the page's own pull-to-refresh and scrolling feel native.
                pullToRefreshEnabled
                allowsBackForwardNavigationGestures
                startInLoadingState={false}
                setSupportMultipleWindows={false}
                renderLoading={() => <></>}
            />

            {loading ? (
                <View style={styles.overlay} pointerEvents="none">
                    <ActivityIndicator size="large" color={BRAND.accent} />
                    <Text style={styles.overlayText}>GitPulse</Text>
                </View>
            ) : null}
        </SafeAreaView>
    );
}

function Message({
    title,
    body,
    onRetry,
}: {
    title: string;
    body: string;
    onRetry: () => void;
}) {
    return (
        <SafeAreaView style={styles.root}>
            <ScrollView
                contentContainerStyle={styles.messageContent}
                refreshControl={<RefreshControl refreshing={false} onRefresh={onRetry} />}
            >
                <Text style={styles.messageTitle}>{title}</Text>
                <Text style={styles.messageBody}>{body}</Text>
                <Pressable
                    onPress={onRetry}
                    style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                >
                    <Text style={styles.buttonText}>Try again</Text>
                </Pressable>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BRAND.background },
    webview: { flex: 1, backgroundColor: BRAND.background },
    overlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: BRAND.background,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
    },
    overlayText: {
        fontFamily: "monospace",
        fontSize: 16,
        fontWeight: "700",
        color: BRAND.foreground,
        letterSpacing: 2,
    },
    messageContent: {
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        gap: 12,
    },
    messageTitle: {
        fontFamily: "monospace",
        fontSize: 22,
        fontWeight: "700",
        color: BRAND.foreground,
        textAlign: "center",
    },
    messageBody: {
        fontFamily: "monospace",
        fontSize: 14,
        color: BRAND.muted,
        textAlign: "center",
        marginBottom: 12,
    },
    button: {
        backgroundColor: BRAND.peach,
        borderWidth: 2,
        borderColor: BRAND.foreground,
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 28,
        shadowColor: "#000",
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 0,
        elevation: 4,
    },
    buttonPressed: {
        transform: [{ translateX: 2 }, { translateY: 2 }],
        shadowOffset: { width: 2, height: 2 },
    },
    buttonText: {
        fontFamily: "monospace",
        fontSize: 15,
        fontWeight: "700",
        color: BRAND.foreground,
    },
});
