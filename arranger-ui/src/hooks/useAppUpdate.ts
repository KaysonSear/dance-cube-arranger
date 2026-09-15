"use client";

import { useCallback, useEffect, useState } from "react";

import { APP_VERSION, type UpdateInfo } from "@/lib/version";

// 全局共享状态，避免多组件重复请求 GitHub API
let globalUpdateInfo: UpdateInfo | null = null;
let globalLoading = false;
let globalError: string | null = null;
let hasAutoChecked = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function useAppUpdate() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const updateState = () => setTick((t) => t + 1);
    listeners.add(updateState);
    return () => {
      listeners.delete(updateState);
    };
  }, []);

  const checkUpdate = useCallback(async (force = false, mockVersion?: string) => {
    globalLoading = true;
    globalError = null;
    notify();

    try {
      const url = new URL("/api/update/check", window.location.origin);
      if (force) url.searchParams.set("force", "1");
      if (mockVersion) url.searchParams.set("mockVersion", mockVersion);

      const res = await fetch(url.toString());
      const data = await res.json();

      if (!res.ok || !data.ok) {
        globalError = String(data.error ?? `请求失败 (${res.status})`);
      } else {
        globalUpdateInfo = data.update as UpdateInfo;
      }
    } catch (err) {
      globalError = (err as Error).message || "网络请求失败";
    } finally {
      globalLoading = false;
      notify();
    }
  }, []);

  // 启动时自动检查一次
  useEffect(() => {
    if (!hasAutoChecked) {
      hasAutoChecked = true;
      void checkUpdate(false);
    }
  }, [checkUpdate]);

  return {
    currentVersion: APP_VERSION,
    updateInfo: globalUpdateInfo,
    loading: globalLoading,
    error: globalError,
    hasUpdate: Boolean(globalUpdateInfo?.hasUpdate),
    latestVersion: globalUpdateInfo?.latestVersion ?? APP_VERSION,
    checkUpdate,
  };
}
