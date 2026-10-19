#!/bin/sh
# 容器启动钩子（官方 nginx 镜像会执行 /docker-entrypoint.d/*.sh，然后再拉起 nginx）。
#
# 只做一件事：按「证书在不在」生成 /etc/nginx/conf.d/default.conf。
#   - 证书就绪 → tls 模板（80 跳转 + 443 站点）
#   - 没证书   → http-only 模板（站点直接跑在 80）
# 这样同一份镜像既能裸跑（本地/CI 无域名），也能直接上生产。
set -eu

SERVER_NAME="${A2UI_SERVER_NAME:-_}"
HTTPS_PORT="${A2UI_PUBLIC_HTTPS_PORT:-443}"
CERT_NAME="${A2UI_CERT_NAME:-}"

case "$HTTPS_PORT" in
  ""|"443") HTTPS_SUFFIX="" ;;
  *)        HTTPS_SUFFIX=":${HTTPS_PORT}" ;;
esac

export A2UI_SERVER_NAME="$SERVER_NAME"
export A2UI_HTTPS_SUFFIX="$HTTPS_SUFFIX"
export A2UI_CERT_NAME="$CERT_NAME"

# live/<name>/ 里全是软链，所以 compose 必须整棵挂 /etc/letsencrypt（只挂 live 会是断链）。
CERT_FILE="/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem"

if [ -n "$CERT_NAME" ] && [ -s "$CERT_FILE" ]; then
  echo "[a2ui] 证书就绪（${CERT_FILE}）→ HTTPS 模式（server_name: ${SERVER_NAME}，对外端口 ${HTTPS_PORT}）"
  # 只替换这几个变量：nginx 自带的 $host / $request_uri 不能被 envsubst 动
  envsubst '${A2UI_SERVER_NAME} ${A2UI_HTTPS_SUFFIX} ${A2UI_CERT_NAME}' \
    < /opt/a2ui/nginx/tls.conf.template > /etc/nginx/conf.d/default.conf
else
  echo "[a2ui] 未找到证书（A2UI_CERT_NAME=\"${CERT_NAME}\" → ${CERT_FILE}）→ HTTP-only 模式"
  envsubst '${A2UI_SERVER_NAME}' \
    < /opt/a2ui/nginx/http-only.conf.template > /etc/nginx/conf.d/default.conf
fi
