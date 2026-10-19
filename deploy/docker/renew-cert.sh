#!/usr/bin/env bash
#
# 证书续期（容器化之后的新姿势）。
#
# 为什么不能沿用原来的 webroot：以前是宿主 nginx 占 80，certbot 把校验文件写进
# /var/www/a2ui，nginx 直接就能吐出来。现在站点搬进容器、宿主 80 已经空出来了，
# 所以改用 `--standalone`：certbot 自己临时监听 80 完成校验，完了就把端口还回去。
#
#   sudo bash deploy/docker/renew-cert.sh            # 真的续
#   sudo bash deploy/docker/renew-cert.sh --dry-run  # 演练
#
# 续完自动 reload 容器里的 nginx（新证书是挂进去的，但 nginx 只在启动时读一次）。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

CERTBOT="${CERTBOT:-/opt/certbot-venv/bin/certbot}"
[ -x "$CERTBOT" ] || CERTBOT="$(command -v certbot)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }

[ -n "${CERTBOT:-}" ] || { echo "找不到 certbot" >&2; exit 1; }

# 80 被宿主上的别的服务占着时，standalone 起不来 —— 提前说，别让 certbot 抛一堆栈
if command -v ss >/dev/null 2>&1; then
  if ss -lnt 2>/dev/null | grep -qE '(:|\])80[[:space:]]'; then
    warn "宿主 80 端口已被占用（certbot --standalone 需要它）。"
    warn "如果占用方是网关/反代，请让它在 /.well-known/acme-challenge/ 上代理到容器；"
    warn "或者改用 DNS-01：certbot renew --preferred-challenges dns"
  fi
fi

say "续期"
# --no-random-sleep-on-renew：不加的话 certbot 会随机 sleep 最多 8 分钟（把负载摊开用的），
# 手动跑的时候看起来就像卡死了。systemd timer 里同样需要它。

if "$CERTBOT" renew --standalone --http-01-port 80 --no-random-sleep-on-renew "$@" \
    --deploy-hook "$PWD/reload-edge.sh"; then
  :
else
  # 迁移期兜底：宿主 nginx 还没下线时 80 被它占着，standalone 起不来，
  # 但那时原来的 webroot（/var/www/a2ui）正好还能被它服务，退回去照样能续。
  warn "standalone 失败，回退到 webroot 方式（仅当宿主 nginx 仍在服务 /var/www/a2ui 时有效）"
  "$CERTBOT" renew --no-random-sleep-on-renew "$@" --deploy-hook "$PWD/reload-edge.sh"
fi

say "当前证书"
"$CERTBOT" certificates | grep -E "Certificate Name|Domains|Expiry" || true
