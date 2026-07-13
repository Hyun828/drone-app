"use client";

import { useEffect } from "react";

function clearServiceWorkersAndCaches() {
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
}

export default function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const isProd = process.env.NODE_ENV === "production";
    const host = window.location.hostname;
    const isLocalRunner =
      host === "localhost" || host === "127.0.0.1" || host === "[::1]";

    // dev 서버, USB 로컬 실행(run.bat)에서는 서비스 워커가 옛 HTML/청크를
    // 캐시 우선으로 내어 3D 씬·버튼이 깨진다. 등록하지 않고 기존 캐시를 제거한다.
    if (!isProd || isLocalRunner) {
      clearServiceWorkersAndCaches();
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
