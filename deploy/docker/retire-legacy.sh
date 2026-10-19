#!/usr/bin/env bash
#
# 从「宿主 nginx + pm2」切到「docker compose」时，把旧的一套下线，释放 80/443。
#
#   sudo bash deploy/docker/retire-legacy.sh          # 自检通过才执行
#   sudo bash deploy/docker/retire-legacy.sh --force  # 自检没过也硬上（危险）
#
# 只 disable、不卸载、不删文件：
#   - nginx 的包和站点配置都还在（/etc/nginx/sites-available/a2ui 与 .http.bak / .tls 版本）
#   - pm2 的进程定义还在磁盘上
# 所以随时能一键回退，见脚本最后打印的命令。
#
# ★ 自检分两段，缺一不可：
#   ① 本机 127.0.0.1:<端口> —— 证明容器活着
#   ② **公网 IP:<端口>**     —— 证明云防火墙放通了。这一段曾经漏掉，结果容器只绑了 8080/8443
#      而防火墙只开了 80/443，脚本自检“通过”、旧 nginx 一停，站点直接从公网消失。
#      云防火墙在实例外面，只有打到公网地址才验证得到（这台机器 hairpin 回环是通的，所以能自测）。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

env_get() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -1 | tr -d '"' | tr -d "'" | tr -d '\r' | xargs; }
HTTP_PORT="$(env_get A2UI_HTTP_PORT)"; HTTP_PORT="${HTTP_PORT:-8080}"
HTTPS_PORT="$(env_get A2UI_HTTPS_PORT)"; HTTPS_PORT="${HTTPS_PORT:-8443}"

# ---- ① 容器本体 ----
say "① 容器自检（本机）"
web_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -k "https://127.0.0.1:${HTTPS_PORT}/" || echo 000)"
api_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -k "https://127.0.0.1:${HTTPS_PORT}/api/a2ui/scenarios" || echo 000)"
echo "127.0.0.1:${HTTPS_PORT}  web ${web_code} / api ${api_code}"
[ "$web_code" = "200" ] && [ "$api_code" = "200" ] || {
  warn "容器自检没过（web=${web_code} api=${api_code}），不执行下线。先修好容器再来。"
  exit 1
}

# ---- ② 公网可达性：这一步才真正决定「下线后站点还在不在」 ----
say "② 公网自检（走真实网络路径，能验到云防火墙）"
PUBIP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null \
      || curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null \
      || true)"
if [ -z "$PUBIP" ]; then
  warn "取不到公网 IP，跳过公网自检（只能信 ① 的结果了）"
  PUB_CODE="skip"
else
  PUB_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -k "https://${PUBIP}:${HTTPS_PORT}/" || echo 000)"
  PUB_API="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -k "https://${PUBIP}:${HTTPS_PORT}/api/a2ui/scenarios" || echo 000)"
  echo "${PUBIP}:${HTTPS_PORT}  web ${PUB_CODE} / api ${PUB_API}"
fi

if [ "$PUB_CODE" != "200" ]; then
  cat >&2 <<ERR

$(printf '\033[1;31m[x] 公网打不开 ${PUBIP}:${HTTPS_PORT}（${PUB_CODE}），现在下线会让站点消失。\033[0m')

两条路，选一条：

  A. 去 Lighthouse 控制台 → 防火墙，放通 TCP ${HTTP_PORT} 与 ${HTTPS_PORT}，再重跑本脚本。
  B. 让容器直接吃默认端口（防火墙已经开着）——改 .env 后重启即可：
       A2UI_HTTP_PORT=80
       A2UI_HTTPS_PORT=443
       cd $(pwd) && docker compose up -d

ERR
  [ "$FORCE" = "1" ] || fail "已中止（确实要硬上就加 --force）"
  warn "带 --force 继续执行，站点可能立刻不可访问"
fi

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
# 用到的端口不一样，提示语也要跟着变：80/443 时是「没空出来」，其它端口才是「空出来了」。
if [ "$HTTP_PORT" = "80" ] && [ "$HTTPS_PORT" = "443" ]; then
  SCOPE_NOTE="当前公网入口就是容器：http ${HTTP_PORT} / https ${HTTPS_PORT}（80 会 301 到 https）。"
else
  SCOPE_NOTE="80/443 空出来了，可以给后续服务或统一网关用；当前容器入口是 http ${HTTP_PORT} / https ${HTTPS_PORT}（记得确认云防火墙已放通这两个端口）。"
fi

cat <<TIP

旧的一套已下线。${SCOPE_NOTE}

回退到宿主的 nginx + pm2（需要先用宿主配置重新占用端口）：
  sudo systemctl enable --now nginx
  cd /opt/a2ui && sudo pm2 start deploy/ecosystem.config.cjs && sudo pm2 save

只回退 nginx 配置到某个历史版本：
  sudo cp /etc/nginx/sites-available/a2ui.http.bak /etc/nginx/sites-available/a2ui
  sudo nginx -t && sudo systemctl reload nginx

TIP
