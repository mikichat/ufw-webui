import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  apiDownloadBackup,
  apiDownloadStoredBackup,
  apiListBackups,
  apiRestoreBackup,
  type BackupListEntry,
  type RestoreResponse,
} from "../services/api";

const { Text, Paragraph } = Typography;

type Props = {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
};

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const formatCreatedAt = (ts: number): string => {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function BackupRestoreModal({ open, onClose, onChanged }: Props) {
  const [tab, setTab] = useState<"download" | "restore">("download");
  const [backups, setBackups] = useState<BackupListEntry[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [lastResult, setLastResult] = useState<RestoreResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchBackups = async () => {
    setBackupsLoading(true);
    try {
      const res = await apiListBackups();
      setBackups(res.data.data.files);
    } catch (error) {
      const m = error instanceof Error ? error.message : "목록을 가져오지 못했습니다.";
      message.error(m);
    } finally {
      setBackupsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void fetchBackups();
      setLastResult(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDownloadCurrent = async () => {
    setDownloading(true);
    try {
      await apiDownloadBackup();
      message.success("백업 파일 다운로드를 시작했습니다.");
    } catch (error) {
      const m = error instanceof Error ? error.message : "다운로드에 실패했습니다.";
      message.error(m);
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadStored = async (filename: string) => {
    try {
      await apiDownloadStoredBackup(filename);
    } catch (error) {
      const m = error instanceof Error ? error.message : "다운로드에 실패했습니다.";
      message.error(m);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
  };

  const handleRestore = async () => {
    if (!file) {
      message.warning("복원할 파일을 선택하세요.");
      return;
    }
    setRestoring(true);
    try {
      const res = await apiRestoreBackup(file);
      const data = res.data.data;
      setLastResult(data);
      if (data.warnings.length === 0) {
        message.success(
          `복원 완료 (${data.restored.length}건). 사전 백업: ${data.preBackup}`,
        );
      } else {
        message.warning(
          `복원 완료 (경고 ${data.warnings.length}건). 사전 백업: ${data.preBackup}`,
        );
      }
      await fetchBackups();
      if (onChanged) await onChanged();
    } catch (error) {
      const m = error instanceof Error ? error.message : "복원에 실패했습니다.";
      message.error(m);
    } finally {
      setRestoring(false);
    }
  };

  const backupColumns: ColumnsType<BackupListEntry> = [
    {
      title: "파일명",
      dataIndex: "filename",
      key: "filename",
      ellipsis: true,
      render: (text: string) => <Text code>{text}</Text>,
    },
    {
      title: "종류",
      dataIndex: "kind",
      key: "kind",
      width: 110,
      render: (kind: BackupListEntry["kind"]) =>
        kind === "pre-restore" ? (
          <Tag color="orange">자동 (사전 백업)</Tag>
        ) : (
          <Tag color="blue">수동</Tag>
        ),
    },
    {
      title: "크기",
      dataIndex: "sizeBytes",
      key: "sizeBytes",
      width: 100,
      render: (n: number) => formatBytes(n),
    },
    {
      title: "생성 시각",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 170,
      render: (ts: number) => formatCreatedAt(ts),
    },
    {
      title: "",
      key: "ops",
      width: 90,
      render: (_v, record) => (
        <Button size="small" onClick={() => void handleDownloadStored(record.filename)}>
          받기
        </Button>
      ),
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="정책 백업 / 복원"
      footer={null}
      width={780}
      destroyOnClose
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as "download" | "restore")}
        items={[
          {
            key: "download",
            label: "다운로드",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Alert
                  type="info"
                  showIcon
                  message="현재 UFW 정책 파일을 다운로드합니다"
                  description={
                    <span>
                      <code>/etc/ufw/</code> 의 <code>user.rules</code>,{" "}
                      <code>user6.rules</code>, <code>ufw.conf</code>,{" "}
                      <code>sysctl.conf</code> 4종과 manifest.json 을 묶어
                      tar.gz 로 내려받습니다.
                    </span>
                  }
                />
                <Button
                  type="primary"
                  loading={downloading}
                  onClick={handleDownloadCurrent}
                >
                  현재 정책 백업 다운로드
                </Button>

                <div style={{ marginTop: 16 }}>
                  <Text strong>서버 보관 백업 (자동)</Text>
                  <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                    복원 시 자동으로 만들어진 백업입니다. 최근 {backups[0] ? "10개" : ""}
                    까지 서버에 보존되며, 오래된 순으로 자동 삭제(FIFO) 됩니다.
                  </Paragraph>
                </div>

                <Table<BackupListEntry>
                  dataSource={backups}
                  columns={backupColumns}
                  rowKey="filename"
                  size="small"
                  loading={backupsLoading}
                  pagination={false}
                  locale={{ emptyText: "서버에 보관된 사전 백업이 없습니다." }}
                />
              </Space>
            ),
          },
          {
            key: "restore",
            label: "복원",
            children: (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Alert
                  type="warning"
                  showIcon
                  message="복원 전 현재 상태는 자동으로 서버에 백업됩니다"
                  description={
                    <span>
                      업로드한 tar.gz 의 4개 파일로 <code>/etc/ufw/</code> 의 정책을
                      교체하고 <code>ufw reload</code> 를 실행합니다.
                      <br />
                      원본 호스트와 <strong>동일한 시스템</strong>에서 복원하세요.
                      다른 호스트에서 복원 시 <code>ufw.conf</code> 의 ENABLED /
                      DEFAULT_*_POLICY 가 그대로 적용되어 SSH 접근이 끊길 수 있습니다.
                    </span>
                  }
                />

                <div>
                  <Text strong>백업 파일 선택 (.tar.gz)</Text>
                  <div style={{ marginTop: 8 }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".gz,.tar.gz,application/gzip,application/x-gzip"
                      onChange={handleFileChange}
                      disabled={restoring}
                      style={{ display: "block" }}
                    />
                    {file && (
                      <Text type="secondary" style={{ marginTop: 4, display: "block" }}>
                        선택된 파일: <Text code>{file.name}</Text> ({formatBytes(file.size)})
                      </Text>
                    )}
                  </div>
                </div>

                <Popconfirm
                  title="정말 복원하시겠습니까?"
                  description="현재 상태는 사전 백업으로 저장되지만, 되돌림은 수동 작업입니다."
                  okText="복원"
                  okButtonProps={{ danger: true }}
                  cancelText="취소"
                  disabled={!file || restoring}
                  onConfirm={handleRestore}
                >
                  <Button danger type="primary" disabled={!file || restoring} loading={restoring}>
                    복원 실행
                  </Button>
                </Popconfirm>

                {lastResult && (
                  <Alert
                    type={lastResult.warnings.length === 0 ? "success" : "warning"}
                    showIcon
                    message={`복원 ${lastResult.restored.length}건 · 사전 백업: ${lastResult.preBackup}`}
                    description={
                      <Space direction="vertical" size={4}>
                        <div>
                          복원된 파일:{" "}
                          {lastResult.restored.map((n) => (
                            <Tag color="green" key={n}>
                              {n}
                            </Tag>
                          ))}
                        </div>
                        <div>
                          ufw reload:{" "}
                          {lastResult.reloaded ? (
                            <Tag color="green">성공</Tag>
                          ) : (
                            <Tag color="red">실패</Tag>
                          )}
                        </div>
                        {lastResult.warnings.length > 0 && (
                          <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                            {lastResult.warnings.map((w, i) => (
                              <li key={i} style={{ fontSize: 12, color: "#666" }}>
                                {w}
                              </li>
                            ))}
                          </ul>
                        )}
                      </Space>
                    }
                  />
                )}
              </Space>
            ),
          },
        ]}
      />
    </Modal>
  );
}

export default BackupRestoreModal;