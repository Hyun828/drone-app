// 오프라인 지원 서비스워커.
// 정적 내보내기(out) 파일명이 해시라서 빌드 시점에 목록을 알 수 없으므로,
// 처음 접속할 때 실제로 요청되는 자원을 런타임에 캐시(cache-on-fetch)한다.
// 한 번 온라인으로 전체를 로드해두면 이후 완전 오프라인으로 동작한다.

const CACHE = "drone-app-v1";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 동일 출처만 처리

  // 페이지 이동(navigate): 캐시 우선 + 오프라인 시 index.html로 폴백
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req)
            .then((res) => {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
              return res;
            })
            .catch(() =>
              caches.match("./index.html").then((r) => r || caches.match("./"))
            )
      )
    );
    return;
  }

  // 정적 자원(JS/CSS/이미지 등): 캐시 우선, 없으면 네트워크에서 받아 즉시 캐시
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
