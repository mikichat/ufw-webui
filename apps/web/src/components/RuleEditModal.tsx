import { useEffect, useState } from "react";
import { Alert, Form, Input, Modal, Radio, Space, Tag, Typography, message } from "antd";
import { useNavigate } from "react-router-dom";
import {
  apiUpdateRule,
  type UpdateMode,
} from "../services/api";
import type { FirewallPolicy, Rule } from "@ufw-webui/shared";

const { Text } = Typography;

const { TextArea } = Input;

type Props = {
  open: boolean;
  rule: Rule | null;            // 교체 대상 (없으면 모달 닫힘)
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
};

type FormValues = {
  from: string;
  to: string;
  note?: string;
  // 정책은 이 모달에서 변경하지 않는다. 표시용으로만 보관.
  policy: FirewallPolicy;
};

const normalize = (s: string) => s.trim();

function RuleEditModal({ open, rule, onClose, onUpdated }: Props) {
  const [form] = Form.useForm<FormValues>();
  const [mode, setMode] = useState<UpdateMode>("apply");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  // 모달이 열릴 때마다 원본 값으로 폼을 초기화
  useEffect(() => {
    if (open && rule) {
      form.setFieldsValue({
        from: rule.from,
        to: rule.to,
        note: "",
        policy: rule.policy ?? "allow",
      });
      setMode("apply");
    }
  }, [open, rule, form]);

  const handleSubmit = async () => {
    if (!rule) return;
    const values = await form.validateFields();
    const newFrom = normalize(values.from ?? "");
    const newTo = normalize(values.to ?? "");
    const policy = values.policy;

    if (!newFrom && !newTo) {
      message.error("'출발지' 또는 '도착지' 필드 중 하나는 반드시 입력해야 합니다.");
      return;
    }

    // 로그인 만료 대비: 만약 401 이면 로그인 페이지로
    setSubmitting(true);
    try {
      const res = await apiUpdateRule({
        old: { from: rule.from, to: rule.to, policy },
        new: { from: newFrom, to: newTo, policy },
        mode,
        note: values.note?.trim() || undefined,
      });
      const data = res.data.data;
      if (data.mode === "monitor") {
        message.success("대기열에 변경 작업이 추가되었습니다.");
      } else {
        message.success("규칙이 변경되었습니다.");
      }
      await onUpdated();
      onClose();
    } catch (error) {
      const m = error instanceof Error ? error.message : "규칙 변경에 실패했습니다.";
      message.error(m);
      if (m.includes("Access denied") || m.includes("Invalid token")) {
        localStorage.removeItem("token");
        navigate("/login");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!rule) return null;

  const oldFrom = rule.from || "모든 곳";
  const oldTo = rule.to || "모든 곳";
  const rulePolicy: FirewallPolicy = rule.policy ?? "allow";
  const isDeny = rulePolicy === "deny";

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="규칙 수정"
      okText={mode === "monitor" ? "대기에 추가" : "즉시 변경"}
      cancelText="취소"
      onOk={handleSubmit}
      confirmLoading={submitting}
      destroyOnClose
      width={600}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message="UFW 는 modify 명령이 없습니다"
          description={
            <span>
              기존 규칙을 <Tag color="red">삭제</Tag>한 뒤 새 규칙을 <Tag color="green">추가</Tag>하는 방식으로
              변경됩니다. 두 작업 중 하나가 실패하면 부분 적용 상태가 될 수 있으니 모니터링 모드 사용을 권장합니다.
            </span>
          }
        />

        <Alert
          type="warning"
          showIcon
          message="정책(허용/차단) 은 이 모달에서 변경할 수 없습니다"
          description="정책을 바꾸려면 기존 규칙을 삭제한 뒤 새 정책으로 추가하세요."
        />

        <div>
          <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
            원본 규칙
          </Text>
          <div style={{ padding: 8, background: "#fafafa", borderRadius: 4 }}>
            <Tag color={isDeny ? "red" : "green"}>{isDeny ? "차단" : "허용"}</Tag>{" "}
            <Tag color="default">from</Tag> <strong>{oldFrom}</strong>{" "}
            <span style={{ margin: "0 4px" }}>→</span>{" "}
            <Tag color="default">to</Tag> <strong>{oldTo}</strong>
          </div>
        </div>

        <div>
          <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>
            모드
          </Text>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value as UpdateMode)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="apply">즉시 변경</Radio.Button>
            <Radio.Button value="monitor">모니터링 (대기 후 일괄)</Radio.Button>
          </Radio.Group>
        </div>

        <Form<FormValues> form={form} layout="vertical">
          {/* 정책은 표시만. 변경 불가. */}
          <Form.Item name="policy" hidden><Input /></Form.Item>

          <Form.Item
            name="from"
            label="새 출발지"
            rules={[]}
            extra="비우면 '모든 곳' 으로 처리"
          >
            <Input placeholder="예: 10.0.0.0/8" />
          </Form.Item>

          <Form.Item
            name="to"
            label="새 도착지"
            extra="비우면 '모든 곳' 으로 처리"
          >
            <Input placeholder="예: 22/tcp" />
          </Form.Item>

          {mode === "monitor" && (
            <Form.Item
              name="note"
              label="메모 (선택)"
              extra="대기열에서 식별하기 위한 한 줄 메모"
            >
              <TextArea
                rows={2}
                maxLength={200}
                placeholder="예: 정책 변경 — SSH 포트 축소"
              />
            </Form.Item>
          )}
        </Form>
      </Space>
    </Modal>
  );
}

export default RuleEditModal;
