import { isSupported, getMessaging, getToken, onMessage } from "firebase/messaging";
import { getFirebaseApp } from "./client";
import axiosInstance from "@core/api/axios";
import AppZetoBridge from "../../lib/appZetoBridge";
import { rawGet, rawSet, rawRemove, KEY_PREFIXES } from "@core/utils/storage";

let foregroundListenerStarted = false;
let foregroundUnsubscribe = null;
const GESTURE_EVENTS = ["pointerdown", "touchstart", "click", "keydown"];
const gestureHandlers = new Map();

function registeredKey(role = "customer") {
  return `${KEY_PREFIXES.PUSH_REGISTERED}${String(role || "customer").toLowerCase()}`;
}

function tokenKey(role = "customer") {
  return `${KEY_PREFIXES.PUSH_FCM_TOKEN}${String(role || "customer").toLowerCase()}`;
}

export function hasRegisteredFcmToken(role = "customer") {
  return rawGet(registeredKey(role), { storage: "session" }) === "1";
}

export function getStoredFcmToken(role = "customer") {
  return rawGet(tokenKey(role)) || "";
}

export function clearStoredFcmToken(role = "customer") {
  rawRemove(tokenKey(role));
  rawRemove(registeredKey(role), { storage: "session" });
}

function persistStoredFcmToken(role = "customer", token = "") {
  if (!token) return;
  rawSet(tokenKey(role), token);
  rawSet(registeredKey(role), "1", { storage: "session" });
}

export function describePushSupport() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { supported: false, reason: "no-window" };
  }

  if (!window.isSecureContext) {
    return { supported: false, reason: "insecure-context" };
  }

  const ua = String(navigator.userAgent || "");
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true;

  if (isIOS && isSafari && !isStandalone) {
    return {
      supported: false,
      reason: "ios-safari-not-standalone",
      message: "On iPhone/iPad Safari, push notifications work only after installing the app to Home Screen.",
    };
  }

  if (window.Flutter) {
    return { supported: true, reason: "flutter-native" };
  }

  return { supported: true, reason: "ok" };
}

async function ensureServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser");
  }
  const swUrl = "/firebase-messaging-sw.js";

  // Detect broken SPA hosting rewrites where SW URL serves index.html.
  try {
    const swResponse = await fetch(swUrl, { cache: "no-store" });
    if (!swResponse.ok) {
      throw new Error(`Service worker script not reachable (${swResponse.status})`);
    }
    const contentType = String(swResponse.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html")) {
      throw new Error(
        "Service worker URL returned HTML. Check production rewrites and exclude /firebase-messaging-sw.js from SPA fallback.",
      );
    }
  } catch (error) {
    throw new Error(error?.message || "Unable to validate service worker script");
  }

  // Must be at site root for FCM web push.
  const registration = await navigator.serviceWorker.register(swUrl, {
    updateViaCache: "none",
  });
  await registration.update();
  await navigator.serviceWorker.ready;
  return registration;
}

async function showSystemNotification({ title, body, data } = {}) {
  const safeTitle = String(title || "Realtime Notification");
  const safeBody = String(body || "");
  const link = data?.link || "/";
  const tag = data?.orderId || data?.eventType || `rt_${Date.now()}`;
  const icon = "/logo.png";
  const image = String(data?.image || data?.imageUrl || "").trim() || "/logo.png";

  // Prefer SW notifications so they land in the OS notification center consistently.
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg?.showNotification) {
      await reg.showNotification(safeTitle, {
        body: safeBody,
        tag,
        icon,
        badge: icon,
        requireInteraction: true,
        renotify: true,
        image,
        data: {
          link,
          orderId: data?.orderId || "",
          eventType: data?.eventType || "",
          image,
        },
      });
      return;
    }
  } catch {
    // fallback below
  }

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(safeTitle, {
      body: safeBody,
      tag,
      icon,
      badge: icon,
      requireInteraction: true,
      renotify: true,
      image,
      data: {
        link,
        orderId: data?.orderId || "",
        eventType: data?.eventType || "",
        image,
      },
    });
  }
}

export async function ensureFcmTokenRegistered({
  role = "customer",
  platform = "web",
  device = "",
} = {}) {
  const support = describePushSupport();
  if (!support.supported) {
    throw new Error(support.message || `Push unsupported: ${support.reason}`);
  }

  if (!window.Flutter) {
    const supported = await isSupported().catch(() => false);
    if (!supported) {
      throw new Error("Firebase Messaging is not supported in this environment");
    }
  }

  let token = "";

  if (window.Flutter) {
    // Get token from Flutter native layer
    token = await AppZetoBridge.getFcmToken();
    if (!token) {
      throw new Error("Failed to obtain native FCM token from Flutter");
    }
    // Set platform to 'app' to match backend validation (instead of android/ios)
    platform = "app";
  } else {
    const app = getFirebaseApp();
    if (!app) {
      throw new Error("Firebase is not configured (missing VITE_FIREBASE_* env)");
    }

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      throw new Error("Missing VITE_FIREBASE_VAPID_KEY");
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Notification permission not granted");
    }

    const swRegistration = await ensureServiceWorkerRegistration();
    const messaging = getMessaging(app);

    const deleteDbAsync = (dbName) => {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.deleteDatabase(dbName);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
          req.onblocked = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    };

    const fetchTokenSafe = async () => {
      try {
        return await getToken(messaging, { vapidKey, serviceWorkerRegistration: swRegistration });
      } catch (tokenErr) {
        if (
          tokenErr?.message?.includes("less than the existing version") ||
          tokenErr?.message?.includes("VersionError")
        ) {
          console.warn("[push] Purging stale IndexedDB databases due to version conflict...");
          
          await deleteDbAsync("fcm_token_details_db");
          await deleteDbAsync("firebase-messaging-database");
          await deleteDbAsync("firebase-installations-database");
          await deleteDbAsync("firebaseInstallations");

          if (typeof indexedDB !== "undefined" && indexedDB.databases) {
            try {
              const dbs = await indexedDB.databases();
              for (const db of dbs) {
                if (
                  db.name &&
                  (db.name.includes("fcm") ||
                    db.name.includes("firebase") ||
                    db.name.includes("messaging"))
                ) {
                  await deleteDbAsync(db.name);
                }
              }
            } catch {
              // ignore
            }
          }

          // Small delay so indexedDB release completes
          await new Promise((r) => setTimeout(r, 200));

          // Retry
          return await getToken(messaging, { vapidKey, serviceWorkerRegistration: swRegistration });
        }
        throw tokenErr;
      }
    };

    token = await fetchTokenSafe();
    if (!token) {
      throw new Error("Failed to obtain FCM token");
    }
  }

  // Explicitly log FCM Token in Browser Console for debugging
  console.log("🔥 [FCM TOKEN GENERATED]:", token);
  console.log("📱 [FCM Platform]:", platform, "| Role:", role);

  // Register centrally with platform and device
  await axiosInstance.post("/push/register", {
    token,
    platform,
    device: device || navigator.userAgent,
  });

  // Also notify role endpoint if applicable (e.g. /customer/fcm-token, /seller/fcm-token, /delivery/fcm-token)
  try {
    const roleEndpoint = `/${String(role).toLowerCase()}/fcm-token`;
    await axiosInstance.post(roleEndpoint, {
      token,
      platform,
    });
  } catch (ignored) {
    // best-effort
  }

  persistStoredFcmToken(role, token);
  return token;
}

export function scheduleFcmRegistrationOnUserGesture({
  role = "customer",
  platform = "web",
  device = "",
  onSuccess,
  onError,
} = {}) {
  if (typeof window === "undefined") return () => {};
  const key = String(role || "customer").toLowerCase();

  // Avoid duplicate listener stacks for the same role.
  const existingCleanup = gestureHandlers.get(key);
  if (existingCleanup) {
    return existingCleanup;
  }

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    for (const eventName of GESTURE_EVENTS) {
      window.removeEventListener(eventName, handler, true);
    }
    gestureHandlers.delete(key);
  };

  const handler = async () => {
    remove();
    try {
      const token = await ensureFcmTokenRegistered({ role: key, platform, device });
      if (typeof onSuccess === "function") onSuccess(token);
    } catch (error) {
      if (typeof onError === "function") onError(error);
    }
  };

  for (const eventName of GESTURE_EVENTS) {
    window.addEventListener(eventName, handler, { capture: true, once: true, passive: true });
  }

  gestureHandlers.set(key, remove);
  return remove;
}

export async function removeStoredFcmToken({
  role = "customer",
  token = "",
} = {}) {
  const candidateToken = String(token || getStoredFcmToken(role) || "").trim();
  if (!candidateToken) {
    clearStoredFcmToken(role);
    return false;
  }

  await axiosInstance.delete("/push/remove", {
    data: {
      token: candidateToken,
    },
  });

  clearStoredFcmToken(role);
  return true;
}

export async function startForegroundPushListener() {
  if (foregroundListenerStarted && foregroundUnsubscribe) {
    return foregroundUnsubscribe;
  }

  if (!window.Flutter) {
    const supported = await isSupported().catch(() => false);
    if (!supported) return () => {};
  }

  const app = getFirebaseApp();
  if (!app && !window.Flutter) return () => {};

  // If in Flutter, the native app handles foreground notifications, 
  // but we can still return a dummy unsubscribe.
  if (window.Flutter) {
    return () => {};
  }

  // Ensure SW exists (helps with consistent notification center behavior).
  try {
    await ensureServiceWorkerRegistration();
  } catch {
    // ignore
  }

  const messaging = getMessaging(app);
  const unsubscribe = onMessage(messaging, async (payload) => {
    const title =
      payload?.notification?.title || payload?.data?.title || "Notification";
    const body =
      payload?.notification?.body || payload?.data?.body || "";
    await showSystemNotification({
      title,
      body,
      data: payload?.data || {},
    });
  });

  foregroundListenerStarted = true;
  foregroundUnsubscribe = unsubscribe;
  return unsubscribe;
}

export default {
  describePushSupport,
  clearStoredFcmToken,
  ensureFcmTokenRegistered,
  getStoredFcmToken,
  hasRegisteredFcmToken,
  removeStoredFcmToken,
  scheduleFcmRegistrationOnUserGesture,
  startForegroundPushListener,
};
