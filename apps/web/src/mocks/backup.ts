import Mock from "mockjs";

// dev 환경에서만 사용되는 가짜 데이터. mock 환경에서는 실제 백업 파일을 만들지 않으므로
// 다운로드는 텍스트 응답, 복원은 가짜 성공 응답으로 UI 흐름만 확인 가능하게 한다.

const now = Date.now();
const mockBackups = [
  {
    filename: "pre-restore-2026-07-10T12-00-00-000Z.tar.gz",
    sizeBytes: 4096,
    createdAt: now - 30 * 60_000,
    kind: "pre-restore",
  },
  {
    filename: "manual-2026-07-09T18-30-00-000Z.tar.gz",
    sizeBytes: 3000,
    createdAt: now - 8 * 60 * 60_000,
    kind: "manual",
  },
];

Mock.mock("/api/ufw/backup/list", "get", () => ({
  success: true,
  data: { files: mockBackups, total: mockBackups.length, maxRetained: 10 },
}));

// mock 환경: 실제 tar.gz 가 아닌 더미 텍스트. responseType: blob 으로도 그대로 응답됨.
Mock.mock("/api/ufw/backup/download", "get", () => ({
  success: true,
  data: "mock tar.gz placeholder",
}));

Mock.mock("/api/ufw/backup/restore", "post", () => ({
  success: true,
  data: {
    restored: ["user.rules", "user6.rules", "ufw.conf", "sysctl.conf"],
    preBackup: "pre-restore-mock.tar.gz",
    reloaded: true,
    warnings: [],
  },
}));

// 서버에 보관된 사전 백업 다운로드 — 정규식 경로 매칭.
Mock.mock(/\/api\/ufw\/backup\/download\/.*/, "get", () => ({
  success: true,
  data: "mock stored backup placeholder",
}));