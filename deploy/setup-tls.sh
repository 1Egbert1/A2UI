#!/usr/bin/env bash
#
# 给 A2UI 站点上 HTTPS。两种模式，按你手里有什么选：
#
#   有已备案域名：  sudo bash deploy/setup-tls.sh --domain a2ui.example.com --email me@example.com
#   只有公网 IP：   sudo bash deploy/setup-tls.sh --ip 82.156.76.114
#
# 两种都会：申请证书 → 装 deploy/nginx.tls.conf（80 跳转 + 443 站点）→ 自检 → 配好自动续期。
#
# 加 --soft 只申请证书、不动 nginx：Lighthouse 防火墙还没放通 443 时先这么跑，
# 站点继续走 80，等端口开了再去掉 --soft 跑一次切到 HTTPS。
#
# 为什么「只有 IP」也要单独一条路：境内服务器的域名要备案，**未备案域名的请求会被网关
# 直接 302 到 dnspod 的 webblock 页**（Let's Encrypt 的校验请求也会被打到那个页上，签发必然失败）。
# 裸 IP 访问不受这条限制，而 Let's Encrypt 现在能签 IP 证书（shortlived profile，7 天有效期），
# 所以没有备案域名时，直接对 IP 签一张就是唯一能拿到「浏览器认的」证书的办法。
#
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TEMPLATE="$REPO_DIR/deploy/nginx.tls.conf"
WEB_ROOT="${WEB_ROOT:-/var/www/a2ui}"
CERTBOT_VENV="${CERTBOT_VENV:-/opt/certbot-venv}"

SERVER_NAME=""
TARGET=""
MODE=""
EMAIL=""
SOFT=0

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

usage() { sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1; }

# ---------- 0. 参数 ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) MODE=domain; TARGET="${2:-}"; SERVER_NAME="${2:-}"; shift 2 ;;
    --ip)     MODE=ip;     TARGET="${2:-}"; SERVER_NAME="_";        shift 2 ;;
    --email)  EMAIL="${2:-}"; shift 2 ;;
    --soft)   SOFT=1; shift ;;
    -h|--help) usage ;;
    *) fail "不认识的参数：$1（--help 看用法）" ;;
  esac
done

[ -n "$MODE" ] || usage
[ "$(id -u)" -eq 0 ] || fail "要用 root 跑（sudo）"
[ -f "$TEMPLATE" ] || fail "缺少模板：$TEMPLATE"
[ -d "$WEB_ROOT" ] || fail "静态目录不存在：$WEB_ROOT（先跑 deploy/deploy.sh）"

# nginx 站点文件（bootstrap 写在 sites-available，有的系统用 conf.d）
SITE_FILE=""
for f in /etc/nginx/sites-available/a2ui /etc/nginx/conf.d/a2ui.conf; do
  [ -f "$f" ] && SITE_FILE="$f" && break
done
[ -n "$SITE_FILE" ] || fail "找不到 nginx 站点配置（先跑 deploy/bootstrap.sh）"

say "模式：$MODE  目标：$TARGET  站点：$SITE_FILE"

# ---------- 1. 装 certbot ----------
# 域名模式用发行版自带的 certbot 就够；IP 模式需要 >= 5.0（--ip-address + --required-profile），
# apt 里的 2.9 不支持，所以装一份独立的 venv，不污染系统 Python。
if [ "$MODE" = "ip" ]; then
  if [ ! -x "$CERTBOT_VENV/bin/certbot" ] || \
     [ "$("$CERTBOT_VENV/bin/certbot" --version 2>/dev/null | grep -o '[0-9]\+' | head -1)" -lt 5 ]; then
    say "安装 certbot 5.x 到 $CERTBOT_VENV（apt 版本不支持 IP 证书）"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-venv >/dev/null 2>&1 || true
    python3 -m venv "$CERTBOT_VENV"
    "$CERTBOT_VENV/bin/pip" install -q --upgrade pip
    "$CERTBOT_VENV/bin/pip" install -q certbot certbot-nginx
  fi
  CERTBOT="$CERTBOT_VENV/bin/certbot"
else
  command -v certbot >/dev/null 2>&1 || {
    say "安装 certbot"
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
  }
  CERTBOT="$(command -v certbot)"
fi
echo "certbot $("$CERTBOT" --version 2>/dev/null)"

# ---------- 2. 申请证书 ----------
# 统一走 webroot：静态目录本来就在 nginx 的 root 下，不需要停服务，
# 也不用让 certbot 去改我们的配置（它改完就和我们仓库里的模板不一致了）。
if [ -f "/etc/letsencrypt/live/$TARGET/fullchain.pem" ]; then
  say "证书已存在，跳过申请（要重签先删 /etc/letsencrypt/live/$TARGET）"
else
  say "申请证书：$TARGET"
  common=(--webroot -w "$WEB_ROOT" --non-interactive --agree-tos)
  if [ -n "$EMAIL" ]; then
    common+=(-m "$EMAIL")
  else
    common+=(--register-unsafely-without-email)
  fi
  if [ "$MODE" = "ip" ]; then
    "$CERTBOT" certonly "${common[@]}" --ip-address "$TARGET" --required-profile shortlived
  else
    "$CERTBOT" certonly "${common[@]}" -d "$TARGET" --cert-name "$TARGET"
  fi
fi

CERT_DIR="/etc/letsencrypt/live/$TARGET"
[ -f "$CERT_DIR/fullchain.pem" ] || fail "证书没生成：$CERT_DIR/fullchain.pem 不存在"

# ---------- 3. 渲染并安装 nginx 配置 ----------
install_tls_config() {
  say "安装 HTTPS 配置"
  cp "$SITE_FILE" "$SITE_FILE.http.bak"

  # 先用 IP/域名 + 证书路径渲染一份临时文件，nginx -t 通过后再落盘，
  # 避免配置写坏导致 nginx reload 失败、站点整个不可用。
  local tmp
  tmp="$(mktemp)"
  sed -e "s|__SERVER_NAME__|$SERVER_NAME|g" \
      -e "s|__SSL_CERT__|$CERT_DIR/fullchain.pem|g" \
      -e "s|__SSL_KEY__|$CERT_DIR/privkey.pem|g" \
      "$TEMPLATE" >"$tmp"

  # 80 端口被别的站点默认吃了会冲突（default_server 只能有一个），提示一下
  if grep -rl "listen.*80.*default_server" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null \
     | grep -v "$(basename "$SITE_FILE")" >/dev/null; then
    warn "检测到别的站点也声明了 80 default_server，可能冲突："
    grep -rl "listen.*80.*default_server" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null || true
  fi

  install -m 644 "$tmp" "$SITE_FILE"
  rm -f "$tmp"

  ln -sfn "$SITE_FILE" /etc/nginx/sites-enabled/a2ui 2>/dev/null || true
  nginx -t || {
    cp "$SITE_FILE.http.bak" "$SITE_FILE"
    nginx -t || true
    fail "配置校验失败，已回滚到 $SITE_FILE.http.bak"
  }
  systemctl reload nginx
}

if [ "$SOFT" = "1" ]; then
  say "--soft：只备好证书，nginx 配置不动（站点继续走 80）"
else
  install_tls_config
fi

# ---------- 4. 续期 ----------
# IP 证书只有 7 天，必须真的自动续。apt 装的 certbot.timer 会用 /usr/bin/certbot（2.9），
# 它不认识 required_profile，所以给它换成 venv 里的新版，并停掉 apt 的 cron.d 重复任务。
if [ "$MODE" = "ip" ]; then
  say "把续期任务切到 $CERTBOT"
  mkdir -p /etc/systemd/system/certbot.service.d
  cat >/etc/systemd/system/certbot.service.d/use-venv.conf <<EOF
[Service]
ExecStart=
ExecStart=$CERTBOT -q renew --no-random-sleep-on-renew --deploy-hook "systemctl reload nginx"
EOF
  rm -f /etc/cron.d/certbot
  systemctl daemon-reload
  systemctl enable --now certbot.timer >/dev/null 2>&1 || true
fi

# ---------- 5. 自检 ----------
say "自检"
if [ "$SOFT" = "1" ]; then
  echo "证书文件：$CERT_DIR/fullchain.pem"
  echo "有效期：$(openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -enddate 2>/dev/null | cut -d= -f2)"
  echo "（nginx 没动，443 现在还没监听 —— 这是 --soft 的预期结果）"
else
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -k "https://127.0.0.1/" -H "Host: $TARGET" || echo 000)
  echo "https 首页（本机）: $code"
  api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -k "https://127.0.0.1/api/a2ui/scenarios" -H "Host: $TARGET" || echo 000)
  echo "https /api/a2ui/scenarios: $api"
  curl -s -o /dev/null -w '80 跳转: %{http_code} -> %{redirect_url}\n' --max-time 8 "http://127.0.0.1/" -H "Host: $TARGET" || true

  if command -v openssl >/dev/null 2>&1; then
    echo
    echo "$TARGET 的证书："
    echo | openssl s_client -connect 127.0.0.1:443 -servername "$TARGET" 2>/dev/null \
      | openssl x509 -noout -subject -issuer -dates 2>/dev/null || true
  fi

  # 本机能通不代表公网能通：云厂商的防火墙在实例外面，只能从外部验证。
  warn "本机通过 ≠ 公网通过。立刻从**外部**验证一次："
  warn "  curl -sS -o /dev/null -w '%{http_code}\\n' https://$TARGET/"
  warn "如果超时 → Lighthouse 控制台 → 防火墙 → 放通 TCP:443；"
  warn "期间站点会打不开（80 已经跳转），先回滚："
  warn "  sudo cp $SITE_FILE.http.bak $SITE_FILE && sudo nginx -t && sudo systemctl reload nginx"
fi

say "完成"
if [ "$SOFT" = "1" ]; then
cat <<TIP

证书已就绪，但站点仍是 HTTP。放通 443 之后，去掉 --soft 再跑一次切到 HTTPS：
  sudo bash $REPO_DIR/deploy/setup-tls.sh --ip $TARGET

TIP
  exit 0
fi

cat <<TIP

访问：https://$TARGET/

续期：
  $CERTBOT renew --dry-run     # 演练一次
  systemctl list-timers certbot.timer
  systemctl status certbot.timer

如果浏览器打不开（本机 curl 通过但公网不通）：
  Lighthouse 控制台 → 防火墙 → 放通 443（80 留着，ACME 续期要用）。

回滚到 HTTP（万一）：
  sudo cp $SITE_FILE.http.bak $SITE_FILE && sudo nginx -t && sudo systemctl reload nginx

TIP
