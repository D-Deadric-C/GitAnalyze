import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
    return (
        <SafeAreaProvider>
            <StatusBar style="dark" />
            {/* The web app renders its own navigation, so the native header is hidden. */}
            <Stack screenOptions={{ headerShown: false }} />
        </SafeAreaProvider>
    );
}
