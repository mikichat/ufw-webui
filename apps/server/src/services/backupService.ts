import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { backupsDir, ensureBackupsDir } from "./paths";
import { executeUfw } from "./ufwService";

// UFW 정책 파일 디렉토리. 모든 파일은 root 만 읽기/쓰기 가능.
// 서버는 root 로 실행된다는 전제 (CLAUDE.md + install-service.sh 모두 명시).
const UFW_DIR = "/etc/ufw";

// 백업 대상 4개 파일. before/after.init (사용자 후크) 와 before/after.rules
// (UFW 프레임워크 자체) 는 의도적으로 제외한다.
const UFW_FILES = ["user.rules", "user6.rules", "ufw.conf", "sysctl.conf"] as const;
export type UfwFileName = (typeof UFW_FILES)[number];

const MANIFEST_VERSION = 1;
const MAX_BACKUPS = 10;

const isoTimestamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

const readUfwFile = (name: UfwFileName): string => {
  try {
    return fs.readFileSync(path.join(UFW_DIR, name), "utf8");
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e?.code === "EACCES") {
      throw new Error(
        `/etc/ufw/${name} 에 접근할 권한이 없습니다. 서버를 root 로 실행하세요. (${e.message})`,
      );
    }
    throw e;
  }
};

const writeUfwFile = (name: UfwFileName, content: string): void => {
  try {
    fs.writeFileSync(path.join(UFW_DIR, name), content, { mode: 0o644 });
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      throw new Error(
        `/etc/ufw/${name} 에 쓸 권한이 없습니다. 서버를 root 로 실행하세요. (${e.message})`,
      );
    }
    throw e;
  }
};

// 시스템 sha256sum 호출. busybox/dash 코어유틸리티 어디든 있음.
const sha256File = (absPath: string): string => {
  const { spawnSync } = require("child_process") as typeof import("child_process");
  const out = spawnSync("sha256sum", [absPath], { encoding: "utf8" });
  if (out.status !== 0) {
    throw new Error(`sha256sum 실패: ${(out.stderr ?? "").trim()}`);
  }
  const hash = out.stdout.trim().split(/\s+/)[0];
  if (!hash) {
    throw new Error(`sha256sum 출력 파싱 실패: ${out.stdout}`);
  }
  return hash;
};

const getUfwVersion = async (): Promise<string> => {
  try {
    const v = await executeUfw(["version"]);
    return v.split("\n")[0]?.trim() || "unknown";
  } catch (_error) {
    return "unknown";
  }
};

type ManifestFile = {
  name: UfwFileName;
  sha256: string;
  size: number;
  mode: string;
};

type Manifest = {
  schemaVersion: number;
  tool: string;
  createdAt: string;
  hostname: string;
  ufwVersion: string;
  platform: string;
  files: ManifestFile[];
};

const buildManifest = async (stageDir: string): Promise<Manifest> => {
  const files: ManifestFile[] = UFW_FILES.map((name) => {
    const abs = path.join(stageDir, name);
    const stat = fs.statSync(abs);
    return {
      name,
      sha256: sha256File(abs),
      size: stat.size,
      mode: "0644",
    };
  });
  return {
    schemaVersion: MANIFEST_VERSION,
    tool: "ufw-webui",
    createdAt: new Date().toISOString(),
    hostname: os.hostname(),
    ufwVersion: await getUfwVersion(),
    platform: process.platform,
    files,
  };
};

// tar stdout 을 Buffer 로 모으기
const tarCreateToBuffer = (stageDir: string, entryName: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const child = spawn("tar", ["czf", "-", "-C", stageDir, entryName]);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) =>
      process.stderr.write(`[backup tar] ${c.toString()}`),
    );
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`tar 종료 코드 ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });

// tar stdout 을 응답 스트림으로 직접 파이프
const tarCreateToStream = (
  stageDir: string,
  entryName: string,
  res: { write: (chunk: Buffer) => boolean; end: () => void; on: Function },
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("tar", ["czf", "-", "-C", stageDir, entryName]);
    child.stdout.on("data", (c: Buffer) => res.write(c));
    child.stderr.on("data", (c: Buffer) =>
      process.stderr.write(`[backup tar] ${c.toString()}`),
    );
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`tar 종료 코드 ${code}`));
        return;
      }
      res.end();
      resolve();
    });
  });

const tarList = (buf: Buffer): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const child = spawn("tar", ["tzf", "-"]);
    let out = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on("data", (c: Buffer) =>
      process.stderr.write(`[backup tar] ${c.toString()}`),
    );
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`tar 종료 코드 ${code}`));
        return;
      }
      resolve(out.split("\n").filter((s) => s.trim()));
    });
    child.stdin.end(buf);
  });

const tarExtract = (buf: Buffer, targetDir: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("tar", ["xzf", "-", "-C", targetDir]);
    child.stderr.on("data", (c: Buffer) =>
      process.stderr.write(`[backup tar] ${c.toString()}`),
    );
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`tar 종료 코드 ${code}`));
        return;
      }
      resolve();
    });
    child.stdin.end(buf);
  });

// 현재 4개 파일을 임시 staging 디렉토리로 복사하고 manifest.json 생성.
//   디렉토리 레이아웃:
//     tmpRoot/                                  ← tar 의 -C 대상
//     └── ufw-backup-<ts>/                      ← entryName
//         ├── user.rules
//         ├── user6.rules
//         ├── ufw.conf
//         ├── sysctl.conf
//         └── manifest.json
//   tar 호출 시 -C tmpRoot ufw-backup-<ts> 로 entryName 디렉토리 전체를 묶음.
const stageCurrent = async (): Promise<{
  tmpRoot: string;
  entryName: string;
}> => {
  const ts = isoTimestamp();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ufw-webui-bak-"));
  const stageDir = path.join(tmpRoot, `ufw-backup-${ts}`);
  fs.mkdirSync(stageDir, { recursive: true });
  for (const name of UFW_FILES) {
    const content = readUfwFile(name);
    fs.writeFileSync(path.join(stageDir, name), content);
  }
  const manifest = await buildManifest(stageDir);
  fs.writeFileSync(
    path.join(stageDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  return { tmpRoot, entryName: `ufw-backup-${ts}` };
};

// 수동 백업 생성 (UI 의 다운로드 시점에서 호출되지만, 서버 디스크에는
// 다운로드 응답만 하고 저장은 하지 않음). pre-restore 시에만 서버에 보관.
export const streamCurrentBackup = async (
  res: {
    setHeader: (name: string, value: string) => void;
    write: (chunk: Buffer) => boolean;
    end: () => void;
    on: Function;
  },
): Promise<void> => {
  const { tmpRoot, entryName } = await stageCurrent();
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${entryName}.tar.gz"`,
  );
  try {
    await tarCreateToStream(tmpRoot, entryName, res);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
};

// 서버 디스크에 보관되는 백업 파일 생성. pre-restore 시 자동 호출.
export const buildBackupTarGz = async (opts: {
  kind: "manual" | "pre-restore";
}): Promise<{ path: string; filename: string; size: number }> => {
  const { tmpRoot, entryName } = await stageCurrent();
  try {
    ensureBackupsDir();
    const ts = isoTimestamp();
    const filename = `${opts.kind}-${ts}.tar.gz`;
    const outPath = path.join(backupsDir(), filename);
    const buf = await tarCreateToBuffer(tmpRoot, entryName);
    fs.writeFileSync(outPath, buf);
    return { path: outPath, filename, size: buf.length };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
};

export type RestoreResult = {
  restored: UfwFileName[];
  preBackup: string;
  reloaded: boolean;
  warnings: string[];
};

export const restoreFromBuffer = async (buf: Buffer): Promise<RestoreResult> => {
  // 1) tar 검증 + 목록 확인
  let entries: string[];
  try {
    entries = await tarList(buf);
  } catch (error) {
    throw new Error(
      `업로드된 파일이 유효한 tar.gz 가 아닙니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (entries.length === 0) {
    throw new Error("tar.gz 가 비어 있습니다.");
  }
  // 모든 entry 는 "<dirPrefix>/..." 형태. 첫 entry 의 최상위 디렉토리명을 prefix 로 쓴다.
  // (trailing slash 만 있는 루트 entry 는 includes("/") 가 true 라 find 로는 못 잡는다.)
  const dirPrefix = entries[0].split("/")[0];
  if (!dirPrefix) {
    throw new Error("백업 디렉토리 prefix 가 없습니다 (정상: ufw-backup-<ts>/)");
  }
  const expectedPrefix = `${dirPrefix}/`;
  for (const name of UFW_FILES) {
    if (!entries.includes(`${expectedPrefix}${name}`)) {
      throw new Error(`필수 파일이 백업에 없습니다: ${expectedPrefix}${name}`);
    }
  }
  if (!entries.includes(`${expectedPrefix}manifest.json`)) {
    throw new Error("manifest.json 이 백업에 없습니다.");
  }

  // 2) 임시 디렉토리에 추출
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ufw-webui-restore-"));
  try {
    await tarExtract(buf, tmpRoot);
    const stageDir = path.join(tmpRoot, dirPrefix);

    // 3) manifest 검증
    const manifestPath = path.join(stageDir, "manifest.json");
    let manifest: Manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
    } catch (error) {
      throw new Error(
        `manifest.json 파싱 실패: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (manifest.schemaVersion !== MANIFEST_VERSION) {
      throw new Error(`지원하지 않는 manifest 버전: ${manifest.schemaVersion}`);
    }
    for (const m of manifest.files) {
      const abs = path.join(stageDir, m.name);
      if (!fs.existsSync(abs)) {
        throw new Error(`manifest 가 가리키는 파일이 없습니다: ${m.name}`);
      }
      const stat = fs.statSync(abs);
      if (stat.size !== m.size) {
        throw new Error(
          `파일 크기 불일치 (${m.name}): manifest=${m.size}, 실제=${stat.size}`,
        );
      }
      const actual = sha256File(abs);
      if (actual !== m.sha256) {
        throw new Error(`SHA256 불일치 (${m.name})`);
      }
    }

    // 4) 자동 사전 백업 (서버 디스크 보존)
    const pre = await buildBackupTarGz({ kind: "pre-restore" });
    rotateBackups();

    // 5) 파일 교체
    const warnings: string[] = [];
    const restored: UfwFileName[] = [];
    const ts = isoTimestamp();
    for (const name of UFW_FILES) {
      const targetPath = path.join(UFW_DIR, name);
      const backupPath = `${targetPath}.bak-${ts}`;
      try {
        if (fs.existsSync(targetPath)) {
          fs.copyFileSync(targetPath, backupPath);
        }
        const newContent = fs.readFileSync(path.join(stageDir, name), "utf8");
        writeUfwFile(name, newContent);
        restored.push(name);
      } catch (error) {
        warnings.push(
          `${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // 6) ufw reload (실패는 경고)
    let reloaded = false;
    try {
      await executeUfw(["reload"]);
      reloaded = true;
    } catch (error) {
      warnings.push(
        `ufw reload 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 7) 성공 시 .bak-* 정리 (reload 실패면 보존해 둠 — 수동 롤백용)
    if (reloaded) {
      for (const name of UFW_FILES) {
        const backupPath = path.join(UFW_DIR, `${name}.bak-${ts}`);
        try {
          if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
          }
        } catch (_error) {
          // ignore
        }
      }
    }

    return {
      restored,
      preBackup: pre.filename,
      reloaded,
      warnings,
    };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
};

export type BackupListEntry = {
  filename: string;
  sizeBytes: number;
  createdAt: number;
  kind: "manual" | "pre-restore";
};

export const listBackups = async (): Promise<BackupListEntry[]> => {
  ensureBackupsDir();
  const files = fs.readdirSync(backupsDir()).filter((n) => n.endsWith(".tar.gz"));
  return files
    .map((filename) => {
      const abs = path.join(backupsDir(), filename);
      const stat = fs.statSync(abs);
      const kind: BackupListEntry["kind"] = filename.startsWith("pre-")
        ? "pre-restore"
        : "manual";
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtimeMs,
        kind,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
};

export const rotateBackups = (max: number = MAX_BACKUPS): void => {
  ensureBackupsDir();
  const files = fs.readdirSync(backupsDir())
    .filter((n) => n.endsWith(".tar.gz"))
    .map((filename) => {
      const abs = path.join(backupsDir(), filename);
      return { abs, mtime: fs.statSync(abs).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime); // 오래된 순
  while (files.length > max) {
    const oldest = files.shift();
    if (!oldest) break;
    try {
      fs.unlinkSync(oldest.abs);
    } catch (_error) {
      // ignore — 다음 라운드에서 재시도
    }
  }
};

export const getBackupBuffer = async (filename: string): Promise<Buffer> => {
  const abs = path.join(backupsDir(), filename);
  // path traversal 방지: backupsDir 내부인지 확인
  if (!abs.startsWith(backupsDir() + path.sep) && abs !== backupsDir()) {
    throw new Error("잘못된 파일 경로입니다.");
  }
  if (!fs.existsSync(abs)) {
    throw new Error(`백업 파일을 찾을 수 없습니다: ${filename}`);
  }
  return fs.readFileSync(abs);
};