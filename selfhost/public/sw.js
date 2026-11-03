// SPDX-License-Identifier: GPL-3.0-or-later
// Keeps the app shell available so spur opens instantly and installs as an
// app. Runs and settings always come live from the server (/api is never cached).
const CACHE = 'spur-shell-v1';
const SHELL = [
  '/',
  '/app.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/favicon.svg',
  '/fonts/barlow-400.woff2',
  '/fonts/barlow-600.woff2',
  '/fonts/barlow-condensed-700.woff2',
  '/fonts/barlow-condensed-800.woff2',
  '/fonts/barlow-condensed-800-italic.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  // Network first, so updates show up straight away; the cache covers offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request.mode === 'navigate' ? '/' : e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request.mode === 'navigate' ? '/' : e.request)),
  );
});
