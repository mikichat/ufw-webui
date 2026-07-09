import express from "express";
import { authenticateToken } from "./auth";
import {
  createLogStream,
  detectLogSource,
  getLogFilePath,
  getRecentLines,
} from "../services/logService";
import { getCurrentLogLevel, setLogLevel } from "../services/ufwService";
import type { LogLevel } from "@ufw-webui/shared";

const router = express.Router();

const jsonError = (res: express.Response, status: number, error: unknown) =>
  res.status(status).json({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });

const ALLOWED_LEVELS: LogLevel[] = ["off", "low", "medium", "high", "full"];

// GET /api/ufw/logging — 현재 UFW logging 레벨과 로그 출처 (file | journal | none)
router.get("/logging", authenticateToken, async (_req, res) => {
  try {
    const level = await getCurrentLogLevel();
    const source = detectLogSource();
    res.json({
      success: true,
      data: {
        level,
        file: getLogFilePath(),
        source: source.kind,
      },
    });
  } catch (error) {
    jsonError(res, 500, error);
  }
});

// POST /api/ufw/logging — logging 레벨 변경
//   body: { level: "off" | "low" | "medium" | "high" | "full" }
router.post("/logging", authenticateToken, async (req, res) => {
  try {
    const level = req.body?.level;
    if (!ALLOWED_LEVELS.includes(level)) {
      throw new Error(`지원하지 않는 로그 레벨입니다: ${String(level)}`);
    }
    const result = await setLogLevel(level);
    res.json({ success: true, data: { level, result } });
  } catch (error) {
    jsonError(res, 500, error);
  }
});

// GET /api/ufw/logs?limit=200 — 최근 N줄 (UFW 라인 우선, file 또는 journal 출처)
router.get("/logs", authenticateToken, async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 200;
    const lines = await getRecentLines(limit);
    const source = detectLogSource();
    res.json({
      success: true,
      data: {
        file: getLogFilePath(),
        source: source.kind,
        lines,
      },
    });
  } catch (error) {
    jsonError(res, 500, error);
  }
});

// GET /api/ufw/logs/stream — SSE 실시간 스트림
//   출처(file|journal)에 따라 tail -F 또는 journalctl -kf 로 새 줄마다 push.
//   클라이언트 연결 종료 시 child process 를 kill 해 FD 누수 방지.
router.get("/logs/stream", authenticateToken, async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // 첫 줄에 현재 로그 출처를 알림 (UI 가 "journal 에서 수신" 같은 안내 가능)
  const source = detectLogSource();
  res.write(
    `event: meta\ndata: ${JSON.stringify({ file: getLogFilePath(), source: source.kind })}\n\n`,
  );

  const stream = createLogStream((line) => {
    res.write(`data: ${JSON.stringify(line)}\n\n`);
  });

  // keep-alive 주석 (EventSource 표준). 25초마다.
  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 25_000);

  const cleanup = () => {
    clearInterval(keepAlive);
    stream.close();
  };

  req.on("close", cleanup);
  req.on("error", cleanup);
});

export default router;
