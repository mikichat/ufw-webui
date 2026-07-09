import express from "express";
import { authenticateToken } from "./auth";
import {
  addStaged,
  clearStaged,
  findStaged,
  listStaged,
  removeStaged,
  replaceStaged,
} from "../services/stagingService";
import { applyUfwOperation } from "../services/ufwService";
import type { Rule } from "@ufw-webui/shared";

const router = express.Router();

const jsonError = (res: express.Response, status: number, error: unknown) =>
  res.status(status).json({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });

const isAction = (v: unknown): v is "add" | "delete" =>
  v === "add" || v === "delete";

// GET /api/ufw/staged — 누적된 모니터링 작업 목록
router.get("/staged", authenticateToken, async (_req, res) => {
  try {
    const staged = await listStaged();
    res.json({ success: true, data: staged });
  } catch (error) {
    jsonError(res, 500, error);
  }
});

// POST /api/ufw/staged — 모니터링 작업 추가
//   body: { rule: { from, to, action?, note? } }
router.post("/staged", authenticateToken, async (req, res) => {
  try {
    const rule: Rule & { action?: unknown; note?: unknown } = req.body?.rule ?? {};
    const action = isAction(rule.action) ? rule.action : "add";
    const note = typeof rule.note === "string" ? rule.note : undefined;
    const next = await addStaged({
      from: rule.from,
      to: rule.to,
      action,
      note,
    });
    res.json({ success: true, data: next });
  } catch (error) {
    jsonError(res, 500, error);
  }
});

// DELETE /api/ufw/staged/:id — 대기 작업 한 건 제거 (UFW 미적용)
router.delete("/staged/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await removeStaged(id);
    res.json({ success: true, data: { id } });
  } catch (error) {
    jsonError(res, 404, error);
  }
});

// POST /api/ufw/staged/:id/apply — 한 건을 UFW 에 적용
router.post("/staged/:id/apply", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const target = await findStaged(id);
    if (!target) {
      throw new Error(`대기 작업을 찾을 수 없습니다: ${id}`);
    }
    await applyUfwOperation(target.action, target);
    await removeStaged(id);
    res.json({ success: true, data: { id } });
  } catch (error) {
    jsonError(res, 500, error);
  }
});

// POST /api/ufw/staged/apply-all — 일괄 적용
//   add 먼저 → delete 나중 순서로 처리해 SSH/원격 차단 위험을 줄인다.
//   한 건 실패 시에도 나머지는 계속 진행. errors[] 에 어떤 작업이 어떤 stderr 로
//   실패했는지 동봉.
router.post("/staged/apply-all", authenticateToken, async (_req, res) => {
  try {
    const staged = await listStaged();
    const order = (a: { action: "add" | "delete" }) => (a.action === "add" ? 0 : 1);
    const sorted = [...staged].sort((a, b) => order(a) - order(b));

    let applied = 0;
    const errors: string[] = [];
    const appliedIds: string[] = [];

    for (const rule of sorted) {
      try {
        await applyUfwOperation(rule.action, rule);
        applied += 1;
        appliedIds.push(rule.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(
          `${rule.action === "add" ? "추가" : "삭제"} ${rule.from || "모든 곳"} → ${rule.to || "모든 곳"}: ${message}`,
        );
      }
    }

    // 성공한 항목만 대기열에서 제거
    const remaining = staged.filter((rule) => !appliedIds.includes(rule.id));
    if (remaining.length === 0) {
      await clearStaged();
    } else {
      // 부분 성공: 성공한 것만 골라서 다시 저장
      await replaceStaged(remaining);
    }

    res.json({
      success: true,
      data: {
        applied,
        total: staged.length,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    jsonError(res, 500, error);
  }
});

export default router;
