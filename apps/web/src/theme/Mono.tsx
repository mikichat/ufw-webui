import type { CSSProperties } from "react";
import { monoStyle } from "./tokens";

type MonoProps = {
  children: React.ReactNode;
  as?: keyof React.JSX.IntrinsicElements;
  style?: CSSProperties;
  // inline span 외에 block 으로 쓰고 싶을 때.
  block?: boolean;
};

// 모노스페이스 wrapper. UFW 의 포트/IP/매니페스트/시각 같은 기계적 정보에
// 일관되게 적용하기 위한 짧은 컴포넌트. styled-components / emotion 없이
// CSSProperties 주입 방식 — antd v5 css-in-js 와 충돌하지 않는다.
export const Mono = ({ children, as, style, block }: MonoProps) => {
  const merged: CSSProperties = {
    ...monoStyle,
    ...(block ? { display: "block" } : {}),
    ...style,
  };
  const Tag = (as ?? "span") as keyof React.JSX.IntrinsicElements;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Component = Tag as any;
  return <Component style={merged}>{children}</Component>;
};