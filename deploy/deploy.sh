#!/usr/bin/env bash
#
# 构建 + 发布 + 重启。日常更新跑这一个就够了。
#
#   sudo bash /opt/a2ui/deploy/deploy.sh
#
# 做四件事：
#   1. 拉代码（目录是 git 仓库时才拉）
#   2. 装依赖 + 全量构建（core 的 dist/mock 是服务端场景数据的来源，必须构建）
#   3. 前端产物覆盖到 /var/www/a2ui
#   4. pm2 重启 + 自检 /health
#
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/a2ui}"
WEB_ROOT="${WEB_ROOT:-/var/www/a2ui}"
SERVER_DIR="$REPO_DIR/server/a2ui-playground-server"
PM2_NAME="${PM2_NAME:-a2ui-server}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$REPO_DIR" ] || fail "代码目录不存在：$REPO_DIR"
cd "$REPO_DIR"

# ---------- 0. 前置检查 ----------
say "前置检查"
command -v node >/dev/null || fail "没有 node，请先跑 deploy/bootstrap.sh"
command -v pnpm >/dev/null || fail "没有 pnpm，请先跑 deploy/bootstrap.sh"
node -e 'const m=Number(process.versions.node.split(".")[0]); if(m<22){console.error("Node 需要 >= 22，当前 "+process.version); process.exit(1)}'
echo "node $(node -v) / pnpm $(pnpm -v)"

[ -f "$SERVER_DIR/.env" ] || fail "缺少 $SERVER_DIR/.env（从 .env.example 复制并填 Key，权限 600）"

# ---------- 1. 拉代码 ----------
if [ -d "$REPO_DIR/.git" ] && [ "${SKIP_PULL:-0}" != "1" ]; then
  say "拉取最新代码"
  git -C "$REPO_DIR" pull --ff-only || fail "git pull 失败（本地有改动？或用 SKIP_PULL=1 跳过）"
else
  say "跳过 git pull（非 git 目录或 SKIP_PULL=1）"
fi

# ---------- 2. 依赖 ----------
say "安装依赖"
pnpm install --frozen-lockfile

# ---------- 3. 构建 ----------
# 前端要和后端同域：把 SERVER_BASE 置空 → 请求走 /api/... 相对路径，由 nginx 反代。
# 注意必须用空串（源码里是 ?? 而不是 ||），否则会被顶回 localhost:3000。
say "构建（VITE_A2UI_SERVER 置空 = 同域相对路径）"
export NODE_OPTIONS="--max-old-space-size=2048"
VITE_A2UI_SERVER='' pnpm -r build

[ -f "$REPO_DIR/web/a2ui-playground/dist/index.html" ] || fail "前端产物缺失：web/a2ui-playground/dist"
[ -f "$SERVER_DIR/dist/index.js" ] || fail "服务端产物缺失：$SERVER_DIR/dist/index.js"
[ -d "$REPO_DIR/packages/a2ui-core/dist/mock" ] || fail "core 的 mock 产物缺失（服务端场景数据依赖它）"

# ---------- 4. 发布静态 ----------
say "发布前端到 $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rm -rf "${WEB_ROOT:?}"/*
cp -r "$REPO_DIR/web/a2ui-playground/dist/." "$WEB_ROOT/"
echo "已发布 $(find "$WEB_ROOT" -type f | wc -l) 个文件"

# ---------- 5. 重启 ----------
say "重启服务端"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 reload "$REPO_DIR/deploy/ecosystem.config.cjs" --update-env
else
  pm2 start "$REPO_DIR/deploy/ecosystem.config.cjs"
fi
pm2 save >/dev/null

# ---------- 6. 自检 ----------
say "自检"
ok=0
for i in $(seq 1 15); do
  sleep 1
  if curl -fsS --max-time 3 http://127.0.0.1:3000/health >/tmp/a2ui-health.json 2>/dev/null; then
    ok=1
    break
  fi
done

if [ "$ok" -ne 1 ]; then
  echo
  pm2 logs "$PM2_NAME" --lines 40 --nostream || true
  fail "服务没起来（/health 无响应），日志见上"
fi

cat /tmp/a2ui-health.json; echo
say "部署完成"
cat <<TIP

访问：
  http://$(curl -fsS --max-time 3 https://api.ipify.org 2>/dev/null || echo '<公网IP>')/

常用命令：
  pm2 logs $PM2_NAME          # 看日志
  pm2 restart $PM2_NAME       # 重启
  systemctl reload nginx      # 改了 nginx 配置后

TIP
