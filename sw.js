/* Outfit Picker service worker — makes the app installable & fast.
 * Strategy: app shell = cache-first; Supabase/Drive data = network-first (always fresh). */
const CACHE_VERSION = 'outfit-picker-v6';
const APP_SHELL = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/config.js',
    '/js/app.js',
    '/js/sw-register.js',
    '/manifest.webmanifest',
    '/icons/icon.svg',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Never cache cloud/API calls — always go to the network for live data.
    if (url.hostname.endsWith('supabase.co') || url.hostname.includes('wa.me')) {
        return; // default browser behavior (network)
    }

    // Google Drive thumbnails: network-first with cache fallback (offline-friendly images).
    if (url.hostname.includes('googleapis.com') || url.hostname.includes('google.com')) {
        e.respondWith(
            fetch(e.request)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // App shell & static assets: cache-first, update in background.
    if (e.request.method === 'GET' && url.origin === self.location.origin) {
        e.respondWith(
            caches.match(e.request).then((cached) => {
                const fetched = fetch(e.request).then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
                    return res;
                }).catch(() => cached);
                return cached || fetched;
            })
        );
    }
});
