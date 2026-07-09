// UFW 정책(액션) — allow | deny 만 지원.
//   "allow" = 통과, "deny" = 무음 차단.
// 정책은 옵셔널. 누락 시 클라이언트/서버 양쪽에서 "allow" 로 보정한다.
export type FirewallPolicy = "allow" | "deny";

export interface Rule {
  from: string;
  to: string;
  policy?: FirewallPolicy;
}

export interface UfwStatus {
  active: boolean;
  rules: Rule[];
}

// 모니터링 모드로 누적된 작업.
//   action="add"    : UFW 에 allow 를 추가하려는 의도
//   action="delete" : 기존 규칙을 제거하려는 의도
//   action="update" : 기존 규칙 (old) 을 제거하고 새 규칙 (from/to) 으로 교체. old 필드에 원본 보관.
// 사용자가 검토 후 명시적으로 "적용" 해야 실제 UFW 명령이 실행된다.
export interface StagedRule extends Rule {
  id: string;
  action: "add" | "delete" | "update";
  note?: string;
  createdAt: number;
  // action="update" 일 때만 사용. 교체 대상이 된 원본 규칙.
  old?: { from: string; to: string; policy?: FirewallPolicy };
}

// UFW 로그 한 줄을 구조화한 형태. tail -F 의 stdout 한 줄 = LogLine 1개.
export interface LogLine {
  raw: string;
  // [UFW BLOCK] / [UFW ALLOW] 같은 헤더 액션
  action: "BLOCK" | "ALLOW" | "AUDIT" | "LIMIT" | null;
  // IN=eth0 같은 입력 인터페이스
  iface: string | null;
  // SRC=1.2.3.4 / DST=5.6.7.8
  src: string | null;
  dst: string | null;
  // PROTO=TCP / SPT=12345 / DPT=22
  proto: string | null;
  spt: number | null;
  dpt: number | null;
}

export type LogLevel = "off" | "low" | "medium" | "high" | "full";

// 대량 입력 한 줄. 프런트에서 `from,to,note` 형식 텍스트를 파싱한 결과.
// from/to 는 선택적 — 둘 다 비면 무시. note 도 선택.
// 정책(allow/deny)도 옵셔널. 누락 시 폼 레벨 정책 또는 "allow" 로 보정.
export interface BulkRuleLine {
  from: string;
  to: string;
  note?: string;
  policy?: FirewallPolicy;
}
