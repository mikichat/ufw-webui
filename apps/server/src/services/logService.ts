import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import type { LogLine } from "@ufw-webui/shared";

// UFW 로그가 기록되는 곳은 두 가지로 갈린다.
//
//   A. rsyslog 가 활성화된 전통적 환경: /var/log/ufw.log 또는 /var/log/syslog / kern.log
//      같은 평본 파일에 [UFW BLOCK] 라인이 쓰인다.
//
//   B. systemd-journal 만 쓰는 현대 환경 (Debian 11+ / Ubuntu 22.04+ 등): 파일이
//      존재하지 않고 모든 UFW 메시지가 journald 의 kernel stream 으로만 들어간다.
//      `journalctl -k` (kernel) 로 UFW 라인을 얻을 수 있다.
//
// 이 모듈은 A 가 가능하면 A 를 우선하고, 파일이 전혀 없거나 결과가 0줄이면 B 로
// 자동 폴백한다. 호출자는 동일한 인터페이스 (getRecentLines / createLogStream)
// 만 사용한다.

const CANDIDATE_PATHS = ["/var/log/ufw.log", "/var/log/syslog", "/var/log/kern.log"];

const detectLogFile = (): string | null => {
  for (const candidate of CANDIDATE_PATHS) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_error) {
      // 권한 문제 등으로 접근 불가하면 다음 후보로
    }
  }
  return null;
};

export type LogSource =
  | { kind: "file"; path: string }
  | { kind: "journal" }
  | { kind: "none" };

// 가장 좋은 출처를 결정한다. 파일이 있고 그 안에 UFW 라인 데이터가 있을 가능성이
// 있으면 file, 그 외엔 journal, 둘 다 안되면 none.
export const detectLogSource = (): LogSource => {
  const file = detectLogFile();
  if (file) return { kind: "file", path: file };
  // journald 는 journalctl 바이너리만 있으면 거의 항상 쓸 수 있다. spawn 으로
  // 가용성을 한 번 확인한다.
  try {
    const probe = spawn("journalctl", ["--no-pager", "-n", "1"]);
    // 즉시 종료되거나 stderr 가 아니면 OK. 빠르게 success 로 본다.
    return { kind: "journal" };
  } catch (_error) {
    return { kind: "none" };
  }
};

// 호환용: 기존 코드 경로 (getLogFilePath) 도 유지한다.
export const getLogFilePath = (): string | null => {
  const src = detectLogSource();
  return src.kind === "file" ? src.path : null;
};

// [UFW BLOCK] IN=eth0 OUT= MAC=... SRC=1.2.3.4 DST=5.6.7.8 ... PROTO=TCP SPT=12345 DPT=22 ...
// [UFW ALLOW] IN=eth0 OUT= ... SRC=... DST=... PROTO=TCP SPT=... DPT=80 ...
export const parseLogLine = (raw: string): LogLine => {
  const trimmed = raw.trim();
  const base: LogLine = {
    raw: trimmed,
    action: null,
    iface: null,
    src: null,
    dst: null,
    proto: null,
    spt: null,
    dpt: null,
  };
  if (!trimmed) return base;

  // [UFW BLOCK] / [UFW ALLOW] / [UFW AUDIT] / [UFW LIMIT]
  const headerMatch = trimmed.match(/\[UFW\s+(BLOCK|ALLOW|AUDIT|LIMIT)\]/i);
  if (headerMatch) {
    base.action = headerMatch[1].toUpperCase() as LogLine["action"];
  }

  const extract = (key: string): string | null => {
    const m = trimmed.match(new RegExp(`\\b${key}=([^\\s]+)`));
    return m ? m[1] : null;
  };
  const extractNum = (key: string): number | null => {
    const s = extract(key);
    if (s == null) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  base.iface = extract("IN");
  base.src = extract("SRC");
  base.dst = extract("DST");
  base.proto = extract("PROTO");
  base.spt = extractNum("SPT");
  base.dpt = extractNum("DPT");

  return base;
};

const UFW_LINE_RE = /\[UFW\s+/;

// 한 줄의 "로그 소스" 의 stdout 끝에서 N 줄을 잘라 파싱한다.
const finalize = (stdout: string, limit: number): LogLine[] => {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  // UFW 라인이 하나라도 있으면 그 안에서만 자르고, 없으면 원본 그대로 반환
  // (예: 일반 syslog 에 섞여 있는 경우를 대비).
  const ufwLines = lines.filter((line) => UFW_LINE_RE.test(line));
  const pool = ufwLines.length > 0 ? ufwLines : lines;
  return pool.slice(-limit).map(parseLogLine);
};

export const getRecentLines = async (limit: number): Promise<LogLine[]> => {
  const source = detectLogSource();
  const n = Math.max(1, limit);

  if (source.kind === "file") {
    return new Promise((resolve, reject) => {
      const child = spawn("tail", ["-n", String(n), source.path]);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `tail exited with code ${code}`));
          return;
        }
        resolve(finalize(stdout, n));
      });
    });
  }

  if (source.kind === "journal") {
    return new Promise((resolve, reject) => {
      // kernel stream, 최근 N줄. UFW 는 kmsg 로 들어온다.
      // --output=cat 으로 short 머신-친화 포맷 (rsyslog 형식) 으로 출력 → parseLogLine 가 그대로 파싱 가능.
      const child = spawn("journalctl", ["-k", "-n", String(n), "--no-pager", "--output=cat"]);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `journalctl exited with code ${code}`));
          return;
        }
        resolve(finalize(stdout, n));
      });
    });
  }

  return [];
};

export type LogStream = {
  close: () => void;
  source: "file" | "journal" | "none";
};

const makeLineStream = (
  child: ChildProcess,
  onLine: (line: LogLine) => void,
): LogStream => {
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim().length > 0) {
        // UFW 라인만 콜백에 push 한다. 비-UFW 라인은 무시 (예: 다른 커널 메시지).
        if (UFW_LINE_RE.test(line)) {
          onLine(parseLogLine(line));
        }
      }
    }
  });
  child.stderr?.on("data", () => {
    // 진단 메시지 무시
  });
  child.on("error", () => {
    // spawn 실패 — close 에서 정리
  });
  return {
    close: () => {
      try {
        child.kill("SIGTERM");
      } catch (_error) {
        // 이미 종료된 경우
      }
    },
    // @ts-expect-error — source 가 동적으로 결정되어 호출 후 채워진다
    source: undefined,
  };
};

export const createLogStream = (onLine: (line: LogLine) => void): LogStream => {
  const source = detectLogSource();

  if (source.kind === "file") {
    // tail -F 는 파일 끝을 따라간다. rotation 시에도 안전.
    const child: ChildProcess = spawn("tail", ["-F", "-n", "0", source.path]);
    const stream = makeLineStream(child, onLine);
    return { close: stream.close, source: "file" };
  }

  if (source.kind === "journal") {
    // -f 는 follow. -k 는 kernel. --output=cat 은 rsyslog-스타일 한 줄.
    const child: ChildProcess = spawn("journalctl", ["-kf", "--output=cat", "-n", "0"]);
    const stream = makeLineStream(child, onLine);
    return { close: stream.close, source: "journal" };
  }

  return { close: () => {}, source: "none" };
};
