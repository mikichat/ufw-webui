import express from "express";
import { authenticateToken } from "./auth";
import {
  addRule,
  applyUfwOperation,
  deleteRule,
  disableUfw,
  enableUfw,
  getUfwStatus,
} from "../services/ufwService";
import { addStaged } from "../services/stagingService";
import type { Rule } from "@ufw-webui/shared";

const router = express.Router();

router.get("/status", authenticateToken, async (_req, res) => {
  try {
    const status = await getUfwStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : error,
    });
  }
});

router.post("/enable", authenticateToken, async (_req, res) => {
  try {
    const result = await enableUfw();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : error,
    });
  }
});

router.post("/disable", authenticateToken, async (_req, res) => {
  try {
    const result = await disableUfw();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : error,
    });
  }
});

router.post("/add", authenticateToken, async (req, res) => {
  try {
    const { rule } = req.body;
    const result = await addRule(rule);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : error,
    });
  }
});

router.post("/delete", authenticateToken, async (req, res) => {
  try {
    const { rule } = req.body;
    const result = await deleteRule(rule);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : error,
    });
  }
});

// POST /api/ufw/update
//   body: {
//     old:  { from, to }                  // 교체 대상
//     new:  { from, to }                  // 새 규칙
//     mode: "apply" | "monitor"           (default "apply")
//     note?: string                       (monitor 모드에서만 저장)
//   }
//   UFW 는 "modify" 명령이 없으므로 delete(old) + add(new) 시퀀스로 처리한다.
//   monitor 모드면 staging 큐에 action="update" 항목으로 저장 (apply-all 시 같은 시퀀스 실행).
router.post("/update", authenticateToken, async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      old?: Rule;
      new?: Rule;
      mode?: "apply" | "monitor";
      note?: string;
    };
    const old = body.old;
    const next = body.new;
    const mode: "apply" | "monitor" = body.mode === "monitor" ? "monitor" : "apply";
    const note = typeof body.note === "string" ? body.note : undefined;

    if (!old || !next) {
      throw new Error("old 와 new 규칙이 모두 필요합니다.");
    }
    const fromOld = (old.from ?? "").trim();
    const toOld = (old.to ?? "").trim();
    const fromNew = (next.from ?? "").trim();
    const toNew = (next.to ?? "").trim();

    if (!fromOld && !toOld) {
      throw new Error("old 의 from 또는 to 중 하나는 필요합니다.");
    }
    if (!fromNew && !toNew) {
      throw new Error("new 의 from 또는 to 중 하나는 필요합니다.");
    }

    if (mode === "monitor") {
      const staged = await addStaged({
        action: "update",
        from: fromNew,
        to: toNew,
        policy: next.policy,
        note,
        old: { from: fromOld, to: toOld, policy: old.policy },
      });
      res.json({
        success: true,
        data: {
          mode,
          staged: 1,
          message: "대기열에 변경 작업이 추가되었습니다.",
          rule: staged,
        },
      });
      return;
    }

    // apply mode: 실제 delete + add 실행.
    // 정책(allow/deny) 은 update 로 변경 불가. delete + add 두 단계로 안내한다.
    const oldPolicy = old.policy ?? "allow";
    const newPolicy = next.policy ?? "allow";
    if (oldPolicy !== newPolicy) {
      res.status(400).json({
        success: false,
        error:
          "정책(허용/차단) 은 update 로 변경할 수 없습니다. 기존 규칙을 삭제하고 새로 추가하세요.",
      });
      return;
    }
    const result = await applyUfwOperation(
      "update",
      { from: fromNew, to: toNew, policy: newPolicy },
      { from: fromOld, to: toOld, policy: oldPolicy },
    );
    res.json({ success: true, data: { mode, applied: 1, result } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
