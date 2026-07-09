# UFW WebUI

Linux `ufw` 방화벽을 관리하기 위한 간단한 웹 콘솔입니다. 현재 저장소는 표준화된 `pnpm workspace` 구조로 정리되어 있습니다.

- `apps/server`: Node.js + Express + TypeScript 백엔드
- `apps/web`: React + Vite + TypeScript 프론트엔드
- `packages/shared`: 프론트엔드와 백엔드가 공유하는 타입
- 프론트엔드 빌드 결과물은 `apps/server/public`으로 출력되며, 백엔드에서 정적으로 통합 호스팅합니다

현재 지원하는 핵심 기능:

- 로그인 후 JWT 발급 (bcrypt 해싱, JWT 시크릿 env)
- UFW의 현재 활성화 상태 확인
- UFW 한 번에 켜기 / 끄기
- 기존 규칙 조회
- `allow` 규칙 추가 / 삭제
- **모니터링 모드** — 규칙 추가/삭제를 대기열에 모았다가 일괄 적용
- **메모** — 대기 작업에 한 줄 사유 첨부
- **대량 추가** — `from,to,note` 한 줄 형식으로 N개 규칙을 한 번에 추가 (모니터링/즉시 모두 지원)
- **수정(변경)** — 기존 규칙을 delete + add 시퀀스로 교체 (UFW 가 modify 미지원이라). 모니터링/즉시 모두 지원
- **UFW 로그 조회** — 레벨 토글 + 최근 N 줄 + 실시간 폴링
- **첫 관리자 부트스트랩** — 빈 사용자 상태에서만 일회성 등록

## 프로젝트 구조

```text
ufw-webui/
├── package.json                  # workspace 레벨 스크립트
├── pnpm-workspace.yaml
├── dist.sh                       # dist/ 패키징 스크립트
├── scripts/
│   └── install-service.sh        # systemd 서비스 등록/해제 스크립트
├── apps/
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts          # Express 진입점
│   │       ├── routes/
│   │       └── services/
│   └── web/
│       ├── package.json
│       ├── vite.config.ts
│       └── src/
│           ├── App.tsx
│           ├── components/
│           ├── services/
│           └── mocks/
└── packages/
    └── shared/
        ├── package.json
        └── src/index.ts          # 공유 타입
```

## 기술 스택

- 백엔드: Node.js, Express, TypeScript, esbuild, jose
- 프론트엔드: React 18, Vite, TypeScript, Ant Design, Axios, EventSource (SSE)
- 패키지 관리: pnpm workspace
- 인증: JWT (HS256), bcryptjs 해싱, express-rate-limit
- 방화벽 제어: `child_process.spawn("ufw", args)` — 인자 배열 호출로 셸 메타문자 안전

## 동작 방식

### 1. 인증 로직

- 사용자 파일이 비어 있으면 **최초 관리자 부트스트랩** 폼이 표시됩니다. 사용자가 아이디/비밀번호(및 확인)를 입력하면 `POST /api/auth/bootstrap` 으로 등록되고 즉시 로그인됩니다. 이 후 사용자 파일이 비어 있지 않으면 `403` 으로 거부됩니다.
- 일반 로그인은 `POST /api/auth` 로 평문 비밀번호를 보냅니다. 서버는 **bcryptjs(cost 10)** 로 비교합니다. (HTTPS / reverse proxy 전제)
- 기존에 `SHA256(password + "114514")` 형식으로 저장된 사용자는 **다음 로그인 성공 시 자동으로 bcrypt 로 업그레이드**됩니다. 강제 재가입 불필요.
- 로그인 성공 시 1시간 유효한 JWT를 반환하며, 프런트는 `localStorage`에 저장합니다. 이후 모든 `/api/ufw/*` 요청은 `Authorization: Bearer <token>` 으로 인증합니다.
- JWT 시크릿은 환경변수 `UFW_WEBUI_JWT_SECRET` 로 주입합니다. 미설정 시 서버 시작 로그에 WARNING 출력 후 기본값 사용.
- `/api/auth/*` 는 분당 10회, `/api/auth/bootstrap` 은 5분에 3회로 rate-limit 됩니다 (in-memory).

### 2. UFW 제어 로직

백엔드는 다음 명령을 `child_process.spawn` 인자 배열로 직접 실행합니다. 셸을 거치지 않으므로 메타문자가 포함된 입력은 그대로 `ufw` 의 검증으로만 흘러갑니다.

- 상태 조회: `ufw status`
- 활성화: `ufw --force enable`
- 비활성화: `ufw disable`
- 규칙 추가: `ufw allow from <from> to <to>` (인자 배열)
- 규칙 삭제: `ufw delete allow from <from> to <to>` (인자 배열)
- 로깅 레벨 변경: `ufw logging <level>` (off | low | medium | high | full)

현재 구현은 IPv4 규칙만 파싱하며, `(v6)` 가 붙은 규칙은 건너뜁니다.

## 실행 요구사항

시작하기 전에 다음을 확인하세요.

- 실행 환경이 Linux일 것
- `ufw`가 설치 및 활성화되어 있을 것
- Node.js와 `pnpm`이 설치되어 있을 것
- 백엔드 프로세스를 실행하는 사용자가 `ufw`를 실행할 권한을 가지고 있을 것

참고: 이 코드는 `sudo`를 호출하지 않습니다. 따라서 현재 프로세스 자체에 충분한 권한이 없으면 UFW 관련 작업이 실패합니다. 일반적으로 `root` 권한으로 실행해야 하며, 더 안전한 권한 상승 체계를 직접 설계할 수도 있습니다.

## 의존성 설치

이제 저장소 전체가 workspace를 사용하므로, 루트에서 한 번만 설치하면 됩니다.

```bash
pnpm install
```

## 빌드와 실행

### 운영 환경 실행

먼저 저장소 루트에서 다음을 실행합니다.

```bash
pnpm build
pnpm start
```

시작한 뒤 다음 주소로 접속하세요.

```text
http://localhost:3000
```

빌드 결과:

- 프론트엔드 빌드 결과는 `apps/server/public`에 들어갑니다
- 백엔드는 `esbuild`로 단일 파일 `apps/server/dist/index.js`로 번들됩니다
- 사용자 데이터는 기본적으로 현재 실행 작업 디렉터리 아래 `data/users.json`에 저장됩니다

설명:

- 기본 데이터 디렉터리는 `process.cwd()/data`입니다
- 저장소 루트에서 실행하면 기본이 보통 `./data/users.json`이 됩니다
- 먼저 `cd dist`로 들어가 배포 결과물을 실행하면 기본이 보통 `dist/data/users.json`이 됩니다
- 환경 변수 `UFW_WEBUI_DATA_DIR`로 데이터 디렉터리를 변경할 수 있습니다

### `dist/`로 패키징하기

프로젝트는 Bash 호환 배포 스크립트인 `dist.sh`도 제공합니다.

```bash
pnpm dist
pnpm dist:start
```

또는:

```bash
cd dist
node dist/index.js
```

`pnpm dist`는 다음을 수행합니다.

- 먼저 전체 빌드를 실행
- `bash ./dist.sh` 호출
- `dist/` 생성
- `apps/server/dist`을 `dist/dist`로 복사
- `apps/server/public`을 `dist/public`으로 복사
- `apps/server/package.json`을 `dist/package.json`으로 복사
- `node_modules`는 더 이상 복사하지 않습니다 (백엔드가 이미 단일 파일로 번들되어 있으므로)

## 시스템 서비스로 운영하기 (systemd)

상시 띄울 서버라면 `systemd` 서비스로 등록하면 부팅 시 자동 시작 + 장애 시 자동 재기동 + 로그 통합(`journalctl`)을 한 번에 얻을 수 있습니다. 이를 위한 `scripts/install-service.sh` 스크립트가 제공됩니다.

### 등록

먼저 한 번 빌드해 둡니다.

```bash
pnpm install
pnpm build
```

기본 옵션으로 등록 (서비스 사용자 root, 데이터 디렉터리 `/var/lib/ufw-webui`):

```bash
sudo scripts/install-service.sh install
```

옵션을 바꿔 등록하는 예시:

```bash
sudo scripts/install-service.sh install \
  --install-dir /srv/ufw-webui \
  --data-dir /var/lib/ufw-webui \
  --user root
```

사용 가능한 옵션:

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `--install-dir DIR` | `/opt/ufw-webui` | 번들 경로. `apps/server/dist/index.js` 와 `apps/server/public/` 이 있어야 함 |
| `--data-dir DIR` | `/var/lib/ufw-webui` | 사용자/세션 데이터 디렉터리. 기동 시 `UFW_WEBUI_DATA_DIR` 로 전달됨 |
| `--user USER` | `root` | 서비스 실행 사용자. `ufw` 를 직접 호출하므로 root 권장 |
| `--no-enable` | - | 부팅 시 자동 시작을 켜지 않음 |
| `--no-start` | - | 등록만 하고 즉시 기동은 생략 |

스크립트가 자동으로 처리하는 작업:

- 유닛 파일 `/etc/systemd/system/ufw-webui.service` 생성
- `systemctl daemon-reload`
- 부팅 시 자동 시작 활성화 (`systemctl enable`)
- 서비스 즉시 기동 (`systemctl start`)
- 데이터 디렉터리가 없으면 생성 + 권한 설정
- 실행 시점의 `node` 경로를 ExecStart 에 박제 (PATH 이슈 회피)

### 생성되는 유닛 파일의 주요 항목

```ini
[Service]
Type=simple
User=root
ExecStart=/usr/bin/node /opt/ufw-webui/apps/server/dist/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=UFW_WEBUI_DATA_DIR=/var/lib/ufw-webui
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ufw-webui

NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictRealtime=true
RestrictNamespaces=true
```

> 하드닝 항목은 가능한 많이 켜두지만, `ufw` 가 `/etc/ufw`, `/var/lib/ufw` 등 시스템 위치에 직접 쓰기 때문에 `ProtectSystem` 류(파일 시스템 읽기 전용화)는 의도적으로 사용하지 않습니다.

### 관리 명령

```bash
sudo systemctl status  ufw-webui      # 현재 상태
sudo systemctl stop    ufw-webui      # 중지
sudo systemctl start   ufw-webui      # 시작
sudo systemctl restart ufw-webui      # 재기동
sudo systemctl disable ufw-webui      # 부팅 시 자동 시작 끔
sudo systemctl enable  ufw-webui      # 자동 시작 켜기
```

실시간 로그:

```bash
sudo journalctl -u ufw-webui -f
```

최근 N 줄:

```bash
sudo journalctl -u ufw-webui -n 200 --no-pager
```

### 등록 해제 (uninstall)

서비스 등록을 되돌리고 데이터 디렉터리는 그대로 보존합니다.

```bash
sudo scripts/install-service.sh uninstall
```

> 데이터 디렉터리(`/var/lib/ufw-webui` 등)도 함께 지우고 싶다면 위 명령 실행 후 수동으로 `sudo rm -rf <데이터 디렉터리>` 를 실행해 주세요.

### 상태 확인

```bash
scripts/install-service.sh status
```

유닛이 등록되어 있지 않으면 안내 메시지를 출력합니다 (root 가 아니어도 됨).

## 개발 방법

### 프론트엔드 개발

```bash
pnpm dev:web
```

기본 Vite 주소는 보통 다음과 같습니다.

```text
http://localhost:5173
```

중요: 프론트엔드는 `development` 모드에서 `apps/web/src/mocks/`를 자동으로 로드하므로, 이때는 실제 백엔드가 아니라 Mock API를 사용합니다.

이 말은 즉:

- `pnpm dev:web`은 주로 UI 개발용입니다
- 백엔드를 실행하지 않아도 페이지를 볼 수 있습니다
- 실제 UFW API와 연동 테스트하려면 이 mock 로직을 끄거나, 빌드 후 백엔드가 페이지를 통째로 제공하도록 변경해야 합니다

### 백엔드 개발

백엔드 개발은 다음을 바로 사용할 수 있습니다.

```bash
pnpm dev:server
```

기본 데이터 디렉터리는 여전히 명령을 실행하는 위치에 따라 달라집니다. 저장소 루트에서 실행하면 보통 `./data/users.json`에 떨어집니다. `UFW_WEBUI_DATA_DIR`로 덮어쓸 수도 있습니다.

## API 개요

### 인증

- `POST /api/auth` — 평문 비밀번호로 로그인 (bcrypt 비교, SHA256+114514 레거시 자동 마이그레이션)
- `POST /api/auth/bootstrap` — 사용자 파일이 비어 있을 때만 1회 성공 (자체 별도 rate-limit)
- `GET /api/auth/users/exists` — UI 폼 분기용 (public)

요청 본문:

```json
{ "username": "admin", "password": "<plain>" }
```

성공 응답 예시:

```json
{
  "success": true,
  "data": {
    "token": "<jwt>",
    "user": { "username": "admin" }
  }
}
```

### UFW 즉시 적용

- `GET /api/ufw/status` — UFW 상태와 규칙 조회
- `POST /api/ufw/enable` — UFW 활성화
- `POST /api/ufw/disable` — UFW 비활성화
- `POST /api/ufw/add` — 규칙 즉시 추가
- `POST /api/ufw/delete` — 규칙 즉시 삭제
- `POST /api/ufw/update` — 규칙 수정 (delete + add 시퀀스)

규칙 추가/삭제 요청 본문:

```json
{
  "rule": { "from": "10.0.0.0/8", "to": "22/tcp" }
}
```

### 모니터링(대기) 작업

- `GET /api/ufw/staged` — 누적된 작업 목록 (`{id, action: "add"|"delete", from, to, note?, createdAt}[]`)
- `POST /api/ufw/staged` — 작업 추가 (`{rule: {action, from, to, note?}}`)
- `DELETE /api/ufw/staged/:id` — 한 건 버리기
- `POST /api/ufw/staged/:id/apply` — 한 건 UFW 적용
- `POST /api/ufw/staged/apply-all` — 일괄 적용 (add 먼저 → delete 나중). 부분 실패 시 `errors[]` 동봉

### 대량 규칙

- `POST /api/ufw/bulk` — N개 규칙을 한 번에 추가/모니터링

요청:

```json
{
  "mode": "apply",          // "apply" | "monitor"
  "action": "add",          // "add" | "delete"
  "rules": [
    { "from": "10.0.0.0/8", "to": "22/tcp",  "note": "내부 SSH" },
    { "to":   "443/tcp",                   "note": "모든 곳 HTTPS" },
    { "from": "10.10.0.0/16", "to": "5432/tcp" }
  ]
}
```

응답:

```json
{
  "success": true,
  "data": {
    "mode": "monitor",
    "action": "add",
    "applied": 2,
    "total": 3,
    "errors": ["from 또는 to 중 하나는 필요합니다: from='' to=''"]
  }
}
```

부분 실패 정책: 한 건이 실패해도 나머지는 계속 진행. `errors[]` 에 어떤 규칙이 어떤 stderr 로 실패했는지 동봉. UI 의 "대량 추가" 모달에서 즉시 표시됨.

### 규칙 수정 (변경)

- `POST /api/ufw/update` — 기존 규칙을 새 규칙으로 교체 (UFW 는 `modify` 명령이 없으므로 delete + add 시퀀스로 처리)

요청:

```json
{
  "old":  { "from": "10.0.0.0/8", "to": "22/tcp" },
  "new":  { "from": "192.168.0.0/16", "to": "22/tcp" },
  "mode": "apply",          // "apply" | "monitor"
  "note": "출발지 사설망으로 제한"  // monitor 모드일 때만 저장
}
```

응답:

- `apply` 모드: `{ success: true, data: { mode, applied: 1, result: "Rule added" } }`
- `monitor` 모드: `{ success: true, data: { mode, staged: 1, message: "...", rule: { id, action: "update", from, to, old, ... } } }`

`monitor` 모드일 때 `staged-rules.json` 에 `action: "update"` + `old: { from, to }` 로 저장. `apply-all` 시 `add → update → delete` 순서로 처리 (add 먼저, delete 나중 SSH 차단 회피 원칙 유지).

### UFW 로깅 / 로그

- `GET /api/ufw/logging` — 현재 레벨 + 출처 (`{level, file, source: "file"|"journal"|"none"}`)
- `POST /api/ufw/logging` — 레벨 변경 (`{level: "off"|"low"|"medium"|"high"|"full"}`)
- `GET /api/ufw/logs?limit=N` — 최근 N 줄 (UFW 라인 우선, file 또는 journal 출처)
- `GET /api/ufw/logs/stream` — SSE 실시간 스트림 (`event: meta` + 라인별 `data: ...`)

## 첫 사용 안내

1. 서비스를 시작한 뒤 `http://localhost:3000` 에 접속합니다.
2. 사용자 파일이 비어 있으면 **최초 관리자 설정** 폼이 표시됩니다. 아이디/비밀번호(및 확인)를 입력해 등록합니다.
3. 사용자 파일이 이미 존재하면 일반 **로그인** 폼이 표시됩니다. 평문 비밀번호를 그대로 입력합니다.
4. 로그인에 성공하면 UFW 상태, 규칙, 로그, 모니터링 대기열을 한 화면에서 관리할 수 있습니다.

## 현재 구현의 한계

- `allow` 규칙만 지원. `deny` / `limit` / `reject` 는 미구현
- 규칙 파싱이 `ufw status` 텍스트 형식에 의존 → ufw 출력 형식이 바뀌면 파서가 깨질 수 있음
- 대량 추가의 `from X to Y/tcp` 문법은 ufw 가 거부 (`Bad destination address`). `to` 가 포트이면 `to any port N proto tcp` 형식이 필요. 단건 추가와 동일한 제약
- IPv6 규칙은 무시 (v4 만 파싱/적용)
- 사용자 데이터는 로컬 JSON 파일 (다중 인스턴스 배포 부적합)
- 프론트엔드 개발 모드는 기본적으로 mock 사용 (실제 연동 아님)
- 배포 스크립트는 가벼운 복사 방식 (컨테이너화·인스톨러 패키징 없음)
- TLS 자체는 제공하지 않음. reverse proxy + Let's Encrypt 가 필요

## 보안 관련 안내

원래 README 의 "권장 사항" 은 이번 업데이트로 대부분 해결되었습니다 (자세한 비교는 아래 [개선 사항](#개선-사항) 참고). 남아 있는 권장 사항은 다음과 같습니다.

- HTTPS / reverse proxy (TLS 종료) — nginx + Let's Encrypt 권장
- 고가용성 (다중 인스턴스) — 현재 단일 노드 가정
- 감사 로그 / 실패 알림 — 현재 `journalctl` 만 의존

## 보안 모델

운영 환경 기본 전제:

| 항목 | 값 |
| --- | --- |
| 비밀번호 저장 | bcrypt (cost 10), 자동 솔트. 기존 SHA256+`114514` 형식은 다음 로그인 시 bcrypt 로 자동 마이그레이션 |
| JWT 시크릿 | `UFW_WEBUI_JWT_SECRET` 환경변수. 미설정 시 서버 시작 로그에 WARNING 출력 후 기본값 사용 |
| 명령 실행 | `child_process.spawn("ufw", args)` — 인자 배열. 셸 메타문자 안전 |
| 첫 사용자 | `POST /api/auth/bootstrap` — 사용자 파일이 비어 있을 때만 1회 성공, 그 외엔 403. 자체 별도 rate-limit (5 분에 3 회) |
| 로그인 rate-limit | 분당 10 회 (IP 당) |
| 서버 바인딩 | `127.0.0.1:3000`. 외부 직접 접근 차단. reverse proxy 가 앞에 있어야 함 |
| Reverse proxy | nginx + Let's Encrypt (TLS 종료) 권장. [외부 노출 가이드](#외부에서-접속-하려면) 참고 |
| 명령 인젝션 | `ufw allow ${rule.from}` 같은 문자열 보간이 사라지고, `["allow", "from", rule.from, "to", rule.to]` 인자 배열로 호출 |

### JWT 시크릿 설정 예시

`scripts/install-service.sh` 는 등록 시점에 셸 환경의 `UFW_WEBUI_JWT_SECRET` 값을 systemd 유닛에 박제한다. 다음 절차로 강력한 시크릿을 미리 만들어 두는 것을 권장.

```bash
export UFW_WEBUI_JWT_SECRET=$(openssl rand -hex 32)
sudo -E scripts/install-service.sh install
```

`-E` 가 현재 셸의 환경변수를 sudo 로 전달해 systemd 유닛에 박히게 한다. 이 시점 이후로는 모든 토큰이 이 시크릿으로 서명되므로, 기존 토큰은 무효화된다.

## 개선 사항

이번 버전에서 추가된 주요 기능을 항목별로 정리합니다.

### 기능 보강

| 항목 | 설명 |
| --- | --- |
| **모니터링(대기) 모드** | 추가 행에서 즉시 적용 / 모니터링(추가) / 모니터링(삭제) 3 종 모드 선택. 모드 변경은 세션 단위. 대기 작업은 `${DATA_DIR}/staged-rules.json` 에 영속 |
| **메모(note)** | 대기 작업에 한 줄 메모 첨부 가능. 추가 행의 입력 필드에서 작성, 대기 테이블에 표시 |
| **Delete-staging** | 모니터링 모드 (삭제) 가 추가만 가능했던 비대칭 해소. 누적 후 일괄 적용 시 **add 먼저 → delete 나중** 순서로 안전 처리. 부분 실패 시 `errors[]` 동봉 |
| **UFW 로깅 토글** | `POST /api/ufw/logging` 으로 `off`/`low`/`medium`/`high`/`full` 변경. UI 셀렉터 |
| **UFW 로그 조회** | 최근 N 줄 (`GET /api/ufw/logs?limit=N`) + SSE 실시간 스트림 (`GET /api/ufw/logs/stream`). 4 초 폴링으로 UI 에서 실시간 표시 |
| **journal 출처 폴백** | `rsyslog` 가 없는 환경 (`/var/log/ufw.log` 부재) 에서 `journalctl -k` / `-kf` 로 자동 폴백. 출처는 `source: "file" \| "journal" \| "none"` 로 응답에 포함 |
| **첫 관리자 부트스트랩** | `POST /api/auth/bootstrap` — 사용자 파일이 비어 있을 때만 1회 성공. 그 외엔 403. UI: `apiUsersExist()` 로 폼 자동 분기 + 비밀번호 확인 |
| **대량 규칙 추가** | `POST /api/ufw/bulk` — 한 줄 = `from,to,note` 형식의 텍스트를 N개 규칙으로 파싱. 동작 (추가/삭제) + 모드 (모니터링/즉시) 4 조합. 부분 실패 시 `errors[]` 동봉 |
| **규칙 수정(변경)** | `POST /api/ufw/update` — UFW 가 `modify` 명령이 없는 점을 보완하기 위해 delete(old) + add(new) 시퀀스로 처리. 모니터링/즉시 모드 지원. 모니터링일 때 staged 에 `action: "update"` + `old: {from, to}` 로 저장, apply-all 시 add → update → delete 순서로 처리 |
| **systemd 등록 스크립트** | `scripts/install-service.sh` — `install`/`uninstall`/`status` 서브커맨드. 유닛 파일 + 하드닝 옵션 + JWT env 박제 + 경고 출력 |

### 보안 강화

| 항목 | 이전 | 이후 |
| --- | --- | --- |
| **비밀번호 저장** | `SHA256(password + "114514")` 평문 JSON | `bcryptjs(cost 10)` 자동 솔트. 기존 형식은 다음 로그인 시 bcrypt 로 자동 마이그레이션 |
| **JWT 시크릿** | `"UFW-WebUI"` 하드코딩 | `UFW_WEBUI_JWT_SECRET` 환경변수. 미설정 시 서버 시작 로그에 WARNING 출력 + 기본값. systemd 유닛에 박제 가능 |
| **명령 실행** | `child_process.exec("ufw allow " + ...)` (인젝션 가능) | `child_process.spawn("ufw", args)` 인자 배열. 셸 메타문자 안전 |
| **첫 사용자** | 어떤 아이디/비밀번호로든 자동 첫 관리자 | `bootstrap` 엔드포인트는 빈 사용자일 때만 1회. 그 외엔 403 |
| **무차별 대입 방어** | 무방비 | `express-rate-limit` — `/api/auth/*` 분당 10회, `/api/auth/bootstrap` 5분에 3회 (in-memory) |
| **서버 바인딩** | `0.0.0.0:3000` (모든 NIC 노출) | `127.0.0.1:3000` 만. reverse proxy 만 접근 가능 |
| **명령 인젝션** | `; cat /etc/passwd > /tmp/pwn #` 이 셸에서 실행될 수 있는 잠재 위험 | `Bad source address` 같은 ufw 검증만 통과, 파일 생성 흔적 없음 (검증 완료) |
| **평문 패스워드 전송** | (해당 없음 — 클라이언트에서 해시 후 전송) | 클라이언트는 평문 전송. **HTTPS / reverse-proxy 전제** |
| **CSRF** | Authorization 헤더만 사용 (Same-Origin / CSRF 토큰 없음) | 동일 — Authorization 헤더 + SameSite 쿠키 / LocalStorage 사용. CSRF 토큰 추가 고려 가능 |

### 비교: 한계 → 해결

원래 README 의 "권장 사항" 항목들이 이번 업데이트로 어디까지 다뤄졌는지 요약.

| 원래 권장 | 처리 |
| --- | --- |
| 하드코딩된 JWT 시크릿을 환경 변수로 | ✔ `UFW_WEBUI_JWT_SECRET` env + systemd 유닛 박제 |
| SHA256 + 고정 솔트 저장 금지 | ✔ bcryptjs 로 교체, lazy rehash |
| `bcrypt` / `argon2` 사용 | ✔ bcryptjs (cost 10) |
| 로그인 rate-limit | ✔ 분당 10회 + bootstrap 별도 5분에 3회 |
| 더 안전한 권한 경계 | ◐ reverse proxy + bind 127.0.0.1 (TLS 자체는 외부 의존) |
| HTTPS / reverse proxy | ◐ nginx + Let's Encrypt 가이드만 README 에 포함 |

### 호환성 / 마이그레이션 노트

- `users.json` 의 `password` 필드가 기존 SHA256 hex (64자) 면, **다음 로그인 성공 시** bcrypt 로 자동 교체. 강제 재가입 없음
- `staged-rules.json` 의 항목에 `action` 필드가 없으면 `readStaged` 에서 `"add"` 로 보정. 명시적으로 저장될 때는 `action` 포함
- 기존 `pnpm start` / `node dist/index.js` 사용자는 별도 마이그레이션 불필요. systemd 등록도 `scripts/install-service.sh install` 한 줄

## 적합한 사용 시나리오

- 로컬 실험 환경
- 가정용 서버 / 내부망 머신의 간단한 UFW 관리 패널
- 추후 리팩터링을 위한 프로토타입 프로젝트

이 프로젝트를 계속 다듬으려면 다음 순서로 개선하는 것을 권장합니다.

1. 규칙 모델 확장 (`deny` / `limit` / `reject` / IPv6 / 포트·프로토콜 / 주석)
2. 동시 사용자 환경을 위한 락 (staged 작업 / users.json)
3. TLS / reverse-proxy 자동화 (nginx config + certbot 연동)
4. 감사 로그 / 실패 알림

> 운영 환경 기본 운영 방식: `scripts/install-service.sh install` 로 systemd 서비스로 띄우면 부팅 시 자동 시작 + 장애 시 자동 재기동 + `journalctl` 통합 로그가 한 번에 잡힙니다. 자세한 옵션은 [시스템 서비스로 운영하기](#시스템-서비스로-운영하기-systemd) 섹션을 참고하세요.
