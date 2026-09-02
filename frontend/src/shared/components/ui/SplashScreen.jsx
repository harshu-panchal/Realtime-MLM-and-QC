import React, { useState, useEffect } from 'react';
import { useSettings } from '@core/context/SettingsContext';
import DefaultLogo from '@/assets/DefaultLogo.svg';

function getContrastColor(hex) {
    if (typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) return '#FFFFFF';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 160 ? '#000000' : '#FFFFFF';
}

const SplashScreen = ({ children }) => {
    const { settings } = useSettings();
    const [showSplash, setShowSplash] = useState(true);

    useEffect(() => {
        // Only show once per session
        const hasSeenSplash = sessionStorage.getItem('hasSeenSplash');

        // We also want to check if it's mobile view. A simple check:
        const isMobile = window.innerWidth <= 768;

        if (hasSeenSplash || !isMobile) {
            setShowSplash(false);
            return;
        }

        const timer = setTimeout(() => {
            setShowSplash(false);
            sessionStorage.setItem('hasSeenSplash', 'true');
        }, 4000); // 4 seconds

        return () => clearTimeout(timer);
    }, []);

    if (showSplash) {
        const isDelivery = window.location.pathname.startsWith('/delivery');
        const customImage = isDelivery ? settings?.deliverySplashImage : settings?.customerSplashImage;

        // Admin-uploaded splash image takes priority over the generated fallback below.
        if (customImage) {
            return (
                <div className="fixed inset-0 z-[9999] bg-white flex items-center justify-center overflow-hidden lg:hidden">
                    <img
                        src={customImage}
                        alt="App Init"
                        className="w-full h-full object-cover"
                    />
                </div>
            );
        }

        // Fallback: generate the splash from live branding (logo/app name/color)
        // instead of a static pre-branded image, so it stays correct with no upload needed.
        const appName = settings?.appName || 'App';
        const bgColor = settings?.primaryColor?.startsWith('#') ? settings.primaryColor : '#0ea5e9';
        const textColor = getContrastColor(bgColor);

        return (
            <div
                className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 overflow-hidden lg:hidden px-8"
                style={{ backgroundColor: bgColor }}
            >
                <img
                    src={settings?.logoUrl || DefaultLogo}
                    alt={`${appName} Logo`}
                    className="h-24 w-auto object-contain"
                />
                <span
                    className="text-2xl font-black tracking-tight text-center"
                    style={{ color: textColor }}
                >
                    {appName}
                </span>
            </div>
        );
    }

    return children;
};

export default SplashScreen;
