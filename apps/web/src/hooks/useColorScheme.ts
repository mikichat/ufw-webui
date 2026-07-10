import { useCallback, useEffect, useState } from "react";
import type { ColorScheme } from "../theme/tokens";

export type ColorSchemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "ufw-color-scheme";

// SSR / 첫 렌더 시 localStorage 가 비어 있어 항상 system 으로 시작하면
// 다크모드 사용자가 라이트로 한 번 깜빡인 다음 어두워진다. 이를 막기 위해
// index.html 에서 inline 으로 <html data-theme="dark"> 부트스트랩 예정.
const readStoredMode = (): ColorSchemeMode => {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
};

const readSystemScheme = (): ColorScheme => {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

export type UseColorSchemeResult = {
  mode: ColorSchemeMode;
  resolved: ColorScheme;
  setMode: (next: ColorSchemeMode) => void;
  // mode 가 "system" 일 때만 의미 있는 값. UI 의 인디케이터 등에 활용.
  isSystem: boolean;
};

export const useColorScheme = (): UseColorSchemeResult => {
  const [mode, setModeState] = useState<ColorSchemeMode>(readStoredMode);
  const [systemScheme, setSystemScheme] = useState<ColorScheme>(readSystemScheme);

  // 시스템 추적: mode === "system" 일 때만 media query 변화 반영.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      setSystemScheme(e.matches ? "dark" : "light");
    };
    // Safari < 14 는 addEventListener 가 없어서 addListener fallback
    if (mq.addEventListener) {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const setMode = useCallback((next: ColorSchemeMode) => {
    setModeState(next);
    if (typeof window !== "undefined") {
      if (next === "system") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
      // <html data-theme="..."> 동기화 — CSS 변수나 inline style 의 기반이 됨
      // (현재는 antd ConfigProvider 만 토큰으로 전환하지만 향후 확장 여지).
      document.documentElement.dataset.theme = next === "system" ? "" : next;
    }
  }, []);

  // 첫 마운트 시 <html data-theme> 동기화 (새로고침 직후 깜빡임 방지)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const initial = readStoredMode();
    document.documentElement.dataset.theme = initial === "system" ? "" : initial;
  }, []);

  const resolved: ColorScheme = mode === "system" ? systemScheme : mode;

  return {
    mode,
    resolved,
    setMode,
    isSystem: mode === "system",
  };
};