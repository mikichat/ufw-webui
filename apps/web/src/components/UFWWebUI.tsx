import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type {
  FirewallPolicy,
  LogLevel,
  LogLine,
  Rule,
  StagedRule,
  UfwStatus,
} from "@ufw-webui/shared";
import {
  apiAddRule,
  apiAddStaged,
  apiApplyStagedAll,
  apiApplyStagedOne,
  apiDeleteRule,
  apiDisableUfw,
  apiEnableUfw,
  apiGetLogLevel,
  apiGetRecentLogs,
  apiGetUfwStatus,
  apiListStaged,
  apiRemoveStaged,
  apiSetLogLevel,
} from "../services/api";
import BulkRuleModal from "./BulkRuleModal";
import RuleEditModal from "./RuleEditModal";
import BackupRestoreModal from "./BackupRestoreModal";

const { Title, Text } = Typography;

type RuleFormValues = {
  from?: string;
  to?: string;
  note?: string;
  policy?: FirewallPolicy;
};

type AddMode = "apply-add" | "monitor-add" | "monitor-delete";

type RuleRow = Rule & {
  key: string;
  isAddRow?: false;
};

type AddRuleRow = {
  key: "add-rule";
  isAddRow: true;
  from: "";
  to: "";
};

type TableRow = RuleRow | AddRuleRow;

type StagedRow = StagedRule & { key: string };

const ANYWHERE_LABEL = "모든 곳";
const LOG_POLL_INTERVAL_MS = 4000;

const formatCreatedAt = (timestamp: number) => {
  const date = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

// 영문/한글 syslog 타임스탬프 둘 다 인식: "Jul  9 12:48:01" 또는 "7월 09 13:14:09"
const formatLogTime = (raw: string) => {
  const m = raw.match(
    /^(?:([A-Z][a-z]{2})|(\d{1,2})월)\s+(\d+)\s+(\d{2}):(\d{2}):(\d{2})/,
  );
  if (m) {
    return `${m[1] ?? `${m[2]}월`} ${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  }
  return "";
};

function UFWWebUI({ setIsLoggedIn }: { setIsLoggedIn: (isLoggedIn: boolean) => void }) {
  const [ufwStatus, setUfwStatus] = useState<UfwStatus>({ active: false, rules: [] });
  const [stagedRules, setStagedRules] = useState<StagedRule[]>([]);
  const [addMode, setAddMode] = useState<AddMode>("apply-add");
  const [addPolicy, setAddPolicy] = useState<FirewallPolicy>("allow");
  const [applyLoading, setApplyLoading] = useState(false);
  const [logLevel, setLogLevel] = useState<LogLevel>("off");
  const [logFile, setLogFile] = useState<string | null>(null);
  const [logSource, setLogSource] = useState<"file" | "journal" | "none">("none");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logFilter, setLogFilter] = useState<"all" | "BLOCK" | "ALLOW">("all");
  const [logPaused, setLogPaused] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Rule | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [form] = Form.useForm<RuleFormValues>();
  const navigate = useNavigate();
  const logTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRules = async () => {
    try {
      const response = await apiGetUfwStatus();
      setUfwStatus(response.data.data);
    } catch (error) {
      const m = error instanceof Error ? error.message : "UFW 규칙을 가져오지 못했습니다.";
      message.error(m);
    }
  };

  const fetchStaged = async () => {
    try {
      const response = await apiListStaged();
      setStagedRules(response.data.data ?? []);
    } catch (error) {
      const m = error instanceof Error ? error.message : "대기 작업을 가져오지 못했습니다.";
      message.error(m);
    }
  };

  const fetchLogLevel = async () => {
    try {
      const response = await apiGetLogLevel();
      setLogLevel(response.data.data.level);
      setLogFile(response.data.data.file);
      if (response.data.data.source) {
        setLogSource(response.data.data.source);
      }
    } catch (_error) {
      // ignore — 로그 조회 실패가 핵심 작업을 막진 않음
    }
  };

  const fetchLogs = async () => {
    if (logPaused) return;
    try {
      const response = await apiGetRecentLogs(200);
      const data = response.data.data;
      setLogFile(data.file);
      if (data.source) setLogSource(data.source);
      setLogs(data.lines ?? []);
    } catch (_error) {
      // ignore
    }
  };

  const refreshAll = async () => {
    await Promise.all([fetchRules(), fetchStaged()]);
  };

  // 로그 폴링. paused 가 false 일 때만 타이머를 갱신.
  useEffect(() => {
    if (logPaused) {
      if (logTimerRef.current) {
        clearTimeout(logTimerRef.current);
        logTimerRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await fetchLogs();
      if (cancelled) return;
      logTimerRef.current = setTimeout(tick, LOG_POLL_INTERVAL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (logTimerRef.current) {
        clearTimeout(logTimerRef.current);
        logTimerRef.current = null;
      }
    };
  }, [logPaused]);

  useEffect(() => {
    void refreshAll();
    void fetchLogLevel();
  }, []);

  const toggleUfwStatus = async () => {
    try {
      if (ufwStatus.active) {
        await apiDisableUfw();
      } else {
        await apiEnableUfw();
      }
      await fetchRules();
      message.success(
        `UFW가 현재 ${ufwStatus.active ? "비활성" : "활성"} 상태입니다.`,
      );
    } catch (error) {
      const m = error instanceof Error ? error.message : "UFW 상태 변경에 실패했습니다.";
      message.error(m);
    }
  };

  const deleteRule = async (rule: Rule) => {
    try {
      await apiDeleteRule(rule);
      message.success("규칙이 삭제되었습니다.");
      await fetchRules();
    } catch (error) {
      const m = error instanceof Error ? error.message : "규칙을 삭제하지 못했습니다.";
      message.error(m);
    }
  };

  const submitRule = async (values: RuleFormValues) => {
    const normalizedRule: Rule = {
      from: (values.from ?? "").trim(),
      to: (values.to ?? "").trim(),
      policy: values.policy ?? addPolicy,
    };
    const note = (values.note ?? "").trim() || undefined;
    const fromAnywhere =
      !normalizedRule.from ||
      normalizedRule.from === ANYWHERE_LABEL ||
      normalizedRule.from === "Anywhere";
    const toAnywhere =
      !normalizedRule.to ||
      normalizedRule.to === ANYWHERE_LABEL ||
      normalizedRule.to === "Anywhere";

    if (fromAnywhere && toAnywhere) {
      message.error("'출발지' 또는 '도착지' 필드 중 하나는 반드시 입력해야 합니다.");
      return;
    }

    try {
      if (addMode === "apply-add") {
        await apiAddRule(normalizedRule);
        message.success("규칙이 추가되었습니다.");
        form.resetFields();
        setAddPolicy("allow");
        await fetchRules();
      } else if (addMode === "monitor-add") {
        await apiAddStaged({ ...normalizedRule, action: "add", note });
        message.success("대기 작업에 추가되었습니다. 검토 후 적용해 주세요.");
        form.resetFields();
        setAddPolicy("allow");
        await fetchStaged();
      } else {
        await apiAddStaged({ ...normalizedRule, action: "delete", note });
        message.success("삭제 의도가 대기열에 추가되었습니다.");
        form.resetFields();
        setAddPolicy("allow");
        await fetchStaged();
      }
    } catch (error) {
      const m = error instanceof Error ? error.message : "요청에 실패했습니다.";
      message.error(m);
    }
  };

  const applyOneStaged = async (id: string) => {
    try {
      await apiApplyStagedOne(id);
      message.success("작업이 적용되었습니다.");
      await refreshAll();
    } catch (error) {
      const m = error instanceof Error ? error.message : "적용에 실패했습니다.";
      message.error(m);
    }
  };

  const discardOneStaged = async (id: string) => {
    try {
      await apiRemoveStaged(id);
      message.success("대기 작업이 제거되었습니다.");
      await fetchStaged();
    } catch (error) {
      const m = error instanceof Error ? error.message : "제거에 실패했습니다.";
      message.error(m);
    }
  };

  const applyAllStaged = async () => {
    if (stagedRules.length === 0) return;
    setApplyLoading(true);
    try {
      const response = await apiApplyStagedAll();
      const data = response.data.data as { applied?: number; total?: number; errors?: string[] };
      const applied = data?.applied ?? 0;
      const total = data?.total ?? 0;
      const errors = data?.errors ?? [];
      if (errors.length === 0) {
        message.success(`일괄 적용 완료 (${applied}/${total}건)`);
      } else {
        message.warning(`일괄 적용 부분 성공: ${applied}/${total}건 적용, ${errors.length}건 실패`);
      }
      await refreshAll();
    } catch (error) {
      const m = error instanceof Error ? error.message : "일괄 적용에 실패했습니다.";
      message.error(m);
    } finally {
      setApplyLoading(false);
    }
  };

  const discardAllStaged = async () => {
    if (stagedRules.length === 0) return;
    try {
      for (const rule of stagedRules) {
        await apiRemoveStaged(rule.id);
      }
      message.success("모든 대기 작업을 삭제했습니다.");
      await fetchStaged();
    } catch (error) {
      const m = error instanceof Error ? error.message : "전체 삭제에 실패했습니다.";
      message.error(m);
    }
  };

  const setLevel = async (level: LogLevel) => {
    try {
      await apiSetLogLevel(level);
      setLogLevel(level);
      message.success(`UFW logging = ${level}`);
      // 레벨을 켠 직후 한 번 즉시 갱신해 새 로그를 빨리 본다
      if (level !== "off") {
        void fetchLogs();
      }
    } catch (error) {
      const m = error instanceof Error ? error.message : "로그 레벨 변경에 실패했습니다.";
      message.error(m);
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setIsLoggedIn(false);
    navigate("/login");
  };

  const onBulkApplied = async () => {
    // 모니터링 모드/즉시 적용 모드 모두 staged + applied 모두 새로 가져옴
    await refreshAll();
  };

  // ── 테이블 정의 ─────────────────────────────────────────────────────────

  const appliedColumns: ColumnsType<TableRow> = [
    {
      title: "출발지",
      dataIndex: "from",
      key: "from",
      render: (text: string, record: TableRow) => {
        if (record.isAddRow) {
          return (
            <Form.Item name="from" style={{ marginBottom: 0 }}>
              <Input placeholder="출발지 (예: 10.0.0.0/8)" />
            </Form.Item>
          );
        }
        return text === "" ? ANYWHERE_LABEL : text;
      },
    },
    {
      title: "도착지",
      dataIndex: "to",
      key: "to",
      render: (text: string, record: TableRow) => {
        if (record.isAddRow) {
          return (
            <Form.Item name="to" style={{ marginBottom: 0 }}>
              <Input placeholder="도착지 (예: 22/tcp)" />
            </Form.Item>
          );
        }
        return text === "" ? ANYWHERE_LABEL : text;
      },
    },
    {
      title: "정책",
      key: "policy",
      width: 120,
      render: (_value, record) => {
        if (record.isAddRow) {
          return (
            <Radio.Group
              value={addPolicy}
              onChange={(e) => setAddPolicy(e.target.value as FirewallPolicy)}
              optionType="button"
              buttonStyle="solid"
              size="small"
            >
              <Radio.Button value="allow">허용</Radio.Button>
              <Radio.Button value="deny">차단</Radio.Button>
            </Radio.Group>
          );
        }
        const policy: FirewallPolicy = (record as Rule).policy ?? "allow";
        return (
          <Tag color={policy === "deny" ? "red" : "green"}>
            {policy === "deny" ? "차단" : "허용"}
          </Tag>
        );
      },
    },
    {
      title: "동작",
      key: "action",
      width: 320,
      render: (_value, record) => {
        if (record.isAddRow) {
          return (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Radio.Group
                value={addMode}
                onChange={(e) => setAddMode(e.target.value as AddMode)}
                optionType="button"
                buttonStyle="solid"
                size="small"
              >
                <Radio.Button value="apply-add">즉시 적용</Radio.Button>
                <Radio.Button value="monitor-add">모니터링(추가)</Radio.Button>
                <Radio.Button value="monitor-delete">모니터링(삭제)</Radio.Button>
              </Radio.Group>
              <Form.Item name="note" style={{ marginBottom: 0 }}>
                <Input
                  size="small"
                  placeholder="메모 (선택) — 예: 1차 작업, 점검용"
                  maxLength={200}
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" size="small">
                {addMode === "apply-add"
                  ? "규칙 추가"
                  : addMode === "monitor-add"
                    ? "대기에 추가"
                    : "삭제 의도 추가"}
              </Button>
            </Space>
          );
        }

        return (
          <Space>
            <Button size="small" onClick={() => setEditTarget(record)}>
              수정
            </Button>
            <Popconfirm
              title="이 규칙을 즉시 삭제하시겠습니까?"
              onConfirm={() => deleteRule(record)}
              okText="삭제"
              cancelText="취소"
            >
              <Button danger size="small">즉시 삭제</Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const appliedData: TableRow[] = [
    ...ufwStatus.rules.map((rule) => ({
      ...rule,
      // 정책까지 key 에 포함해야, 같은 from/to 의 allow 와 deny 규칙이 한 행에 겹치지 않음.
      key: `${rule.policy ?? "allow"}-${rule.from}-${rule.to}`,
    })),
    { key: "add-rule", isAddRow: true, from: "", to: "" },
  ];

  const stagedColumns: ColumnsType<StagedRow> = [
    {
      title: "동작",
      dataIndex: "action",
      key: "action",
      width: 100,
      render: (action: StagedRule["action"]) =>
        action === "delete" ? (
          <Tag color="red">삭제</Tag>
        ) : action === "update" ? (
          <Tag color="blue">수정</Tag>
        ) : (
          <Tag color="green">추가</Tag>
        ),
    },
    {
      title: "정책",
      dataIndex: "policy",
      key: "policy",
      width: 90,
      render: (policy: FirewallPolicy | undefined) => (
        <Tag color={(policy ?? "allow") === "deny" ? "red" : "green"}>
          {(policy ?? "allow") === "deny" ? "차단" : "허용"}
        </Tag>
      ),
    },
    {
      title: "출발지",
      dataIndex: "from",
      key: "from",
      render: (text: string) => (text === "" ? ANYWHERE_LABEL : text),
    },
    {
      title: "도착지",
      dataIndex: "to",
      key: "to",
      render: (text: string) => (text === "" ? ANYWHERE_LABEL : text),
    },
    {
      title: "메모",
      dataIndex: "note",
      key: "note",
      render: (text?: string) =>
        text ? <span style={{ color: "#666" }}>{text}</span> : <Text type="secondary">—</Text>,
    },
    {
      title: "추가 시각",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 160,
      render: (t: number) => formatCreatedAt(t),
    },
    {
      title: "",
      key: "ops",
      width: 200,
      render: (_v, record) => (
        <Space>
          <Popconfirm
            title="이 작업을 UFW 에 적용하시겠습니까?"
            onConfirm={() => applyOneStaged(record.id)}
            okText="적용"
            cancelText="취소"
          >
            <Button type="primary" size="small">적용</Button>
          </Popconfirm>
          <Popconfirm
            title="이 대기 작업을 버리시겠습니까?"
            onConfirm={() => discardOneStaged(record.id)}
            okText="삭제"
            cancelText="취소"
          >
            <Button danger size="small">버리기</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const stagedData: StagedRow[] = stagedRules.map((rule) => ({ ...rule, key: rule.id }));

  const filteredLogs = logs.filter((line) => {
    if (logFilter === "all") return true;
    return line.action === logFilter;
  });

  const logPanel = (
    <Card size="small" title="UFW 로그">
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          size="small"
          value={logLevel}
          onChange={(v) => setLevel(v as LogLevel)}
          style={{ width: 140 }}
          options={[
            { value: "off", label: "off" },
            { value: "low", label: "low" },
            { value: "medium", label: "medium" },
            { value: "high", label: "high" },
            { value: "full", label: "full" },
          ]}
        />
        <Select
          size="small"
          value={logFilter}
          onChange={(v) => setLogFilter(v as "all" | "BLOCK" | "ALLOW")}
          style={{ width: 120 }}
          options={[
            { value: "all", label: "전체" },
            { value: "BLOCK", label: "BLOCK" },
            { value: "ALLOW", label: "ALLOW" },
          ]}
        />
        <Button
          size="small"
          onClick={() => setLogPaused((p) => !p)}
        >
          {logPaused ? "▶ 재개" : "⏸ 일시정지"}
        </Button>
        <Button size="small" onClick={() => void fetchLogs()}>
          ↻ 새로고침
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {logSource === "journal"
            ? `journald (${logFile ?? "kernel stream"})`
            : logSource === "file"
              ? logFile
              : "로그 출처를 사용할 수 없음"}
        </Text>
      </Space>

      <div
        style={{
          maxHeight: 240,
          overflowY: "auto",
          backgroundColor: "#fafafa",
          padding: 8,
          border: "1px solid #f0f0f0",
          borderRadius: 4,
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
        }}
      >
        {filteredLogs.length === 0 ? (
          <Text type="secondary">
            {logPaused
              ? "일시정지됨 — 재개 버튼을 누르세요."
              : logSource === "none"
                ? "로그 출처를 찾을 수 없습니다 (파일도 journal 도 없음)."
                : logSource === "journal"
                  ? "표시할 로그가 없습니다. 호스트에 UFW 이벤트가 발생하면 자동으로 갱신됩니다."
                  : "표시할 로그가 없습니다."}
          </Text>
        ) : (
          filteredLogs
            .slice(-200)
            .reverse()
            .map((line, i) => (
              <div key={`${line.raw}-${i}`} style={{ marginBottom: 2 }}>
                <Text type="secondary" style={{ marginRight: 8 }}>
                  {formatLogTime(line.raw)}
                </Text>
                {line.action ? (
                  <Tag
                    color={line.action === "BLOCK" ? "red" : "green"}
                    style={{ marginRight: 6 }}
                  >
                    {line.action}
                  </Tag>
                ) : null}
                {line.src && (
                  <Tooltip title="SRC">
                    <Tag>{line.src}</Tag>
                  </Tooltip>
                )}
                {line.dst && <span style={{ margin: "0 4px" }}>→</span>}
                {line.dst && (
                  <Tooltip title="DST">
                    <Tag>{line.dst}</Tag>
                  </Tooltip>
                )}
                {line.proto && (
                  <Text type="secondary" style={{ marginLeft: 6 }}>
                    {line.proto}
                    {line.spt ? `:${line.spt}` : ""}
                    {line.dpt ? `→:${line.dpt}` : ""}
                  </Text>
                )}
              </div>
            ))
        )}
      </div>
    </Card>
  );

  return (
    <div style={{ padding: "20px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: "20px",
        }}
      >
        <Title level={2} style={{ margin: 0, marginRight: "20px" }}>
          UFW 방화벽 관리
        </Title>
        <Switch
          checked={ufwStatus.active}
          onChange={toggleUfwStatus}
          checkedChildren="켜짐"
          unCheckedChildren="꺼짐"
        />
        <Badge
          count={stagedRules.length}
          offset={[-8, 8]}
          style={{ marginLeft: 16, backgroundColor: "#faad14" }}
        >
          <Text type="secondary" style={{ marginLeft: 16 }}>대기 작업</Text>
        </Badge>
      </div>

      <div style={{ display: "flex", alignItems: "center" }}>
        <Button
          type="primary"
          ghost
          onClick={() => setBackupOpen(true)}
          style={{ marginLeft: "auto" }}
        >
          백업/복원
        </Button>
        <Button
          ghost
          onClick={() => setBulkOpen(true)}
          style={{ marginLeft: 8 }}
        >
          + 대량 추가
        </Button>
        <Button type="link" onClick={logout} style={{ marginRight: "20px" }}>
          로그아웃
        </Button>
      </div>

      <Collapse
        style={{ marginBottom: 16 }}
        items={[
          {
            key: "logs",
            label: "UFW 로그 (실시간)",
            children: logPanel,
          },
        ]}
      />

      {stagedRules.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: 12,
              gap: 12,
            }}
          >
            <Title level={4} style={{ margin: 0 }}>
              ⏳ 대기 중인 작업 ({stagedRules.length}건)
            </Title>
            <Popconfirm
              title={`대기 중인 ${stagedRules.length}건을 모두 UFW 에 적용하시겠습니까?`}
              onConfirm={applyAllStaged}
              okText="모두 적용"
              cancelText="취소"
            >
              <Button type="primary" loading={applyLoading}>
                모두 적용
              </Button>
            </Popconfirm>
            <Popconfirm
              title={`대기 중인 ${stagedRules.length}건을 모두 삭제하시겠습니까?`}
              onConfirm={discardAllStaged}
              okText="전체 삭제"
              cancelText="취소"
            >
              <Button danger>전체 삭제</Button>
            </Popconfirm>
          </div>
          <Table<StagedRow>
            dataSource={stagedData}
            columns={stagedColumns}
            rowKey="key"
            bordered
            pagination={false}
            size="small"
          />
        </section>
      )}

      <Form form={form} onFinish={submitRule}>
        <Table<TableRow>
          dataSource={appliedData}
          columns={appliedColumns}
          rowKey="key"
          bordered
          pagination={false}
        />
      </Form>

      <BulkRuleModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onApplied={onBulkApplied}
      />

      <RuleEditModal
        open={editTarget !== null}
        rule={editTarget}
        onClose={() => setEditTarget(null)}
        onUpdated={refreshAll}
      />

      <BackupRestoreModal
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
        onChanged={refreshAll}
      />
    </div>
  );
}

export default UFWWebUI;
