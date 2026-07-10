import { Button, Dropdown } from "antd";
import type { MenuProps } from "antd";
import type { ColorSchemeMode } from "../hooks/useColorScheme";

type Props = {
  mode: ColorSchemeMode;
  onChange: (next: ColorSchemeMode) => void;
};

// Industrial 미학 — 이모지 / 아이콘 라이브러리 대신 유니코드 심볼.
//   ⌬ 시스템 (시스템 설정 추적)
//   ☀ 라이트
//   ☾ 다크
const LABELS: Record<ColorSchemeMode, string> = {
  system: "시스템",
  light: "라이트",
  dark: "다크",
};

const ICONS: Record<ColorSchemeMode, string> = {
  system: "⌬",
  light: "☀",
  dark: "☾",
};

const ITEM_LABELS: Record<ColorSchemeMode, string> = {
  system: "⌬  시스템 설정",
  light: "☀  라이트",
  dark: "☾  다크",
};

export const ThemeToggle = ({ mode, onChange }: Props) => {
  const items: MenuProps["items"] = (["system", "light", "dark"] as const).map(
    (k) => ({
      key: k,
      label: ITEM_LABELS[k],
    }),
  );

  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items,
        selectedKeys: [mode],
        onClick: ({ key }) => onChange(key as ColorSchemeMode),
      }}
    >
      <Button size="small" style={{ fontFamily: "JetBrains Mono, ui-monospace, monospace" }}>
        {ICONS[mode]} {LABELS[mode]} ▾
      </Button>
    </Dropdown>
  );
};

export default ThemeToggle;