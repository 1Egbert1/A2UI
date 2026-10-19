#!/usr/bin/env bash
#
# 证书续期后让「边缘」重新加载证书。
#
# 边缘现在有两个可能：gateway（Caddy，占 80/443）或 web（nginx，直连 TLS 的老形态）。
# 谁在用就 reload 谁 —— 续期脚本只负责调这一个入口，不用关心当前是哪种形态。
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if docker compose exec -T gateway caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null; then
  echo "[reload-edge] gateway 已 reload"
elif docker compose exec -T web nginx -s reload 2>/dev/null; then
  echo "[reload-edge] web nginx 已 reload"
else
  echo "[reload-edge] 没 reload 成功（容器没跑？）" >&2
  # 不返回非 0：否则 certbot 会把一次成功的续期记成失败
fi
