#!/usr/bin/env bash
#
# 一键构建 + 启动 + 自检。幂等：重复跑就是「更新到当前代码」。
#
#   sudo bash deploy/docker/up.sh
#
# 只做三件事：检查 .env → compose up --build → 打一次本机自检。
# 端口、域名、证书路径全在 .env 里；这个脚本不硬编码任何一项。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "没装 docker（见 deploy/docker/README.md 的安装段）"
docker compose version >/dev/null 2>&1 || fail "缺少 docker compose 插件（docker-compose-plugin）"

[ -f .env ] || fail "缺少 .env：先 cp .env.example .env，填好 A2UI_SERVER_NAME 与模型 Key"

# .env 里取端口（去掉引号和行尾空白）
env_get() { sed -n "s/^$1=//p" .env | tail -1 | tr -d '"' | tr -d "'" | tr -d '\r' | xargs; }
HTTP_PORT="$(env_get A2UI_HTTP_PORT)"; HTTP_PORT="${HTTP_PORT:-8080}"
HTTPS_PORT="$(env_get A2UI_HTTPS_PORT)"; HTTPS_PORT="${HTTPS_PORT:-8443}"

say "构建镜像"
docker compose build

say "启动"
docker compose up -d --remove-orphans

say "等待 server 健康"
ok=0
for _ in $(seq 1 30); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' a2ui-server 2>/dev/null || echo none)" = "healthy" ]; then
    ok=1; break
  fi
  sleep 1
done
[ "$ok" = "1" ] || { docker compose logs --tail 40 server; fail "server 没进 healthy 状态，日志见上"; }

say "自检"
docker compose ps
echo
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -k "https://127.0.0.1:${HTTPS_PORT}/" || echo 000)
echo "https://127.0.0.1:${HTTPS_PORT}/  -> $code"
api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -k "https://127.0.0.1:${HTTPS_PORT}/api/a2ui/scenarios" || echo 000)
echo "https://127.0.0.1:${HTTPS_PORT}/api/a2ui/scenarios -> $api"
http=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${HTTP_PORT}/" || echo 000)
echo "http://127.0.0.1:${HTTP_PORT}/  -> $http"

cat <<TIP

容器内 80/443，宿主映射：
  80  → ${HTTP_PORT}
  443 → ${HTTPS_PORT}

从外部验证（本机 curl 通 ≠ 公网通，云防火墙在实例外面）：
  curl -sS -o /dev/null -w '%{http_code}\\n' https://<域名或IP>:${HTTPS_PORT}/

TIP
