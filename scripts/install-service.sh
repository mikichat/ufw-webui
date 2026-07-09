#!/usr/bin/env bash
#
# scripts/install-service.sh — UFW WebUI systemd 서비스 등록/제거 스크립트
#
# 이 스크립트는 UFW WebUI 를 systemd 서비스로 등록해 systemctl 로 시작·중지·상태
# 확인이 가능하도록 한다. 역제거(uninstall) 시에는 enable/stop 상태와 유닛 파일
# 을 되돌리며, 데이터 디렉터리(/var/lib/ufw-webui)는 안전을 위해 보존한다.
#
# 사용법:
#   sudo ./scripts/install-service.sh install   [옵션]
#   sudo ./scripts/install-service.sh uninstall
#   sudo ./scripts/install-service.sh status
#   sudo ./scripts/install-service.sh help
#
# install 옵션:
#   --install-dir DIR    번들 경로. 디렉터리 안에 apps/server/dist/index.js 와
#                        apps/server/public/ 이 있어야 한다.
#                        (기본: /opt/ufw-webui)
#   --data-dir DIR       사용자/세션 데이터 디렉터리. 기동 시 UFW_WEBUI_DATA_DIR 로
#                        전달된다. (기본: /var/lib/ufw-webui)
#   --user USER          서비스 실행 사용자. ufw 를 직접 호출하므로 root 가 아니면
#                        방화벽 제어가 실패한다. (기본: root)
#   --no-enable          enable 단계 생략. 부팅 시 자동 시작을 원하지 않을 때.
#   --no-start           enable 만 실행하고 start 는 생략.
#   --systemd-unit PATH  유닛 파일 경로 override. (기본: /etc/systemd/system/ufw-webui.service)

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SERVICE_NAME="ufw-webui"
SERVICE_DESCRIPTION="UFW WebUI - Linux ufw 관리 콘솔"

INSTALL_DIR_DEFAULT="/opt/ufw-webui"
DATA_DIR_DEFAULT="/var/lib/ufw-webui"
SERVICE_USER_DEFAULT="root"
SYSTEMD_UNIT_DEFAULT="/etc/systemd/system/${SERVICE_NAME}.service"

INSTALL_DIR="$INSTALL_DIR_DEFAULT"
DATA_DIR="$DATA_DIR_DEFAULT"
SERVICE_USER="$SERVICE_USER_DEFAULT"
SYSTEMD_UNIT="$SYSTEMD_UNIT_DEFAULT"
ENABLE_SERVICE=1
START_SERVICE=1

# --- 출력 헬퍼 ---------------------------------------------------------------

log()  { printf "\033[1;34m[%s]\033[0m %s\n" "$SCRIPT_NAME" "$*"; }
warn() { printf "\033[1;33m[%s][WARN]\033[0m %s\n" "$SCRIPT_NAME" "$*" >&2; }
err()  { printf "\033[1;31m[%s][ERROR]\033[0m %s\n" "$SCRIPT_NAME" "$*" >&2; }
die()  { err "$*"; exit 1; }

# --- 사용법 ------------------------------------------------------------------

usage() {
  cat <<EOF
$SCRIPT_NAME — UFW WebUI systemd 서비스 등록/제거 스크립트

사용법:
  sudo $SCRIPT_NAME install   [옵션]
  sudo $SCRIPT_NAME uninstall
  sudo $SCRIPT_NAME status
  sudo $SCRIPT_NAME help

install 옵션:
  --install-dir DIR    번들 경로 (기본: $INSTALL_DIR_DEFAULT)
  --data-dir DIR       데이터 디렉터리 (기본: $DATA_DIR_DEFAULT)
  --user USER          서비스 실행 사용자 (기본: $SERVICE_USER_DEFAULT; ufw 직접 호출을 위해 root 권장)
  --no-enable          enable 단계 생략
  --no-start           enable 만 하고 start 는 생략

예시:
  sudo $SCRIPT_NAME install
  sudo $SCRIPT_NAME install --install-dir /srv/ufw-webui --data-dir /var/lib/ufw-webui
  sudo $SCRIPT_NAME uninstall
EOF
}

# --- 유틸 -------------------------------------------------------------------

require_root() {
  if [[ $EUID -ne 0 ]]; then
    die "루트 권한이 필요합니다. 'sudo $SCRIPT_NAME ...' 로 실행해 주세요."
  fi
}

validate_install_dir() {
  local dir="$1"
  [[ -d "$dir" ]]                                || die "설치 디렉터리가 없습니다: $dir"
  [[ -f "$dir/apps/server/dist/index.js" ]]      || die "번들을 찾을 수 없습니다: $dir/apps/server/dist/index.js — 먼저 'pnpm build' 를 실행하세요."
  [[ -d "$dir/apps/server/public" ]]             || die "정적 자산을 찾을 수 없습니다: $dir/apps/server/public"
}

resolve_node_bin() {
  local node_bin
  node_bin="$(command -v node 2>/dev/null || true)"
  [[ -n "$node_bin" && -x "$node_bin" ]] || die "node 실행 파일을 PATH 에서 찾지 못했습니다. Node.js 를 먼저 설치하세요."
  printf '%s\n' "$node_bin"
}

ensure_data_dir() {
  local dir="$1" user="$2"
  mkdir -p "$dir"
  # 데이터 디렉터리는 서비스 사용자만 읽기/쓰기 가능하도록 설정. 실패 시 경고만.
  if chown "$user" "$dir" 2>/dev/null; then
    chmod 750 "$dir"
  else
    warn "chown 실패: $dir — 권한을 수동으로 확인하세요."
  fi
}

# --- 서브커맨드 --------------------------------------------------------------

cmd_install() {
  require_root
  validate_install_dir "$INSTALL_DIR"

  if [[ -z "${UFW_WEBUI_JWT_SECRET:-}" ]]; then
    warn "UFW_WEBUI_JWT_SECRET 환경변수가 설정되지 않았습니다."
    warn "  → 기본 시크릿으로 동작합니다. 프로덕션에서는 반드시 강력한 랜덤값을 설정하세요."
    warn "  → 예: export UFW_WEBUI_JWT_SECRET=\$(openssl rand -hex 32)"
  fi

  local node_bin
  node_bin="$(resolve_node_bin)"

  if [[ "$SERVICE_USER" != "root" ]]; then
    warn "--user $SERVICE_USER 으로 실행합니다. 이 사용자는 'ufw' 를 직접 호출할 권한이 있어야 합니다."
  fi

  ensure_data_dir "$DATA_DIR" "$SERVICE_USER"

  log "서비스 유닛 작성: $SYSTEMD_UNIT"
  cat > "$SYSTEMD_UNIT" <<EOF
# 이 파일은 $SCRIPT_NAME 에 의해 자동 생성되었습니다.
# 직접 수정하기 보다는 install 스크립트를 다시 실행해 주세요.

[Unit]
Description=$SERVICE_DESCRIPTION
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/apps/server
ExecStart=$node_bin $INSTALL_DIR/apps/server/dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=10

Environment=NODE_ENV=production
Environment=UFW_WEBUI_DATA_DIR=$DATA_DIR
# UFW_WEBUI_JWT_SECRET 는 등록 시점에 이미 export 되어 있어야 한다.
# 미설정 상태에서 install 하면 경고만 출력하고 빈 값으로 채워지며, 서비스 기동 시
# 서버가 WARNING 로그를 남긴다 (그리고 매 재기동마다 토큰이 무효화되므로 권장하지 않음).
Environment=UFW_WEBUI_JWT_SECRET=${UFW_WEBUI_JWT_SECRET:-}

StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

# 일부 하드닝 옵션. UFW 자체가 /etc/ufw, /var/lib/ufw 등 시스템 위치에 쓰므로
# ProtectSystem 류 옵션은 의도적으로 사용하지 않는다.
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictRealtime=true
RestrictNamespaces=true

[Install]
WantedBy=multi-user.target
EOF

  log "systemd 데몬 리로드"
  systemctl daemon-reload

  if (( ENABLE_SERVICE )); then
    log "부팅 시 자동 시작 활성화"
    systemctl enable "$SERVICE_NAME"
  fi

  if (( START_SERVICE )); then
    log "서비스 시작"
    systemctl restart "$SERVICE_NAME"
    sleep 1
    if systemctl is-active --quiet "$SERVICE_NAME"; then
      log "서비스가 정상 기동했습니다."
    else
      warn "서비스 기동에 실패했습니다. 'sudo journalctl -u $SERVICE_NAME -n 100 --no-pager' 로 로그를 확인하세요."
    fi
  fi

  cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✔ UFW WebUI 가 systemd 서비스로 등록되었습니다.

  • 서비스 이름 : $SERVICE_NAME
  • 유닛 파일   : $SYSTEMD_UNIT
  • 실행 사용자 : $SERVICE_USER
  • 데이터 위치 : $DATA_DIR
  • Node 바이너리: $node_bin
  • JWT 시크릿  : ${UFW_WEBUI_JWT_SECRET:-<미설정 — 기본값 사용>}

관리 명령:
  sudo systemctl status   $SERVICE_NAME
  sudo systemctl stop     $SERVICE_NAME
  sudo systemctl restart  $SERVICE_NAME
  sudo systemctl disable  $SERVICE_NAME

로그 보기:
  sudo journalctl -u $SERVICE_NAME -f
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
}

cmd_uninstall() {
  require_root

  if [[ -f "$SYSTEMD_UNIT" ]]; then
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
      log "서비스 중지"
      systemctl stop "$SERVICE_NAME" || true
    fi
    if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
      log "자동 시작 비활성화"
      systemctl disable "$SERVICE_NAME" || true
    fi
    log "서비스 유닛 제거: $SYSTEMD_UNIT"
    rm -f "$SYSTEMD_UNIT"
  else
    log "등록된 유닛 파일이 없습니다: $SYSTEMD_UNIT — 이미 해제된 상태로 간주합니다."
  fi

  systemctl daemon-reload
  systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true

  cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✔ UFW WebUI 서비스 등록이 해제되었습니다.

데이터 디렉터리 ($DATA_DIR) 는 보존되었습니다.
완전 삭제가 필요하면 직접 'sudo rm -rf $DATA_DIR' 하세요.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
}

cmd_status() {
  if [[ -f "$SYSTEMD_UNIT" ]]; then
    log "서비스 유닛 등록됨: $SYSTEMD_UNIT"
    systemctl status "$SERVICE_NAME" --no-pager || true
  else
    log "서비스가 등록되어 있지 않습니다."
    echo "등록하려면 'sudo $SCRIPT_NAME install' 을 실행하세요."
    exit 1
  fi
}

# --- 인자 파싱 / main --------------------------------------------------------

parse_install_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --install-dir)    INSTALL_DIR="$2"; shift 2 ;;
      --data-dir)       DATA_DIR="$2"; shift 2 ;;
      --user)           SERVICE_USER="$2"; shift 2 ;;
      --systemd-unit)   SYSTEMD_UNIT="$2"; shift 2 ;;
      --no-enable)      ENABLE_SERVICE=0; shift ;;
      --no-start)       START_SERVICE=0; shift ;;
      -h|--help)        usage; exit 0 ;;
      *)                die "알 수 없는 옵션: $1" ;;
    esac
  done
}

main() {
  local cmd="${1:-}"
  if [[ $# -gt 0 ]]; then shift; fi

  case "$cmd" in
    install)    parse_install_args "$@"; cmd_install ;;
    uninstall)  cmd_uninstall ;;
    status)     cmd_status ;;
    ""|help|-h|--help)
      usage
      ;;
    *)
      err "알 수 없는 명령: $cmd"
      usage
      exit 2
      ;;
  esac
}

main "$@"
