import express from "express";
import { authenticateToken } from "./auth";
import { addStaged } from "../services/stagingService";
import { applyUfwOperation } from "../services/ufwService";
import type { Rule } from "@ufw-webui/shared";

const router = express.Router();

const jsonError = (res: express.Response, status: number, error: unknown) =>
  res.status(status).json({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });

type BulkRule = Rule & { note?: string };

type BulkRequest = {
  mode?: "apply" | "monitor";
  action?: "add" | "delete";
  rules?: BulkRule[];
};

const normalizeRule = (r: BulkRule): Rule => ({
  from: (r.from ?? "").trim(),
  to: (r.to ?? "").trim(),
});

const isValidRule = (r: Rule): boolean =>
  // from 또는 to 중 하나는 반드시 있어야 함
  r.from.length > 0 || r.to.length > 0;

// POST /api/ufw/bulk
//   body: {
//     mode:   "apply" | "monitor"   (default "apply")
//     action: "add" | "delete"      (default "add")
//     rules:  Rule[]                (from/to/note)
//   }
// 응답: { success, data: { applied, total, errors? } }
//   - mode=apply:   각 규칙을 UFW 에 직접 적용. 한 건 실패해도 나머지 계속.
//   - mode=monitor: 각 규칙을 staging 큐에 추가. addStaged 가 throw 하면 errors[] 에 기록.
router.post("/bulk", authenticateToken, async (req, res) => {
  try {
    const body = (req.body ?? {}) as BulkRequest;
    const mode: "apply" | "monitor" = body.mode === "monitor" ? "monitor" : "apply";
    const action: "add" | "delete" = body.action === "delete" ? "delete" : "add";
    const rules = Array.isArray(body.rules) ? body.rules : [];

    if (rules.length === 0) {
      throw new Error("rules 배열이 비어 있습니다.");
    }

    const errors: string[] = [];
    let applied = 0;

    if (mode === "monitor") {
      // 모니터링 모드: 큐에만 추가. 한 건 실패 시 나머지 계속.
      for (const raw of rules) {
        const r = normalizeRule(raw);
        if (!isValidRule(r)) {
          errors.push(
            `from 또는 to 중 하나는 필요합니다: from='${r.from}' to='${r.to}'`,
          );
          continue;
        }
        try {
          await addStaged({ ...r, action, note: raw.note });
          applied += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${r.from || "모든 곳"} → ${r.to || "모든 곳"}: ${message}`);
        }
      }
    } else {
      // 즉시 적용: UFW 에 직접. 한 건이 실패해도 나머지 계속.
      for (const raw of rules) {
        const r = normalizeRule(raw);
        if (!isValidRule(r)) {
          errors.push(
            `from 또는 to 중 하나는 필요합니다: from='${r.from}' to='${r.to}'`,
          );
          continue;
        }
        try {
          await applyUfwOperation(action, r);
          applied += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${r.from || "모든 곳"} → ${r.to || "모든 곳"}: ${message}`);
        }
      }
    }

    res.json({
      success: true,
      data: {
        mode,
        action,
        applied,
        total: rules.length,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    jsonError(res, 400, error);
  }
});

export default router;
