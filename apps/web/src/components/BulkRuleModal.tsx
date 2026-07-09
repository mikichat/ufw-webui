import { useMemo, useState } from "react";
import { Alert, Input, Modal, Radio, Space, Tag, Typography, message } from "antd";
import type { BulkAction, BulkMode, BulkRequest } from "../services/api";
import { apiBulkRules } from "../services/api";

const { Text } = Typography;

type Props = {
  open: boolean;
  onClose: () => void;
  onApplied: () => void | Promise<void>;
};

const EXAMPLE_LINES = [
  "10.0.0.0/8,22/tcp,내부 SSH",
  "192.168.0.0/16,80/tcp,내부 웹",
  ",443/tcp,모든 곳 HTTPS",
];

type ParsedLine = {
  raw: string;
  from: string;
  to: string;
  note: string;
  valid: boolean;
  reason?: string;
};

// 한 줄 파싱: `from,to,note` 형식. 쉼표는 최대 2개. 각 컬럼 trim.
// # 로 시작하거나 빈 줄은 무시.
const parseLine = (raw: string): ParsedLine | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;
  const parts = trimmed.split(",").map((p) => p.trim());
  const from = parts[0] ?? "";
  const to = parts[1] ?? "";
  const note = parts[2] ?? "";
  const valid = from.length > 0 || to.length > 0;
  return {
    raw: trimmed,
    from,
    to,
    note,
    valid,
    reason: valid ? undefined : "from 또는 to 중 하나는 필요합니다",
  };
};

const parseAll = (text: string): { parsed: ParsedLine[]; valid: ParsedLine[] } => {
  const lines = text.split("\n");
  const parsed: ParsedLine[] = [];
  for (const line of lines) {
    const p = parseLine(line);
    if (p) parsed.push(p);
  }
  return { parsed, valid: parsed.filter((p) => p.valid) };
};

function BulkRuleModal({ open, onClose, onApplied }: Props) {
  const [text, setText] = useState<string>(EXAMPLE_LINES.join("\n"));
  const [mode, setMode] = useState<BulkMode>("monitor");
  const [action, setAction] = useState<BulkAction>("add");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{
    applied: number;
    total: number;
    errors: string[];
  } | null>(null);

  const { parsed, valid } = useMemo(() => parseAll(text), [text]);
  const skipped = parsed.length - valid.length;

  const submit = async () => {
    if (valid.length === 0) {
      message.warning("입력된 규칙이 없습니다 (최소 1줄 필요).");
      return;
    }
    setSubmitting(true);
    try {
      const body: BulkRequest = {
        mode,
        action,
        rules: valid.map((p) => ({
          from: p.from,
          to: p.to,
          note: p.note || undefined,
        })),
      };
      const response = await apiBulkRules(body);
      const data = response.data.data;
      setLastResult({
        applied: data.applied,
        total: data.total,
        errors: data.errors ?? [],
      });
      if ((data.errors ?? []).length === 0) {
        message.success(
          mode === "monitor"
            ? `대기에 ${data.applied}건 추가 완료`
            : `즉시 적용 ${data.applied}건 완료`,
        );
        await onApplied();
        onClose();
      } else {
        message.warning(
          `부분 성공: ${data.applied}/${data.total}건 적용, ${(data.errors ?? []).length}건 실패`,
        );
        await onApplied();
      }
    } catch (error) {
      const m = error instanceof Error ? error.message : "대량 추가에 실패했습니다.";
      message.error(m);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={720}
      title="대량 IP 정책 추가"
      okText={mode === "monitor" ? "대기에 추가" : "즉시 적용"}
      cancelText="취소"
      onOk={submit}
      okButtonProps={{ disabled: valid.length === 0, loading: submitting }}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message="한 줄에 한 규칙"
          description={
            <span>
              형식: <code>from,to,note</code>. 각 컬럼은 선택이지만 <code>from</code> 과 <code>to</code>{" "}
              중 하나는 반드시 필요. <code>#</code> 로 시작하는 줄은 주석으로 무시.
            </span>
          }
        />

        <div>
          <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
            동작
          </Text>
          <Radio.Group
            value={action}
            onChange={(e) => setAction(e.target.value as BulkAction)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="add">추가 (allow)</Radio.Button>
            <Radio.Button value="delete">삭제 (delete allow)</Radio.Button>
          </Radio.Group>
        </div>

        <div>
          <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
            모드
          </Text>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value as BulkMode)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="monitor">모니터링 (대기 후 일괄)</Radio.Button>
            <Radio.Button value="apply">즉시 적용</Radio.Button>
          </Radio.Group>
        </div>

        <div>
          <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
            규칙 입력
          </Text>
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={"10.0.0.0/8,22/tcp,내부 SSH\n,443/tcp,모든 곳 HTTPS"}
            spellCheck={false}
          />
        </div>

        <div>
          <Text type="secondary">미리보기</Text>
          <div style={{ marginTop: 4 }}>
            <Space wrap>
              <Tag color={valid.length > 0 ? "green" : "default"}>
                적용 가능: {valid.length}건
              </Tag>
              {skipped > 0 && <Tag color="orange">무시 (빈 줄/주석): {skipped}건</Tag>}
              {parsed.length === 0 && <Tag>입력 대기</Tag>}
            </Space>
          </div>
          {valid.length > 0 && (
            <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
              {valid.slice(0, 5).map((p, i) => (
                <li key={i} style={{ fontSize: 12, color: "#666" }}>
                  {p.from || "모든 곳"} → {p.to || "모든 곳"}
                  {p.note ? ` — ${p.note}` : ""}
                </li>
              ))}
              {valid.length > 5 && (
                <li style={{ fontSize: 12, color: "#999" }}>
                  …외 {valid.length - 5}건
                </li>
              )}
            </ul>
          )}
        </div>

        {lastResult && lastResult.errors.length > 0 && (
          <Alert
            type="error"
            showIcon
            message={`${lastResult.applied}/${lastResult.total}건 적용, ${lastResult.errors.length}건 실패`}
            description={
              <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                {lastResult.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {lastResult.errors.length > 5 && (
                  <li>…외 {lastResult.errors.length - 5}건</li>
                )}
              </ul>
            }
          />
        )}
      </Space>
    </Modal>
  );
}

export default BulkRuleModal;
