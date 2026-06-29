"use client";

import { useEffect } from "react";

export default function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const isProd = process.env.NODE_ENV === "production";

    // 개발 서버(npm run dev)에서는 서비스 워커가 "캐시 우선"으로 옛 HTML/청크를
    // 내어주어 3D 씬·버튼이 깨진다. 그래서 dev에서는 등록하지 않고,
    // 과거에 등록된 워커와 캐시를 모두 제거한다.
    if (!isProd) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((reg) => reg.unregister()))
        .catch(() => {});
      if (window.caches?.keys) {
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .catch(() => {});
      }
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
