import { spawn } from "child_process";
import type { FirewallPolicy, LogLevel, Rule, UfwStatus } from "@ufw-webui/shared";

// exec() + 문자열 보간은 셸 메타문자에 취약하다 (예: from: "; cat /etc/passwd #").
// execFile/spawn 은 인자 배열로 명령을 실행하므로 셸을 거치지 않고 안전.
// Rule 의 from/to 도 별도 인자로 전달한다.

// 정책 기본값. Rule.policy 가 없으면 이 값으로 동작 (하위호환).
const DEFAULT_POLICY: FirewallPolicy = "allow";
const resolvePolicy = (rule: Rule): FirewallPolicy => rule.policy ?? DEFAULT_POLICY;

export const executeUfw = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn("ufw", args);
    let stdout = "";
    let stderr = "";

    console.log(`Executing "ufw ${args.join(" ")}"`);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      reject(new Error(err.message));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const message = stderr.trim() || `ufw exited with code ${code}`;
        console.log(`Error: ${message}`);
        reject(new Error(message));
        return;
      }
      console.log(`Result: ${stdout.trim()}`);
      resolve(stdout.trim());
    });
  });

export const getUfwStatus = async (): Promise<UfwStatus> => {
  const result = await executeUfw(["status"]);
  const lines = result.split("\n").map((line) => line.trim());
  const ufwStatus: UfwStatus = { active: false, rules: [] };

  if (lines[0]?.startsWith("Status: active")) {
    ufwStatus.active = true;
  }

  for (let index = 3; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line || line.includes("(v6)") || line.includes("--")) {
      continue;
    }

    // ufw status:        [To, , , From]   (2 컬럼, 정책 없음)
    // ufw status verbose: [To, Action, From] (3 컬럼, ALLOW/DENY 인식)
    const parts = line.split(/\s{2,}/);
    if (parts.length === 2) {
      const [to, from] = parts;
      if (to && from) {
        ufwStatus.rules.push({ to, from, policy: DEFAULT_POLICY });
      }
    } else if (parts.length >= 3) {
      const [to, actionToken, from] = parts;
      if (to && from && actionToken) {
        const inferred: FirewallPolicy = /^ALLOW/i.test(actionToken)
          ? "allow"
          : "deny";
        ufwStatus.rules.push({ to, from, policy: inferred });
      }
    }
  }

  return ufwStatus;
};

export const enableUfw = async () => executeUfw(["--force", "enable"]);

export const disableUfw = async () => executeUfw(["disable"]);

// ruleToString 대신 ufw 의 서브커맨드 인자 배열을 직접 반환한다.
//   from 만: ["from", "10.0.0.0/8"]
//   to   만: ["22/tcp"]
//   둘 다:  ["from", "10.0.0.0/8", "to", "22/tcp"]
const ruleToArgs = (rule: Rule): string[] => {
  const fromAnywhere = !rule.from || rule.from === "Anywhere";
  const toAnywhere = !rule.to || rule.to === "Anywhere";

  if (fromAnywhere && toAnywhere) {
    throw new Error("규칙에 출발지 또는 도착지 중 하나는 반드시 필요합니다.");
  }
  if (fromAnywhere) {
    return [rule.to];
  }
  if (toAnywhere) {
    return ["from", rule.from];
  }
  return ["from", rule.from, "to", rule.to];
};

export const addRule = async (rule: Rule) =>
  executeUfw([resolvePolicy(rule), ...ruleToArgs(rule)]);

export const deleteRule = async (rule: Rule) =>
  executeUfw(["delete", resolvePolicy(rule), ...ruleToArgs(rule)]);

// staged 라우터에서 사용할 표준 적용 진입점. action 에 따라 분기.
//   "add"    → ufw <policy> ...
//   "delete" → ufw delete <policy> ...
//   "update" → ufw delete <old.policy> <old> + ufw <new.policy> <new> 순서.
//              (delete 먼저: 새 규칙이 잘못돼도 기존 SSH 차단이 풀린 채로 끝나지 않게 하기 위함)
//              old 가 없으면 throw. old 와 new 가 동일하면 그대로 add (idempotent 변경).
export const applyUfwOperation = (
  action: "add" | "delete" | "update",
  rule: Rule,
  old?: { from: string; to: string; policy?: FirewallPolicy },
): Promise<string> => {
  if (action === "delete") return deleteRule(rule);
  if (action === "add") return addRule(rule);
  // update
  if (!old) {
    throw new Error("update 작업에는 old (원본 규칙) 가 필요합니다.");
  }
  // 정책까지 같아야 "변경 없음". 정책만 바꾸는 케이스도 delete+add 시퀀스가 돌도록.
  if (
    old.from === rule.from &&
    old.to === rule.to &&
    (old.policy ?? DEFAULT_POLICY) === (rule.policy ?? DEFAULT_POLICY)
  ) {
    return Promise.resolve("변경 없음");
  }
  return deleteRule(old).then(() => addRule(rule));
};

// UFW logging 레벨 변경. off | low | medium | high | full 만 허용.
const ALLOWED_LOG_LEVELS: LogLevel[] = ["off", "low", "medium", "high", "full"];

export const setLogLevel = async (level: LogLevel): Promise<string> => {
  if (!ALLOWED_LOG_LEVELS.includes(level)) {
    throw new Error(`지원하지 않는 로그 레벨입니다: ${level}`);
  }
  return executeUfw(["logging", level]);
};

export const getCurrentLogLevel = async (): Promise<LogLevel> => {
  // `ufw status verbose` 의 첫 ~15줄 안에 "Logging: on (low)" 같은 라인이 있다.
  const result = await executeUfw(["status", "verbose"]);
  const match = result.match(/Logging:\s+(on|off)\s*\(([^)]+)\)/i);
  if (!match) {
    return "off";
  }
  const onOff = match[1].toLowerCase();
  const level = match[2].toLowerCase();
  if (onOff === "off") {
    return "off";
  }
  if (ALLOWED_LOG_LEVELS.includes(level as LogLevel)) {
    return level as LogLevel;
  }
  return "low";
};

// 정책 파일을 외부에서 교체한 뒤 UFW 가 새 파일을 다시 읽어 들이도록 한다.
// enable/disable 과 달리 reload 는 비활성 상태에서도 안전하므로 --force 불필요.
export const reloadUfw = async (): Promise<string> => executeUfw(["reload"]);
