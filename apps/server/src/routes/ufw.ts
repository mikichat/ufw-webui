import express from "express";
import { authenticateToken } from "./auth";
import {
  addRule,
  deleteRule,
  disableUfw,
  enableUfw,
  getUfwStatus,
} from "../services/ufwService";

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

export default router;
