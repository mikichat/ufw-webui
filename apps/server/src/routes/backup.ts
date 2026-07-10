import bodyParser from "body-parser";
import express from "express";
import { authenticateToken } from "./auth";
import {
  getBackupBuffer,
  listBackups,
  restoreFromBuffer,
  streamCurrentBackup,
} from "../services/backupService";

const router = express.Router();

const jsonError = (res: express.Response, status: number, error: unknown) =>
  res.status(status).json({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });

// GET /api/ufw/backup/list — 서버에 보관된 사전 백업 목록 (FIFO 자동 관리).
//   응답: { success, data: { files: [{filename, sizeBytes, createdAt, kind}], total, maxRetained } }
router.get("/backup/list", authenticateToken, async (_req, res) => {
  try {
    const files = await listBackups();
    res.json({
      success: true,
      data: { files, total: files.length, maxRetained: 10 },
    });
  } catch (error) {
    jsonError(res, 500, error);
  }
});

// GET /api/ufw/backup/download — 현재 정책 파일 4종을 tar.gz 로 스트림 응답.
//   Content-Type: application/gzip
//   Content-Disposition: attachment; filename="ufw-backup-<ISO>.tar.gz"
router.get("/backup/download", authenticateToken, async (_req, res) => {
  try {
    await streamCurrentBackup(res);
  } catch (error) {
    // 스트림이 이미 시작됐을 수 있으므로 headersSent 체크.
    if (!res.headersSent) {
      jsonError(res, 500, error);
    }
  }
});

// GET /api/ufw/backup/download/:filename — 서버 보관 사전 백업 파일 다운로드.
//   path traversal 방지: backupService.getBackupBuffer 가 backupsDir 내부만 허용.
router.get(
  "/backup/download/:filename",
  authenticateToken,
  async (req, res) => {
    try {
      const buf = await getBackupBuffer(req.params.filename);
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${req.params.filename}"`,
      );
      res.send(buf);
    } catch (error) {
      jsonError(res, 404, error);
    }
  },
);

// POST /api/ufw/backup/restore — tar.gz 업로드 → 사전 백업 생성 + 파일 교체 + ufw reload.
//   본문: application/gzip (binary). 라우트별 bodyParser.raw 로 multipart 없이 처리.
//   limit 10MB — UFW 정책 파일은 절대 이보다 클 수 없음.
router.post(
  "/backup/restore",
  authenticateToken,
  bodyParser.raw({
    type: ["application/gzip", "application/x-gzip", "application/octet-stream"],
    limit: "10mb",
  }),
  async (req, res) => {
    try {
      const buf = req.body as Buffer | undefined;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        throw new Error(
          "업로드된 본문이 비어 있거나 tar.gz 형식이 아닙니다 (Content-Type: application/gzip 필요).",
        );
      }
      const result = await restoreFromBuffer(buf);
      res.json({ success: true, data: result });
    } catch (error) {
      jsonError(res, 400, error);
    }
  },
);

export default router;