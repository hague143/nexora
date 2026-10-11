/* Nexora service worker — offline shell + safe update behavior.
 * - Navigations: network-first, fall back to cached app shell (SPA).
 * - Static assets (hashed js/css/img): stale-while-revalidate.
 * - /api/*: network only — never cache API responses.
 */
const VERSION = 'nexora-v1'
const SHELL = ['/app', '/offline.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // API: always live, never cached.
  if (url.pathname.startsWith('/api/')) return

  // Navigations: try network, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((cache) => cache.put('/app', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/app').then((r) => r || caches.match('/offline.html')))
    )
    return
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const live = fetch(request).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone()
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {})
        }
        return res
      }).catch(() => cached)
      return cached || live
    })
  )
})
