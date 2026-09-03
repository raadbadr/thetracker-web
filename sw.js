/* TRACKER — تخزين مؤقت للتصفح دون اتصال (نفس أصل الموقع فقط) */
const CACHE_NAME = "tracker-offline-v1";

const PRECACHE_URLS = [
  "./index.html",
  "./about.html",
  "./privacy.html",
  "./terms.html",
  "./pricing.html",
  "./header.css",
  "./footer.css",
  "./rial-symbol.png",
  "./Monoton-Regular.ttf",
  "./tracker-logo-dark.png",
  "./tracker-logo-light.png",
  "./robots.txt",
  "./sitemap.xml",
  "./login.html",
  "./logo.png",
  "./404.html"
];

function scopeBase() {
  return self.registration.scope;
}

function isDocumentRequest(request, url) {
  if (request.mode === "navigate") return true;
  const p = url.pathname;
  if (p.endsWith(".html")) return true;
  if (p === "/" || p.endsWith("/")) return true;
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((path) =>
            cache.add(new URL(path, scopeBase()).href).catch(() => {})
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* بيانات حية (خريطة النمو، أرقام المنصة): لا تُعترض إطلاقاً.
     الكاش-أولا هنا جمّد المواقف والمنشآت الجديدة على أجهزة الزوار. */
  if (url.pathname.startsWith("/api/")) return;

  /* صفحات HTML + CSS/JS: الشبكة أولاً حتى تصل التحديثات فوراً —
     الكاش-أولا هنا جمّد تعديلات footer.css على أجهزة الزوار */
  const p = url.pathname;
  const isFreshAsset = p.endsWith(".css") || p.endsWith(".js") || p.endsWith(".webmanifest");
  if (isDocumentRequest(request, url) || isFreshAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached;
            /* سقوط index.html للمستندات فقط — لا يصلح بديلاً لأصل CSS/JS */
            if (isFreshAsset) return Response.error();
            return caches.match(new URL("./index.html", scopeBase()).href);
          })
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => Promise.resolve());
    })
  );
});
