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
- 프론트엔드: React 18, Vite, TypeScript, Ant Design, Axios
- 패키지 관리: pnpm workspace
- 인증: JWT
- 방화벽 제어: `child_process.exec()`으로 시스템 `ufw` 호출

## 동작 방식

### 1. 인증 로직

- 프론트엔드 로그인 시 비밀번호를 한 번 `SHA256(password + "114514")` 해시합니다
- 백엔드는 이 결과를 그대로 비밀번호처럼 비교하고 저장합니다
- 사용자 파일이 비어 있으면, 첫 로그인 시 첫 번째 사용자가 자동으로 생성됩니다
- 로그인 성공 시 1시간 유효한 JWT를 반환하며, 프론트엔드는 이를 `localStorage`에 저장합니다
- 이후의 `/api/ufw/*` 요청은 `Authorization: Bearer <token>` 방식으로 인증합니다

### 2. UFW 제어 로직

백엔드는 다음 명령을 직접 실행합니다.

- 상태 조회: `ufw status`
- 활성화: `ufw --force enable`
- 비활성화: `ufw disable`
- 규칙 추가: `ufw allow ...`
- 규칙 삭제: `ufw delete allow ...`

현재 구현은 IPv4 규칙만 파싱하며, `(v6)`가 붙은 규칙은 건너뜁니다.

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

- `POST /api/auth`

요청 본문:

```json
{
  "username": "admin",
  "password": "<sha256(password + 114514)>"
}
```

성공 응답 예시:

```json
{
  "success": true,
  "data": {
    "token": "<jwt>"
  }
}
```

### UFW

- `GET /api/ufw/status`: UFW 상태와 규칙 조회
- `POST /api/ufw/enable`: UFW 활성화
- `POST /api/ufw/disable`: UFW 비활성화
- `POST /api/ufw/add`: 규칙 추가
- `POST /api/ufw/delete`: 규칙 삭제

규칙 추가/삭제 요청 본문 예시:

```json
{
  "rule": {
    "from": "10.0.0.0/8",
    "to": "22/tcp"
  }
}
```

규칙 조합 로직은 다음과 같습니다.

- `to`만 입력한 경우: `ufw allow <to>` 실행
- `from`만 입력한 경우: `ufw allow from <from>` 실행
- `from`과 `to`를 모두 입력한 경우: `ufw allow from <from> to <to>` 실행

## 첫 사용 안내

1. 서비스를 시작한 뒤 `http://localhost:3000`에 접속합니다
2. 사용자 이름과 비밀번호를 입력해 로그인합니다
3. 현재 사용자 저장소가 비어 있으면 이 계정이 자동으로 첫 번째 사용자로 등록됩니다
4. 로그인에 성공하면 UFW 상태와 규칙을 확인하고 수정할 수 있습니다

## 현재 구현의 한계

- `allow` 규칙의 추가/삭제만 지원합니다
- 규칙 파싱이 `ufw status` 텍스트 형식에 의존합니다
- IPv6 규칙은 무시됩니다
- 사용자 데이터는 로컬 JSON 파일을 사용하므로 다중 인스턴스 배포에 적합하지 않습니다
- 프론트엔드 개발 모드는 기본적으로 mock을 사용하며, 실제 연동 모드가 아닙니다
- 배포 스크립트는 여전히 가벼운 복사 방식이며, 컨테이너화나 인스톨러 패키징은 없습니다

## 보안 관련 안내

이 프로젝트는 프로토타입 또는 내부망 도구에 가까운 수준이므로, 운영 환경에 그대로 사용하기 전에는 최소한 아래 사항을 다스리는 것을 권장합니다.

- 하드코딩된 JWT 시크릿을 환경 변수로 변경
- 프론트엔드에서 고정 솔트로 한 번 SHA256만 돌려 그대로 저장하지 말 것
- `bcrypt` / `argon2` 등 진짜 비밀번호 해시 방식 사용
- 로그인 엔드포인트에 속도 제한, 감사 로깅, 실패 보호 추가
- 높은 권한을 가진 시스템 명령에 대해 더 안전한 권한 경계를 설계
- HTTPS, 리버스 프록시, 접근 제어와 함께 사용

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

## 적합한 사용 시나리오

- 로컬 실험 환경
- 가정용 서버 / 내부망 머신의 간단한 UFW 관리 패널
- 추후 리팩터링을 위한 프로토타입 프로젝트

이 프로젝트를 계속 다듬으려면 다음 순서로 개선하는 것을 권장합니다.

1. 권한 모델과 보안
2. 개발 연동 경험
3. 규칙 모델 (deny / limit / IPv6 / 포트 프로토콜 등)
4. 설정화 능력 (포트, 시크릿, 사용자 저장 위치)

> 운영 환경 기본 운영 방식: `scripts/install-service.sh install` 로 systemd 서비스로 띄우면 부팅 시 자동 시작 + 장애 시 자동 재기동 + `journalctl` 통합 로그가 한 번에 잡힙니다. 자세한 옵션은 [시스템 서비스로 운영하기](#시스템-서비스로-운영하기-systemd) 섹션을 참고하세요.
