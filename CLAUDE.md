# CLAUDE.md

이 파일은 이 저장소의 코드로 작업할 때 Claude Code (claude.ai/code)에 안내를 제공하기 위한 문서입니다.

## 프로젝트 개요

UFW WebUI — Linux `ufw`를 관리하기 위한 작은规模的 Express + React 콘솔입니다. 이 저장소는 다음 세 패키지로 구성된 pnpm 워크스페이스입니다.

- `apps/server` — Express + TypeScript 백엔드 (`@ufw-webui/server`)
- `apps/web` — React 18 + Vite 프론트엔드 (`@ufw-webui/web`)
- `packages/shared` — 두 앱이 공유하는 TypeScript 타입 (`@ufw-webui/shared`, 현재는 `Rule`과 `UfwStatus`만 있음)

프론트엔드는 `apps/server/public`으로 번들되며 백엔드의 `3000` 포트에서 서빙됩니다. `node_modules`를 제외한 모든 것은 `pnpm dist` 실행 후 평평한 `dist/` 안에 들어갑니다.

## 명령어

모든 명령어는 저장소 루트에서 pnpm 필터를 사용해 실행합니다. 루트 레벨의 `test` 스크립트는 없습니다 — 아직 아무것도 없기 때문입니다.

```bash
pnpm install            # 모든 워크스페이스 의존성 설치

pnpm dev:web            # vite 개발 서버 :5173, 개발 모드에서 mock API
pnpm dev:server         # ts-node, 백엔드를 :3000에서 실행

pnpm build              # web → server 순 (프론트엔드 결과물 → apps/server/public)
pnpm build:web          # 프론트엔드만 (tsc -b 포함)
pnpm build:server       # clean → tsc --noEmit → esbuild 번들을 apps/server/dist/index.js로

pnpm start              # node apps/server/dist/index.js (운영)
pnpm dist               # pnpm build && bash ./dist.sh → 자체 완비된 dist/로 출하
pnpm dist:start         # node dist/dist/index.js

# 범위 지정 (특정 워크스페이스 내부에서 실행)
pnpm --filter @ufw-webui/server typecheck   # tsc --noEmit 검사만
pnpm --filter @ufw-webui/web lint           # apps/web에 대한 eslint
pnpm --filter @ufw-webui/web build          # tsc -b && vite build
```

어떤 레벨에도 `test`나 `lint:fix` 스크립트는 없습니다 — 둘 중 하나를 도입할 때는 패키지별로 추가하세요.

## 아키텍처

### 백엔드 (`apps/server/src/`)

- `index.ts` — Express 부트스트랩. `/api/auth`와 `/api/ufw`를 마운트하고 `../public`을 정적으로 서빙하며 그 외 모든 요청은 `public/index.html`로 폴백합니다 (SPA 라우팅).
- `routes/auth.ts` — `authRouter`를 정의하고 모든 UFW 라우트에서 사용되는 `authenticateToken` 미들웨어를 export 합니다. 토큰은 `Authorization: Bearer <jwt>`로 전달됩니다.
- `routes/ufw.ts` — `authenticateToken`으로 보호되는 5개의 엔드포인트: `GET /status`, `POST /enable`, `POST /disable`, `POST /add`, `POST /delete`. 모든 응답을 `{ success, data | error }` 형태로 감쌉니다.
- `services/authService.ts` — JWT (`jose`, HS256, 시크릿은 `"UFW-WebUI"`로 하드코딩). 사용자는 `${UFW_WEBUI_DATA_DIR or cwd/data}/users.json`에 JSON 배열로 저장됩니다. 첫 로그인이 자동으로 첫 사용자를 생성합니다. 비밀번호는 그대로(verbatim) 비교됩니다 (프론트엔드가 이미 전송 전에 SHA256 해시를 적용함).
- `services/ufwService.ts` — `child_process.exec`을 통해 셸로 `ufw`를 호출합니다. `getUfwStatus`는 `ufw status`의 출력을 한 줄씩 파싱하고, 공백 2개 이상을 기준으로 컬럼을 분리하며, `(v6)` 이나 대시(`-`) 라인은 건너뜁니다. `ruleToString`은 `{from, to}`로부터 `ufw allow …` 인자를 만듭니다 (`"Anywhere"`와 빈 문자열을 기본값으로 처리).

### 프론트엔드 (`apps/web/src/`)

- `main.tsx` — `import.meta.env.MODE === "development"`일 때만 조건부로 `import("./mocks")`를 호출하여, 개발 중에는 mockjs가 axios 호출을 가로채게 합니다.
- `App.tsx` — 두 라우트의 `react-router-dom`: `/login`과 `/` (`localStorage.token`의 `isLoggedIn`으로 보호됨).
- `components/LoginForm.tsx` — Ant Design 폼. 비밀번호를 `crypto-js` SHA256와 솔트 `"114514"`로 해시한 뒤 전송합니다.
- `components/UFWWebUI.tsx` — 메인 패널: enable/disable용 `Switch`, 파싱된 규칙을 보여주는 AntD `Table`과 마지막 "규칙 추가" 행 (그 행의 `Form.Item`이 `addRule`을 제출). 로그아웃은 `localStorage.token`을 비웁니다.
- `services/api.ts` — `baseURL: "/api"`인 단일 axios 인스턴스와 bearer 토큰을 붙이는 요청 인터셉터.
- `mocks/auth.ts` + `mocks/ufw.ts` — mockjs 핸들러. UFW mock은 메모리 내 `UfwStatus`를 유지하므로 add/delete가 요청 간에 실제로 상태를 변경합니다.

### 공유 (`packages/shared/src/index.ts`)

```ts
interface Rule     { from: string; to: string }
interface UfwStatus { active: boolean; rules: Rule[] }
```

두 앱 모두 워크스페이스 별칭 (`"@ufw-webui/shared": "workspace:*"`)을 통해 이를 사용합니다.

### 빌드와 배포 파이프라인

1. `pnpm build:web`은 `tsc -b && vite build`를 실행하며, 결과물은 `apps/server/public`으로 갑니다 (`vite.config.ts`의 `outDir`, `emptyOutDir: true`).
2. `pnpm build:server`는 `esbuild --bundle --platform=node --target=node20 --format=cjs`를 `apps/server/dist/index.js`로 실행합니다. 번들링 전 타입 체크 단계는 `tsc --noEmit`입니다.
3. `pnpm dist`는 `dist.sh`를 호출하며, 이 스크립트는 `apps/server/dist`, `apps/server/public`, 그리고 서버의 `package.json`만 `dist/`로 복사합니다. 인스톨러, Docker, systemd 유닛은 전혀 없습니다 — `node dist/dist/index.js`로 실행 가능한 폴더일 뿐입니다.

## 실행 요구사항

- `ufw`가 설치되어 있고 Node 프로세스에서 접근 가능한 Linux 호스트. **서버는 절대 `sudo`를 호출하지 않습니다** — 이미 `ufw`를 실행할 수 있는 사용자(보통 root)로 실행되어야 합니다. 그렇지 않으면 모든 UFW 작업이 stderr와 함께 실패합니다.
- 빌드를 위한 Node.js + pnpm을 로컬에 설치.
- `UFW_WEBUI_DATA_DIR` 환경 변수가 기본 `process.cwd()/data` 저장 위치를 재정의합니다. 기본은 서버를 시작하는 위치 기준 `./data/users.json`입니다.

## 알려진 한계와 주의사항

다음 제약은 현재 코드 그대로 남아 있으며, 무엇이든 변경할 때 중요합니다.

- **`allow` 규칙만 지원.** `addRule` / `deleteRule`은 항상 `ufw allow …` / `ufw delete allow …`를 출력합니다. `deny` / `limit` / `reject` / `reject-with` / IPv6는 지원하지 않습니다.
- **IPv4 전용 파싱.** `getUfwStatus`는 `(v6)`을 포함한 라인을 모두 건너뜁니다.
- **하드코딩된 JWT 시크릿** `"UFW-WebUI"` (`authService.ts`). 장난감이 아닌 배포 환경에서는 반드시 교체하세요.
- **단순 해시 비밀번호 저장.** 프론트엔드는 `sha256(password + "114514")`을 그대로 전송합니다 (말 그대로 — `"114514"`이 솔트입니다). 서버는 이 해시를 그대로 `users.json`에 저장합니다. bcrypt/argon은 없고, 사용자별 솔트도 없고, 속도 제한도 없습니다.
- **프론트엔드 개발 모드는 백엔드가 아닌 mock에 연결됩니다.** `pnpm dev:web`은 `apps/server`가 실행 중일 필요가 없습니다. 개발에서 실제 API를 테스트하려면 빌드 후 `pnpm start`를 사용하거나 `main.tsx`의 동적 import를 주석 처리하세요.
- **`exec`을 문자열 연결과 함께 사용.** `ufwService.executeCommand`는 `rule.from` / `rule.to`를 직접 셸 명령 문자열에 보간합니다. 셸 메타문자를 포함한 향후 입력이 들어오면 명령어 인젝션 벡터가 됩니다 — 보완할 때는 `execFile` (`child_process.execFile("ufw", ["allow", ...])`)로 전환하세요.
- **테스트, CI 없음.** `pnpm test`도, 테스트 프레임워크(vitest/jest)도 설정되어 있지 않습니다.

## 다음으로 할 만한 작업 (README 기준, 우선순위순)

1. 권한 모델과 보안 (JWT 시크릿, 해싱, 속도 제한, 더 안전한 exec).
2. 개발 통합 이야기 (실행 중인 백엔드를 가리키는 axios baseURL).
3. 규칙 모델: `deny` / `limit`, IPv6, 포트/프로토콜, 주석.
4. 설정 가능화: 포트, 시크릿, 데이터 디렉터리, 로그 레벨 — 모두 현재는 하드코딩되거나 암묵적입니다.

## 사용 언어

**반드시 한국어로 응답**
