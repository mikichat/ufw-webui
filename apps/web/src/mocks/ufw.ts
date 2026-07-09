import Mock from "mockjs";
import type { FirewallPolicy, LogLevel, Rule, StagedRule, UfwStatus } from "@ufw-webui/shared";

type MockRequest = {
  body: string;
  url: string;
};

const ANYWHERE_LABEL = "모든 곳";

// 정책 필드를 가진 객체 보정. 누락이면 "allow".
const withPolicy = <T extends { from: string; to: string }>(
  r: T,
): T & { policy: FirewallPolicy } => ({
  ...r,
  policy: (r as { policy?: FirewallPolicy }).policy ?? "allow",
});

const isPolicy = (v: unknown): v is FirewallPolicy =>
  v === "allow" || v === "deny";

const policyLabel = (p: FirewallPolicy | undefined): string =>
  p === "deny" ? "차단" : "허용";

// 정책 포함 규칙 매칭. 정책이 다른 규칙은 별개로 인식.
const rulesEqual = (a: { from: string; to: string; policy?: FirewallPolicy }, b: { from: string; to: string; policy?: FirewallPolicy }) =>
  a.from === b.from && a.to === b.to && (a.policy ?? "allow") === (b.policy ?? "allow");

let ufwStatus: UfwStatus = {
  active: true,
  rules: [
    withPolicy({ from: "10022/tcp", to: ANYWHERE_LABEL }),
    withPolicy({ from: ANYWHERE_LABEL, to: "10.0.0.0/8" }),
    withPolicy({ from: ANYWHERE_LABEL, to: "192.168.0.0/16" }),
  ],
};

// 모니터링(대기) 작업 메모리 저장소. action 필드 포함.
let stagedRules: StagedRule[] = [];

let currentLogLevel: LogLevel = "off";

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `mock-${Math.random().toString(36).slice(2, 10)}`;

const parseRule = (rule: Rule): { from: string; to: string; policy: FirewallPolicy } => ({
  from: (rule.from ?? "").trim(),
  to: (rule.to ?? "").trim(),
  policy: isPolicy(rule.policy) ? rule.policy : "allow",
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
    rules: ufwStatus.rules.filter((rule) => !rulesEqual(rule, target)),
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
    policy: isPolicy(body.rule.policy) ? body.rule.policy : "allow",
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
      rules: ufwStatus.rules.filter((rule) => !rulesEqual(rule, target)),
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
          rules: ufwStatus.rules.filter((r) => !rulesEqual(r, rule)),
        };
      } else {
        ufwStatus = { ...ufwStatus, rules: [...ufwStatus.rules, rule] };
      }
      applied += 1;
      appliedIds.push(rule.id);
    } catch (error) {
      errors.push(
        `${rule.action === "add" ? "추가" : "삭제"} ${policyLabel(rule.policy)} ${rule.from || "모든 곳"} → ${rule.to || "모든 곳"}: ${String(error)}`,
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

// ── 대량 규칙 ─────────────────────────────────────────────────────────

type BulkBody = {
  mode: "apply" | "monitor";
  action: "add" | "delete";
  rules: { from: string; to: string; note?: string; policy?: FirewallPolicy }[];
};

const generateBulkId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `mock-bulk-${Math.random().toString(36).slice(2, 10)}`;

Mock.mock("/api/ufw/bulk", "post", (options: MockRequest) => {
  const body = JSON.parse(options.body) as BulkBody;
  const mode = body.mode === "monitor" ? "monitor" : "apply";
  const action = body.action === "delete" ? "delete" : "add";
  const rules = Array.isArray(body.rules) ? body.rules : [];

  let applied = 0;
  const errors: string[] = [];

  for (const raw of rules) {
    const from = (raw.from ?? "").trim();
    const to = (raw.to ?? "").trim();
    const policy: FirewallPolicy = isPolicy(raw.policy) ? raw.policy : "allow";
    if (!from && !to) {
      errors.push(`from 또는 to 중 하나는 필요합니다: from='${from}' to='${to}'`);
      continue;
    }
    if (mode === "monitor") {
      stagedRules = [
        ...stagedRules,
        {
          id: generateBulkId(),
          action,
          from,
          to,
          policy,
          note: raw.note?.trim() || undefined,
          createdAt: Date.now(),
        },
      ];
      applied += 1;
    } else {
      try {
        if (action === "delete") {
          ufwStatus = {
            ...ufwStatus,
            rules: ufwStatus.rules.filter((r) => !rulesEqual(r, { from, to, policy })),
          };
        } else {
          ufwStatus = { ...ufwStatus, rules: [...ufwStatus.rules, { from, to, policy }] };
        }
        applied += 1;
      } catch (error) {
        errors.push(
          `${policyLabel(policy)} ${from || "모든 곳"} → ${to || "모든 곳"}: ${String(error)}`,
        );
      }
    }
  }

  return {
    success: true,
    data: {
      mode,
      action,
      applied,
      total: rules.length,
      errors: errors.length > 0 ? errors : undefined,
    },
  };
});

// SSE 스트림은 mock 환경에서 단순 polling 흉내도 가능하지만, axios + EventSource
// 의존성 차이 때문에 mock 인터셉트 대신 EventSource 가 받을 수 있도록 fetch 기반
// 응답은 어렵다. UI 측에서 /api/ufw/logs?limit=N 폴링으로 폴백하도록 둔다.

// ── 규칙 수정 (delete + add) ─────────────────────────────────────────

type UpdateBody = {
  old: { from: string; to: string; policy?: FirewallPolicy };
  new: { from: string; to: string; policy?: FirewallPolicy };
  mode: "apply" | "monitor";
  note?: string;
};

Mock.mock("/api/ufw/update", "post", (options: MockRequest) => {
  const body = JSON.parse(options.body) as UpdateBody;
  const oldFrom = (body.old.from ?? "").trim();
  const oldTo = (body.old.to ?? "").trim();
  const oldPolicy: FirewallPolicy = isPolicy(body.old.policy) ? body.old.policy : "allow";
  const newFrom = (body.new.from ?? "").trim();
  const newTo = (body.new.to ?? "").trim();
  const newPolicy: FirewallPolicy = isPolicy(body.new.policy) ? body.new.policy : "allow";
  const mode = body.mode === "monitor" ? "monitor" : "apply";

  if (!oldFrom && !oldTo) {
    return { success: false, error: "old 의 from 또는 to 중 하나는 필요합니다." };
  }
  if (!newFrom && !newTo) {
    return { success: false, error: "new 의 from 또는 to 중 하나는 필요합니다." };
  }
  if (oldPolicy !== newPolicy) {
    return {
      success: false,
      error:
        "정책(허용/차단) 은 update 로 변경할 수 없습니다. 기존 규칙을 삭제하고 새로 추가하세요.",
    };
  }

  if (mode === "monitor") {
    stagedRules = [
      ...stagedRules,
      {
        id: generateBulkId(),
        action: "update" as const,
        from: newFrom,
        to: newTo,
        policy: newPolicy,
        note: body.note?.trim() || undefined,
        createdAt: Date.now(),
        old: { from: oldFrom, to: oldTo, policy: oldPolicy },
      },
    ];
    return {
      success: true,
      data: {
        mode,
        staged: 1,
        message: "대기열에 변경 작업이 추가되었습니다.",
        rule: stagedRules[stagedRules.length - 1],
      },
    };
  }

  // apply: delete(old) + add(new)
  if (oldFrom !== newFrom || oldTo !== newTo) {
    ufwStatus = {
      ...ufwStatus,
      rules: ufwStatus.rules.filter(
        (r) => !rulesEqual(r, { from: oldFrom, to: oldTo, policy: oldPolicy }),
      ),
    };
    ufwStatus = { ...ufwStatus, rules: [...ufwStatus.rules, { from: newFrom, to: newTo, policy: newPolicy }] };
  }
  return {
    success: true,
    data: {
      mode,
      applied: 1,
      result: oldFrom === newFrom && oldTo === newTo ? "변경 없음" : "Rule updated",
    },
  };
});
