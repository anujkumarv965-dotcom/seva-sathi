// firebase-messaging-sw.js
// This service worker handles background messages from Firebase Cloud Messaging (FCM).

importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyCjgaTzSx3C6z1eWH4xRAGiHIwVYiRgfrM",
  authDomain: "seva-sathi-49ab3.firebaseapp.com",
  projectId: "seva-sathi-49ab3",
  storageBucket: "seva-sathi-49ab3.firebasestorage.app",
  messagingSenderId: "517044329871",
  appId: "1:517044329871:web:613c1c3cfb6a62dfa37ffa"
};

firebase.initializeApp(firebaseConfig);

// Retrieve firebase messaging
const messaging = firebase.messaging();

// Background message handler for compat
// This is called when the web app is in the background (or closed) and FCM pushes a message.
messaging.setBackgroundMessageHandler(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  // Customize notification here
  const notification = payload.notification || {};
  const title = notification.title || payload.data?.title || 'Seva Sathi';
  const options = {
    body: notification.body || payload.data?.body || '',
    icon: notification.icon || '/icons/icon-192.png',
    data: payload.data || {}
  };
  return self.registration.showNotification(title, options);
});

// Handle notificationclick in the FCM SW as well
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const urlToOpen = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  event.waitUntil(
    clients.matchAll({type: 'window', includeUncontrolled: true}).then(windowClients => {
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});