import type { CSSProperties } from "react";
import { theme as antdTheme, type ThemeConfig } from "antd";

// ── Industrial · 터미널 미학 ────────────────────────────────────────────
// UFW CLI 와 정체성을 맞추기 위한 디자인 토큰. antd v5 의 default / dark
// 알고리즘 위에 토큰만 입혀서 컴포넌트 코드 변경을 최소화한다.
// 색상 팔레트는 채도 낮춘 cool 톤 — 명도 대비로 위계 표현.

const FONT_STACK = `'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`;
const MONO_STACK = `'JetBrains Mono', ui-monospace, 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', monospace`;

const sharedComponents: ThemeConfig["components"] = {
  Tag: {
    fontFamily: MONO_STACK,
    // 작은 대문자 라벨처럼 보이도록 letter-spacing
    defaultBg: "transparent",
    defaultColor: "inherit",
  },
  Typography: {
    titleMarginBottom: 12,
    titleMarginTop: 0,
    fontFamily: FONT_STACK,
  },
  Table: {
    headerBg: "transparent",
    headerSplitColor: "transparent",
    fontFamily: FONT_STACK,
  },
  Card: {
    headerBg: "transparent",
  },
  Button: {
    fontFamily: FONT_STACK,
  },
  Input: {
    fontFamily: FONT_STACK,
  },
  Layout: {
    headerBg: "transparent",
    bodyBg: "transparent",
    footerBg: "transparent",
  },
};

export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: "#0F766E", // teal-700
    colorSuccess: "#15803D", // green-700
    colorError: "#B91C1C", // red-700
    colorWarning: "#B45309", // amber-700
    colorInfo: "#0F766E",

    colorBgLayout: "#F4F5F7", // cool gray-50
    colorBgContainer: "#FFFFFF",
    colorBgElevated: "#FFFFFF",
    colorBorder: "#E5E7EB", // gray-200
    colorBorderSecondary: "#F1F5F9",

    colorText: "#0F172A", // slate-900
    colorTextSecondary: "#475569", // slate-600
    colorTextTertiary: "#64748B",
    colorTextQuaternary: "#94A3B8",

    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,

    fontFamily: FONT_STACK,
    fontFamilyCode: MONO_STACK,
    fontSize: 14,
    lineHeight: 1.5,

    // 컴포넌트 전체 hairline 위주, 그림자는 절제
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
    boxShadowSecondary: "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.06)",
  },
  components: sharedComponents,
};

export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: "#2DD4BF", // teal-400 (다크에서 더 밝게)
    colorSuccess: "#4ADE80", // green-400
    colorError: "#F87171", // red-400
    colorWarning: "#FBBF24", // amber-400
    colorInfo: "#2DD4BF",

    colorBgLayout: "#0B1120", // slate-950 — 약간 푸른빛
    colorBgContainer: "#111827", // slate-900
    colorBgElevated: "#1E293B", // slate-800
    colorBorder: "#1F2937", // slate-800
    colorBorderSecondary: "#1E293B",

    colorText: "#E2E8F0", // slate-200
    colorTextSecondary: "#94A3B8", // slate-400
    colorTextTertiary: "#64748B",
    colorTextQuaternary: "#475569",

    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,

    fontFamily: FONT_STACK,
    fontFamilyCode: MONO_STACK,
    fontSize: 14,
    lineHeight: 1.5,

    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.2)",
    boxShadowSecondary: "0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.4)",
  },
  components: sharedComponents,
};

// 디자인 토큰에서 파생된 모노스페이스 + 라벨 헬퍼.
export const monoFontFamily = MONO_STACK;
export const fontFamily = FONT_STACK;

// 작은 대문자 라벨 (예: "STATUS:", "POLICY:")에 쓰는 inline 스타일.
// letter-spacing 을 antd Tag 와 구분하기 위해 별도 정의.
export const labelStyle: CSSProperties = {
  fontFamily: MONO_STACK,
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ant-color-text-tertiary)",
};

// 모노스페이스가 필요한 모든 곳 (포트/IP/매니페스트/파일명/시각) 에
// style={monoStyle} 로 바로 쓸 수 있도록 노출.
export const monoStyle: CSSProperties = {
  fontFamily: MONO_STACK,
  fontVariantNumeric: "tabular-nums",
};

export type ColorScheme = "light" | "dark";