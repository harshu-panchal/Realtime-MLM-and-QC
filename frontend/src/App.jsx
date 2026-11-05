import { Suspense, useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import AppRouter from '@core/routes/AppRouter';
import { AuthProvider } from '@core/context/AuthContext';
import { SettingsProvider } from '@core/context/SettingsContext';
import { SupportUnreadProvider } from '@core/context/SupportUnreadContext';
import { LanguageProvider } from '@core/context/LanguageContext';
import SeoHead from '@core/components/SeoHead';
import { ToastProvider } from './shared/components/ui/Toast';
import Loader from './shared/components/ui/Loader';
import ErrorBoundary from './shared/components/ErrorBoundary';
import LenisScroll from './shared/components/LenisScroll';
import SplashScreen from './shared/components/ui/SplashScreen';

function App() {
    useEffect(() => {
        // Setup hardware back button listener for Android apps
        const setupBackButton = async () => {
            try {
                await CapacitorApp.addListener('backButton', ({ canGoBack }) => {
                    if (canGoBack) {
                        window.history.back();
                    } else {
                        CapacitorApp.exitApp();
                    }
                });
            } catch (err) {
                // Ignore errors if running in a standard web browser (not capacitor)
            }
        };
        setupBackButton();

        // Native app: if the WebView draws behind the system nav bar but reports
        // no safe-area inset, flag it so the bottom nav gets pushed above it.
        let insetTimer;
        const checkBottomInset = () => {
            if (!Capacitor.isNativePlatform()) return;
            const probe = document.createElement('div');
            probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-bottom:max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px));';
            document.body.appendChild(probe);
            const inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
            probe.remove();
            document.documentElement.classList.toggle('native-no-bottom-inset', inset === 0);
        };
        checkBottomInset();
        insetTimer = setTimeout(checkBottomInset, 800); // insets can arrive after first paint
        window.addEventListener('resize', checkBottomInset);

        return () => {
            clearTimeout(insetTimer);
            window.removeEventListener('resize', checkBottomInset);
            try {
                CapacitorApp.removeAllListeners();
            } catch (err) {}
        };
    }, []);

    return (
        <ErrorBoundary>
            <AuthProvider>
                <LanguageProvider>
                    <SettingsProvider>
                        <SeoHead />
                        <ToastProvider>
                            <Suspense fallback={<Loader fullScreen />}>
                                <SupportUnreadProvider>
                                    <LenisScroll />
                                    <SplashScreen>
                                        <AppRouter />
                                    </SplashScreen>
                                </SupportUnreadProvider>
                            </Suspense>
                        </ToastProvider>
                    </SettingsProvider>
                </LanguageProvider>
            </AuthProvider>
        </ErrorBoundary>
    );
}

export default App;
