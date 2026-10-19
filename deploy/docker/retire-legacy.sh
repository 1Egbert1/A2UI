#!/usr/bin/env bash
#
# 从「宿主 nginx + pm2」切到「docker compose」时，把旧的一套下线，释放 80/443。
#
#   sudo bash deploy/docker/retire-legacy.sh
#
# 只 disable、不卸载、不删文件：
#   - nginx 的包和站点配置都还在（/etc/nginx/sites-available/a2ui 与 .http.bak / .tls 版本）
#   - pm2 的进程定义还在磁盘上
# 所以随时能一键回退，见脚本最后打印的命令。
#
# 前提：容器已经能正常服务（先在宿主上 curl 一下 8080/8443 都通），
#       并且公网已经放通新端口 —— 否则这一步会让站点直接不可访问。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }

env_get() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -1 | tr -d '"' | tr -d "'" | tr -d '\r' | xargs; }
HTTP_PORT="$(env_get A2UI_HTTP_PORT)"; HTTP_PORT="${HTTP_PORT:-8080}"
HTTPS_PORT="$(env_get A2UI_HTTPS_PORT)"; HTTPS_PORT="${HTTPS_PORT:-8443}"

# ---- 先确认容器是活的：别在“新的没起来”的情况下把旧的关了 ----
say "确认容器健康"
web_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -k "https://127.0.0.1:${HTTPS_PORT}/" || echo 000)"
api_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -k "https://127.0.0.1:${HTTPS_PORT}/api/a2ui/scenarios" || echo 000)"
echo "web ${web_code} / api ${api_code}"
[ "$web_code" = "200" ] && [ "$api_code" = "200" ] || {
  warn "容器自检没过（web=${web_code} api=${api_code}），不执行下线。先修好容器再来。"
  exit 1
}

# ---- 下线旧的一套 ----
say "停用宿主 nginx"
if systemctl is-enabled nginx >/dev/null 2>&1; then
  systemctl disable --now nginx
  echo "nginx 已 disable（配置与证书都保留）"
else
  echo "nginx 本来就没启用"
fi

say "停用 pm2 里的 a2ui-server"
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete a2ui-server >/dev/null 2>&1 || true
  pm2 save --force >/dev/null 2>&1 || true
  if systemctl is-enabled pm2-root >/dev/null 2>&1; then
    systemctl disable --now pm2-root >/dev/null 2>&1 || true
    echo "pm2-root 开机自启已关闭"
  fi
else
  echo "没装 pm2，跳过"
fi

say "现在的监听"
ss -lntp 2>/dev/null | grep -E ":(80|443|${HTTP_PORT}|${HTTPS_PORT})\b" || true

say "完成"
cat <<TIP

旧的一套已下线，80/443 空出来了，可以给后续服务或统一网关用。

回退到宿主的 nginx + pm2（需要先用宿主配置重新占用端口）：
  sudo systemctl enable --now nginx
  cd /opt/a2ui && sudo pm2 start deploy/ecosystem.config.cjs && sudo pm2 save

只回退 nginx 配置到某个历史版本：
  sudo cp /etc/nginx/sites-available/a2ui.http.bak /etc/nginx/sites-available/a2ui
  sudo nginx -t && sudo systemctl reload nginx

TIP
