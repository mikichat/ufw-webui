import Mock from "mockjs";
import type { LogLevel, Rule, StagedRule, UfwStatus } from "@ufw-webui/shared";

type MockRequest = {
  body: string;
  url: string;
};

const ANYWHERE_LABEL = "모든 곳";

let ufwStatus: UfwStatus = {
  active: true,
  rules: [
    { from: "10022/tcp", to: ANYWHERE_LABEL },
    { from: ANYWHERE_LABEL, to: "10.0.0.0/8" },
    { from: ANYWHERE_LABEL, to: "192.168.0.0/16" },
  ],
};

// 모니터링(대기) 작업 메모리 저장소. action 필드 포함.
let stagedRules: StagedRule[] = [];

let currentLogLevel: LogLevel = "off";

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `mock-${Math.random().toString(36).slice(2, 10)}`;

const parseRule = (rule: Rule): { from: string; to: string } => ({
  from: (rule.from ?? "").trim(),
  to: (rule.to ?? "").trim(),
});

// ── 기존 UFW 상태 / 즉시 적용 ───────────────────────────────────────────

Mock.mock("/api/ufw/status", "get", () => ({
  success: true,
  data: ufwStatus,
}));

Mock.mock("/api/ufw/enable", "post", () => {
  ufwStatus.active = true;
  return { success: true, data: "UFW가 활성화되었습니다." };
});

Mock.mock("/api/ufw/disable", "post", () => {
  ufwStatus.active = false;
  return { success: true, data: "UFW가 비활성화되었습니다." };
});

Mock.mock("/api/ufw/add", "post", (options: MockRequest) => {
  const body = JSON.parse(options.body) as { rule: Rule };
  ufwStatus = { ...ufwStatus, rules: [...ufwStatus.rules, parseRule(body.rule)] };
  return { success: true, message: "규칙이 추가되었습니다." };
});

Mock.mock("/api/ufw/delete", "post", (options: MockRequest) => {
  const body = JSON.parse(options.body) as { rule: Rule };
  const target = parseRule(body.rule);
  ufwStatus = {
    ...ufwStatus,
    rules: ufwStatus.rules.filter(
      (rule) => !(rule.from === target.from && rule.to === target.to),
    ),
  };
  return { success: true, message: "규칙이 삭제되었습니다." };
});

// ── 모니터링(대기) 작업 ────────────────────────────────────────────────

Mock.mock("/api/ufw/staged", "get", () => ({
  success: true,
  data: stagedRules,
}));

Mock.mock("/api/ufw/staged", "post", (options: MockRequest) => {
  const body = JSON.parse(options.body) as {
    rule: Rule & { action?: "add" | "delete"; note?: string };
  };
  const next: StagedRule = {
    id: generateId(),
    action: body.rule.action === "delete" ? "delete" : "add",
    from: (body.rule.from ?? "").trim(),
    to: (body.rule.to ?? "").trim(),
    note: body.rule.note?.trim() || undefined,
    createdAt: Date.now(),
  };
  stagedRules = [...stagedRules, next];
  return { success: true, data: next };
});

Mock.mock(RegExp("^/api/ufw/staged/[^/]+$"), "delete", (options: MockRequest) => {
  const id = options.url.split("/").pop() ?? "";
  const before = stagedRules.length;
  stagedRules = stagedRules.filter((rule) => rule.id !== id);
  if (stagedRules.length === before) {
    return { success: false, error: `대기 작업을 찾을 수 없습니다: ${id}` };
  }
  return { success: true, data: { id } };
});

Mock.mock(RegExp("^/api/ufw/staged/[^/]+/apply$"), "post", (options: MockRequest) => {
  const id = options.url.split("/").slice(-2, -1)[0] ?? "";
  const target = stagedRules.find((rule) => rule.id === id);
  if (!target) {
    return { success: false, error: `대기 작업을 찾을 수 없습니다: ${id}` };
  }
  if (target.action === "delete") {
    ufwStatus = {
      ...ufwStatus,
      rules: ufwStatus.rules.filter(
        (rule) => !(rule.from === target.from && rule.to === target.to),
      ),
    };
  } else {
    ufwStatus = { ...ufwStatus, rules: [...ufwStatus.rules, target] };
  }
  stagedRules = stagedRules.filter((rule) => rule.id !== id);
  return { success: true, data: { id } };
});

Mock.mock("/api/ufw/staged/apply-all", "post", () => {
  const order = (a: StagedRule) => (a.action === "add" ? 0 : 1);
  const sorted = [...stagedRules].sort((a, b) => order(a) - order(b));
  let applied = 0;
  const errors: string[] = [];
  const appliedIds: string[] = [];
  for (const rule of sorted) {
    try {
      if (rule.action === "delete") {
        ufwStatus = {
          ...ufwStatus,
          rules: ufwStatus.rules.filter(
            (r) => !(r.from === rule.from && r.to === rule.to),
          ),
        };
      } else {
        ufwStatus = { ...ufwStatus, rules: [...ufwStatus.rules, rule] };
      }
      applied += 1;
      appliedIds.push(rule.id);
    } catch (error) {
      errors.push(
        `${rule.action === "add" ? "추가" : "삭제"} ${rule.from || "모든 곳"} → ${rule.to || "모든 곳"}: ${String(error)}`,
      );
    }
  }
  stagedRules = stagedRules.filter((rule) => !appliedIds.includes(rule.id));
  return {
    success: true,
    data: {
      applied,
      total: applied,
      errors: errors.length > 0 ? errors : undefined,
    },
  };
});

// ── UFW 로깅 / 로그 ─────────────────────────────────────────────────────

const FAKE_LOG_SAMPLES = [
  "[UFW BLOCK] IN=eth0 OUT= MAC=... SRC=203.0.113.5 DST=10.0.0.10 LEN=60 TOS=0x00 PREC=0x00 TTL=51 ID=12345 PROTO=TCP SPT=44022 DPT=22 WINDOW=29200 RES=0x00 SYN URGP=0",
  "[UFW ALLOW] IN=eth0 OUT= MAC=... SRC=10.0.0.20 DST=10.0.0.10 LEN=64 TOS=0x00 PREC=0x00 TTL=64 ID=22222 PROTO=TCP SPT=51234 DPT=80 WINDOW=65535 RES=0x00 ACK URGP=0",
  "[UFW BLOCK] IN=eth0 OUT= MAC=... SRC=198.51.100.7 DST=10.0.0.10 LEN=52 TOS=0x00 PREC=0x00 TTL=49 ID=33333 PROTO=UDP SPT=53 DPT=33412 LEN=32",
];

Mock.mock("/api/ufw/logging", "get", () => ({
  success: true,
  data: {
    level: currentLogLevel,
    file: "/var/log/ufw.log",
    source: "file",
  },
}));

Mock.mock("/api/ufw/logging", "post", (options: MockRequest) => {
  const body = JSON.parse(options.body) as { level: LogLevel };
  currentLogLevel = body.level;
  return { success: true, data: { level: currentLogLevel, result: `Logging ${body.level}` } };
});

Mock.mock(RegExp("^/api/ufw/logs(\\?.*)?$"), "get", (options: MockRequest) => {
  const limitMatch = options.url.match(/limit=(\d+)/);
  const limit = limitMatch ? Math.max(1, Math.min(1000, Number(limitMatch[1]))) : 200;
  const lines = Array.from({ length: Math.min(limit, FAKE_LOG_SAMPLES.length) }, (_, i) => {
    const raw = FAKE_LOG_SAMPLES[i % FAKE_LOG_SAMPLES.length];
    const headerMatch = raw.match(/\[UFW\s+(BLOCK|ALLOW|AUDIT|LIMIT)\]/i);
    return {
      raw,
      action: headerMatch ? (headerMatch[1].toUpperCase() as "BLOCK" | "ALLOW") : null,
      iface: (raw.match(/\bIN=(\S+)/) ?? [])[1] ?? null,
      src: (raw.match(/\bSRC=(\S+)/) ?? [])[1] ?? null,
      dst: (raw.match(/\bDST=(\S+)/) ?? [])[1] ?? null,
      proto: (raw.match(/\bPROTO=(\S+)/) ?? [])[1] ?? null,
      spt: Number((raw.match(/\bSPT=(\d+)/) ?? [])[1] ?? 0) || null,
      dpt: Number((raw.match(/\bDPT=(\d+)/) ?? [])[1] ?? 0) || null,
    };
  });
  return { success: true, data: { file: "/var/log/ufw.log", lines } };
});

// SSE 스트림은 mock 환경에서 단순 polling 흉내도 가능하지만, axios + EventSource
// 의존성 차이 때문에 mock 인터셉트 대신 EventSource 가 받을 수 있도록 fetch 기반
// 응답은 어렵다. UI 측에서 /api/ufw/logs?limit=N 폴링으로 폴백하도록 둔다.
