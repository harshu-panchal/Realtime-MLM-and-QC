/* eslint-disable no-restricted-globals */
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "AIzaSyBh3H_NCAOKRtzEad5wSHpG0Z5J5yduWco",
  authDomain: "realtime-f6af4.firebaseapp.com",
  databaseURL: "https://realtime-f6af4-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "realtime-f6af4",
  storageBucket: "realtime-f6af4.firebasestorage.app",
  messagingSenderId: "616357118159",
  appId: "1:616357118159:web:59f67978af52882cfa37ba",
  measurementId: "G-RFNR676JP4",
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notificationTitle =
    payload?.notification?.title || payload?.data?.title || "Realtime Notification";
  const notificationOptions = {
    body: payload?.notification?.body || payload?.data?.body || "",
    icon: "/logo.png",
    badge: "/logo.png",
    image: payload?.notification?.image || payload?.data?.image || "/logo.png",
    tag: payload?.data?.orderId || payload?.data?.eventType || `rt_${Date.now()}`,
    data: {
      link: payload?.data?.link || payload?.fcmOptions?.link || "/",
      orderId: payload?.data?.orderId,
    },
    requireInteraction: true,
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.link || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
