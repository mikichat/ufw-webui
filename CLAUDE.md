# CLAUDE.md

이 파일은 이 저장소의 코드로 작업할 때 Claude Code (claude.ai/code) 에 안내를 제공하기 위한 문서입니다.

## 프로젝트 개요

UFW WebUI — Linux `ufw` 를 관리하기 위한 작은 Express + React 콘솔입니다. 이 저장소는 다음 패키지로 구성된 pnpm 워크스페이스입니다.

- `apps/server` — Express + TypeScript 백엔드 (`@ufw-webui/server`)
- `apps/web` — React 18 + Vite 프론트엔드 (`@ufw-webui/web`)
- `packages/shared` — 두 앱이 공유하는 TypeScript 타입 (`@ufw-webui/shared`)

프론트엔드는 `apps/server/public` 으로 번들되며 백엔드의 `3000` 포트에서 서빙됩니다. `node_modules` 를 제외한 모든 것은 `pnpm dist` 실행 후 평평한 `dist/` 안에 들어갑니다.

핵심 기능:

- 로그인 후 JWT 발급 (bcrypt 해싱, JWT 시크릿 env)
- UFW 의 현재 활성화 상태 확인
- UFW 한 번에 켜기 / 끄기
- 기존 규칙 조회
- `allow` 규칙 추가 / 삭제
- **모니터링 모드** — 규칙 추가/삭제를 대기열에 모았다가 일괄 적용
- **메모** — 대기 작업에 한 줄 사유 첨부
- **대량 추가** — 한 줄에 한 규칙 (`from,to,note`) 텍스트로 N개 규칙을 한 번에 추가/모니터링
- **수정(변경)** — 기존 규칙을 delete + add 시퀀스로 교체. UFW 의 `modify` 부재를 보완. 모니터링/즉시 모두 지원
- **UFW 로그 조회** — 레벨 토글 + 최근 N 줄 + 실시간 (SSE / 폴링)
- **첫 관리자 부트스트랩** — 빈 사용자 상태에서만 일회성 등록

## 명령어

모든 명령어는 저장소 루트에서 pnpm 필터를 사용해 실행합니다.

```bash
pnpm install            # 모든 워크스페이스 의존성 설치

pnpm dev:web            # vite 개발 서버 :5173, 개발 모드에서 mock API
pnpm dev:server         # ts-node, 백엔드를 :3000 에서 실행

pnpm build              # web → server 순 (프론트엔드 결과물 → apps/server/public)
pnpm build:web          # 프론트엔드만 (tsc -b 포함)
pnpm build:server       # clean → tsc --noEmit → esbuild 번들을 apps/server/dist/index.js 로

pnpm start              # node apps/server/dist/index.js (운영)
pnpm dist               # pnpm build && bash ./dist.sh → 자체 완비된 dist/ 로 출하
pnpm dist:start         # node dist/dist/index.js

# 범위 지정 (특정 워크스페이스 내부에서 실행)
pnpm --filter @ufw-webui/server typecheck   # tsc --noEmit 검사만
pnpm --filter @ufw-webui/web lint           # apps/web 에 대한 eslint
pnpm --filter @ufw-webui/web build          # tsc -b && vite build
```

어떤 레벨에도 `test` 나 `lint:fix` 스크립트는 없습니다 — 둘 중 하나를 도입할 때는 패키지별로 추가하세요.

## 아키텍처

### 백엔드 (`apps/server/src/`)

- `index.ts` — Express 부트스트랩. `/api/auth`, `/api/ufw` 를 마운트하고 `../public` 을 정적으로 서빙하며 그 외 모든 요청은 `public/index.html` 로 폴백합니다 (SPA 라우팅). **서버는 `127.0.0.1:3000` 으로 바인딩** (외부 직접 접근 차단, reverse proxy 전용). `express-rate-limit` 로 `/api/auth/*` 분당 10회, `/api/auth/bootstrap` 5분에 3회 제한.
- `routes/auth.ts` — `authRouter` 와 `authenticateToken` 미들웨어. 엔드포인트: `POST /api/auth` (로그인, bcrypt 비교 + 레거시 SHA256+114514 lazy rehash), `POST /api/auth/bootstrap` (빈 사용자일 때만 1회 성공), `GET /api/auth/users/exists` (UI 폼 분기).
- `routes/ufw.ts` — `authenticateToken` 으로 보호되는 즉시 적용 엔드포인트: `GET /status`, `POST /enable`, `POST /disable`, `POST /add`, `POST /delete`, **`POST /update` (규칙 수정, delete+add 시퀀스)**. 모든 응답을 `{ success, data | error }` 형태로 감쌉니다.
- `routes/staged.ts` — 모니터링(대기) 작업 5개 엔드포인트: `GET/POST /staged`, `DELETE /staged/:id`, `POST /staged/:id/apply`, `POST /staged/apply-all` (add 먼저 → delete 나중 순서, 부분 실패 시 `errors[]` 동봉).
- `routes/bulk.ts` — **대량 추가** 1개 엔드포인트: `POST /api/ufw/bulk` (`{mode: "apply"|"monitor", action: "add"|"delete", rules: Rule[]}`). 부분 실패 시 `errors[]` 동봉. 모니터링 모드면 staging 큐에, 즉시 적용이면 UFW 에 직접.
- `routes/logs.ts` — UFW 로깅 4개 엔드포인트: `GET/POST /logging` (레벨 토글), `GET /logs?limit=N` (최근 N 줄, file 또는 journal 출처), `GET /logs/stream` (SSE 실시간).
- `services/authService.ts` — JWT (`jose`, HS256, 시크릿은 `process.env.UFW_WEBUI_JWT_SECRET` 사용, 미설정 시 WARNING + 기본값). 비밀번호는 **bcryptjs(cost 10)** 로 비교. 사용자는 `${UFW_WEBUI_DATA_DIR or cwd/data}/users.json` 에 JSON 배열로 저장. 첫 사용자는 `signupFirstUser` (bootstrap 전용) 으로만 등록.
- `services/ufwService.ts` — `child_process.spawn("ufw", args)` 인자 배열 호출. `getUfwStatus` 는 `ufw status` 의 출력을 한 줄씩 파싱하고, 공백 2개 이상을 기준으로 컬럼을 분리하며, `(v6)` 이나 대시(`-`) 라인은 건너뜁니다. `ruleToArgs` 는 `{from, to}` 로부터 `["allow" | "delete", "from", ..., "to", ...]` 형태의 인자 배열을 만듭니다. `applyUfwOperation(action, rule, old?)` 은 `action: "add" | "delete" | "update"` 분기. update 는 `deleteRule(old) + addRule(new)` 시퀀스. 로깅 레벨 변경 (`setLogLevel`, `getCurrentLogLevel`) 도 같은 패턴.
- `services/stagingService.ts` — `${DATA_DIR}/staged-rules.json` 에 작업 영속. `action: "add" | "delete" | "update"`, `note?`, `old?` 필드. `applyUfwOperation` 으로 분기 적용 (update 는 `old` 필수).
- `services/logService.ts` — `detectLogSource` 로 `file`(`/var/log/ufw.log` 등) 또는 `journal`(`journalctl -k`) 출처 결정. `getRecentLines` 와 `createLogStream` 양쪽이 같은 파서 사용. rsyslog 가 없는 환경에서는 journal 출처로 자동 폴백.

### 프론트엔드 (`apps/web/src/`)

- `main.tsx` — `import.meta.env.MODE === "development"` 일 때만 조건부로 `import("./mocks")` 를 호출하여, 개발 중에는 mockjs 가 axios 호출을 가로채게 합니다.
- `App.tsx` — `ConfigProvider locale={koKR}` (AntD 한국어 로케일) + 두 라우트의 `react-router-dom`: `/login` 과 `/` (`localStorage.token` 의 `isLoggedIn` 으로 보호).
- `components/LoginForm.tsx` — 부트스트랩/로그인 자동 분기 폼. `apiUsersExist()` 로 사용자 파일이 비어 있는지 확인. **평문 패스워드 그대로 전송** (HTTPS / reverse proxy 전제), `crypto-js` 의존성은 제거됨.
- `components/UFWWebUI.tsx` — 메인 패널. enable/disable `Switch`, 즉시 적용 / 모니터링(추가) / 모니터링(삭제) 3종 모드 라디오, 메모 입력, 현재 규칙 `Table`, 대기 작업 `Table` (개별 적용 / 버리기, 모두 적용 / 전체 삭제), UFW 로그 패널 (Collapse, 4초 폴링, BLOCK/ALLOW 필터, 일시정지, 레벨 셀렉터), **대량 추가** 모달 트리거 버튼. 로그아웃은 `localStorage.token` 을 비웁니다.
- `components/BulkRuleModal.tsx` — **대량 추가** 모달. `from,to,note` 한 줄 형식 텍스트 파싱, 추가/삭제 + 모니터링/즉시 모드 토글, 미리보기 (적용 가능 N건 + 무시된 빈 줄/주석), 부분 실패 시 errors 표시.
- `components/RuleEditModal.tsx` — **규칙 수정** 모달. 원본 from/to 표시, 새 from/to/note 입력, 모니터링/즉시 모드. UFW 가 modify 를 지원하지 않으므로 backend 가 delete(old) + add(new) 시퀀스로 처리.
- `services/api.ts` — `baseURL: "/api"` axios 인스턴스, bearer 토큰 인터셉터, `data.success === false` 시 reject 하는 응답 인터셉터 (mock/실 백엔드 일관 처리).
- `mocks/auth.ts` + `mocks/ufw.ts` — mockjs 핸들러. UFW mock 은 메모리 내 상태 + staged, logging, logs 엔드포인트 모의. 인증 mock 은 localStorage 에 사용자 목록 저장.

### 공유 (`packages/shared/src/index.ts`)

```ts
interface Rule       { from: string; to: string }
interface UfwStatus  { active: boolean; rules: Rule[] }
interface StagedRule extends Rule {
  id: string;
  action: "add" | "delete";
  note?: string;
  createdAt: number;
}
interface LogLine {
  raw: string;
  action: "BLOCK" | "ALLOW" | "AUDIT" | "LIMIT" | null;
  iface: string | null;
  src: string | null;
  dst: string | null;
  proto: string | null;
  spt: number | null;
  dpt: number | null;
}
type LogLevel = "off" | "low" | "medium" | "high" | "full";
```

두 앱 모두 워크스페이스 별칭 (`"@ufw-webui/shared": "workspace:*"`) 을 통해 이를 사용합니다.

### 빌드와 배포 파이프라인

1. `pnpm build:web` 은 `tsc -b && vite build` 를 실행하며, 결과물은 `apps/server/public` 으로 갑니다 (`vite.config.ts` 의 `outDir`, `emptyOutDir: true`).
2. `pnpm build:server` 는 `esbuild --bundle --platform=node --target=node20 --format=cjs` 를 `apps/server/dist/index.js` 로 실행합니다. 번들링 전 타입 체크 단계는 `tsc --noEmit` 입니다.
3. `pnpm dist` 는 `dist.sh` 를 호출하여 `apps/server/dist`, `apps/server/public`, 서버 `package.json` 만 `dist/` 로 복사합니다.
4. `scripts/install-service.sh` 로 systemd 유닛 파일을 `/etc/systemd/system/ufw-webui.service` 에 등록할 수 있습니다. `install` / `uninstall` / `status` 서브커맨드. 유닛은 `127.0.0.1:3000` 으로 바인딩 + `UFW_WEBUI_JWT_SECRET` env 박제 + 하드닝 옵션 (`NoNewPrivileges`, `PrivateTmp` 등). 자세한 사용법은 README 의 "시스템 서비스로 운영하기 (systemd)" 섹션 참고.

## 실행 요구사항

- `ufw` 가 설치되어 있고 Node 프로세스에서 접근 가능한 Linux 호스트. **서버는 절대 `sudo` 를 호출하지 않습니다** — 이미 `ufw` 를 실행할 수 있는 사용자(보통 root) 로 실행되어야 합니다.
- 빌드를 위한 Node.js 20+ + pnpm 9 이상을 로컬에 설치.
- `UFW_WEBUI_DATA_DIR` 환경 변수가 기본 `process.cwd()/data` 저장 위치를 재정의합니다. systemd 등록 시 `/var/lib/ufw-webui` 가 기본.
- 외부 노출 시 **reverse proxy + TLS** 가 필수. nginx + Let's Encrypt 권장. 자세한 내용은 README 의 "외부에서 접속 하려면?" 섹션 참고.

## 알려진 한계와 주의사항

다음 제약은 현재 코드 그대로 남아 있으며, 무엇이든 변경할 때 중요합니다.

- **`allow` 규칙만 지원.** `addRule` / `deleteRule` 은 항상 `ufw allow …` / `ufw delete allow …` 를 출력합니다. `deny` / `limit` / `reject` / `reject-with` / IPv6 는 지원하지 않습니다.
- **IPv4 전용 파싱.** `getUfwStatus` 는 `(v6)` 을 포함한 라인을 모두 건너뜁니다.
- **rate-limit 은 in-memory.** 서버 재기동 시 카운터가 초기화됩니다. 다중 인스턴스 환경에서는 공유 스토어 (Redis 등) 가 필요합니다.
- **staged 작업 race condition.** 다중 관리자가 같은 `DATA_DIR` 을 공유하면 락이 없어 동시 수정 시 손상 가능.
- **TLS 자체는 제공하지 않음.** reverse proxy + Let's Encrypt 가 필요합니다.
- **프론트엔드 개발 모드는 mock 에 연결됩니다.** `pnpm dev:web` 은 `apps/server` 가 실행 중일 필요가 없습니다. 개발에서 실제 API 를 테스트하려면 빌드 후 `pnpm start` 사용.
- **대량 추가의 ufw 명령 호환성.** `from X to Y/tcp` 형태는 ufw 가 거부함 (`Bad destination address`). `to` 가 포트이면 `to any port N proto tcp` 형식이 필요. 단건 추가와 동일한 제약.
- **테스트, CI 없음.** `pnpm test` 도, 테스트 프레임워크(vitest/jest) 도 설정되어 있지 않습니다.

## 다음으로 할 만한 작업 (남은 항목)

1. 규칙 모델 확장: `deny` / `limit` / `reject` / IPv6 / 포트·프로토콜 / 주석
2. 동시 사용자 환경을 위한 락 (staged 작업 / users.json)
3. TLS / reverse-proxy 자동화 (nginx config + certbot 연동)
4. 감사 로그 / 실패 알림 (현재 `journalctl` 만 의존)

## 사용 언어

**반드시 한국어로 응답**

## Git 워크플로우

1. 파일 수정 전: `git pull` 실행
2. 파일 수정 후: `git push` 실행
3. 커밋 메시지: **반드시 한국어**로 작성
