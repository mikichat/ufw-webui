import { spawn } from "child_process";
import type { LogLevel, Rule, UfwStatus } from "@ufw-webui/shared";

// exec() + 문자열 보간은 셸 메타문자에 취약하다 (예: from: "; cat /etc/passwd #").
// execFile/spawn 은 인자 배열로 명령을 실행하므로 셸을 거치지 않고 안전.
// Rule 의 from/to 도 별도 인자로 전달한다.

const executeUfw = (args: string[]): Promise<string> =>
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

    const [to, , from] = line.split(/\s{2,}/);
    if (to && from) {
      ufwStatus.rules.push({ to, from });
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
  executeUfw(["allow", ...ruleToArgs(rule)]);

export const deleteRule = async (rule: Rule) =>
  executeUfw(["delete", "allow", ...ruleToArgs(rule)]);

// staged 라우터에서 사용할 표준 적용 진입점. action 에 따라 add/delete 분기.
export const applyUfwOperation = (action: "add" | "delete", rule: Rule) =>
  action === "delete" ? deleteRule(rule) : addRule(rule);

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
