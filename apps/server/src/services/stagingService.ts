import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { FirewallPolicy, Rule, StagedRule } from "@ufw-webui/shared";

const dataDir = process.env.UFW_WEBUI_DATA_DIR
  ? path.resolve(process.env.UFW_WEBUI_DATA_DIR)
  : path.resolve(process.cwd(), "data");
const stagedFilePath = path.join(dataDir, "staged-rules.json");

const ensureDataDir = () => {
  fs.mkdirSync(dataDir, { recursive: true });
};

const isStagedRule = (v: unknown): v is StagedRule => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.from === "string" && typeof o.to === "string";
};

// 기존 파일 (action/policy 필드 없음) 호환: 누락 시 각각 "add" / "allow" 로 보정.
const normalize = (raw: unknown[]): StagedRule[] => {
  return raw.filter(isStagedRule).map((rule) => {
    const policy = (rule.policy ?? "allow") as FirewallPolicy;
    const old =
      rule.old && typeof rule.old === "object"
        ? {
            from: rule.old.from,
            to: rule.old.to,
            policy: (rule.old.policy ?? "allow") as FirewallPolicy,
          }
        : undefined;
    return {
      ...rule,
      action: rule.action ?? "add",
      policy,
      ...(old ? { old } : {}),
    };
  });
};

const readStaged = (): StagedRule[] => {
  try {
    const raw = fs.readFileSync(stagedFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalize(parsed) : [];
  } catch (_error) {
    return [];
  }
};

const writeStaged = (staged: StagedRule[]) => {
  ensureDataDir();
  fs.writeFileSync(stagedFilePath, JSON.stringify(staged, null, 2), "utf8");
};

export const listStaged = async (): Promise<StagedRule[]> => readStaged();

export type AddStagedInput = Rule & {
  action?: "add" | "delete" | "update";
  note?: string;
  // action="update" 일 때만 필수. 교체 대상 원본 규칙.
  old?: { from: string; to: string; policy?: FirewallPolicy };
};

export const addStaged = async (input: AddStagedInput): Promise<StagedRule> => {
  const staged = readStaged();
  const action = input.action ?? "add";

  if (action === "update" && !input.old) {
    throw new Error("update 작업에는 old (원본 규칙) 가 필요합니다.");
  }

  const next: StagedRule = {
    id: randomUUID(),
    action,
    from: (input.from ?? "").trim(),
    to: (input.to ?? "").trim(),
    policy: (input.policy ?? "allow") as FirewallPolicy,
    note: input.note?.trim() || undefined,
    createdAt: Date.now(),
    old:
      action === "update" && input.old
        ? {
            from: (input.old.from ?? "").trim(),
            to: (input.old.to ?? "").trim(),
            policy: (input.old.policy ?? "allow") as FirewallPolicy,
          }
        : undefined,
  };
  staged.push(next);
  writeStaged(staged);
  return next;
};

export const removeStaged = async (id: string): Promise<void> => {
  const staged = readStaged();
  const filtered = staged.filter((rule) => rule.id !== id);
  if (filtered.length === staged.length) {
    throw new Error(`대기 규칙을 찾을 수 없습니다: ${id}`);
  }
  writeStaged(filtered);
};

export const clearStaged = async (): Promise<void> => {
  writeStaged([]);
};

// 부분 적용 후 성공한 항목만 제거한 새 목록을 저장한다.
export const replaceStaged = async (next: StagedRule[]): Promise<void> => {
  writeStaged(next);
};

export const findStaged = async (id: string): Promise<StagedRule | undefined> => {
  const staged = readStaged();
  return staged.find((rule) => rule.id === id);
};
