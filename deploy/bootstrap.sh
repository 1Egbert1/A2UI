#!/usr/bin/env bash
#
# 一次性初始化：在全新的 Lighthouse / Linux 机器上装好运行环境。
# 幂等：重复执行不会重复安装（已装则跳过）。
#
#   sudo bash /opt/a2ui/deploy/bootstrap.sh
#
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/a2ui}"
WEB_ROOT="${WEB_ROOT:-/var/www/a2ui}"
LOG_DIR="${LOG_DIR:-/var/log/a2ui}"
NODE_MAJOR="${NODE_MAJOR:-22}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 运行：sudo bash $0" >&2
  exit 1
fi

# ---------- 1. 识别包管理器 ----------
if command -v apt-get >/dev/null 2>&1; then
  PKG=apt
elif command -v dnf >/dev/null 2>&1; then
  PKG=dnf
elif command -v yum >/dev/null 2>&1; then
  PKG=yum
else
  echo "未识别的发行版（没有 apt/dnf/yum）" >&2
  exit 1
fi
say "包管理器：$PKG"

pkg_install() {
  case "$PKG" in
    apt) apt-get update -y && apt-get install -y "$@" ;;
    dnf) dnf install -y "$@" ;;
    yum) yum install -y "$@" ;;
  esac
}

# ---------- 2. 基础工具 ----------
say "安装基础工具"
pkg_install curl ca-certificates git

# ---------- 3. Node.js ----------
need_node=1
if command -v node >/dev/null 2>&1; then
  current="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "$current" -ge "$NODE_MAJOR" ]; then
    need_node=0
    say "已装 Node v$(node -v | sed 's/^v//')，跳过"
  else
    warn "当前 Node v$current < $NODE_MAJOR，需要升级"
  fi
fi

if [ "$need_node" -eq 1 ]; then
  say "安装 Node.js ${NODE_MAJOR}.x（NodeSource）"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh 2>/dev/null || true
  if [ "$PKG" = apt ] && [ -s /tmp/nodesource_setup.sh ]; then
    bash /tmp/nodesource_setup.sh
    apt-get install -y nodejs
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    pkg_install nodejs
  fi
  node -v
fi

# ---------- 4. pnpm ----------
say "启用 pnpm（corepack，跟随仓库 packageManager 字段）"
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@latest --activate
fi
pnpm -v

# ---------- 5. nginx ----------
if ! command -v nginx >/dev/null 2>&1; then
  say "安装 nginx"
  pkg_install nginx
fi

# 腾讯云部分镜像预装了 Caddy（默认 :80 静态站），会占住 80 导致 nginx 起不来：
#   nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
# 这里只提示，不替用户停服务。
if systemctl is-active caddy >/dev/null 2>&1; then
  warn "检测到 Caddy 正在占用 80，nginx 会启动失败。"
  warn "若不需要它：sudo systemctl disable --now caddy  然后 sudo systemctl start nginx"
fi

systemctl enable --now nginx || systemctl restart nginx

# ---------- 6. pm2 ----------
if ! command -v pm2 >/dev/null 2>&1; then
  say "安装 pm2"
  npm install -g pm2
  # 开机自启（pm2 会打印一条要手动执行的命令，这里直接跑掉）
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || warn "pm2 startup 失败，可稍后手动执行"
fi

# ---------- 7. 目录 ----------
say "创建目录"
mkdir -p "$WEB_ROOT" "$LOG_DIR"
[ -d "$REPO_DIR" ] || warn "代码目录 $REPO_DIR 不存在 —— 请先把仓库放进去（git clone 或 rsync）"

# ---------- 8. nginx 站点 ----------
say "写入 nginx 配置"
if [ -f "$REPO_DIR/deploy/nginx.conf" ]; then
  if [ "$PKG" = apt ]; then
    install -m 644 "$REPO_DIR/deploy/nginx.conf" /etc/nginx/sites-available/a2ui
    ln -sf /etc/nginx/sites-available/a2ui /etc/nginx/sites-enabled/a2ui
    rm -f /etc/nginx/sites-enabled/default
  else
    install -m 644 "$REPO_DIR/deploy/nginx.conf" /etc/nginx/conf.d/a2ui.conf
  fi
  nginx -t && systemctl reload nginx
else
  warn "没找到 $REPO_DIR/deploy/nginx.conf，跳过 nginx 配置"
fi

# ---------- 9. 防火墙提示 ----------
say "完成"
cat <<'TIP'

还需要确认两件事（腾讯云 Lighthouse 控制台）：

  1. 防火墙放通 80（要 HTTPS 再加 443）
     - 控制台 → 防火墙 → 添加规则 → TCP:80

  2. 填模型 Key：
       cp /opt/a2ui/server/a2ui-playground-server/.env.example \
          /opt/a2ui/server/a2ui-playground-server/.env
       vim /opt/a2ui/server/a2ui-playground-server/.env   # AGENT_PROVIDER=openai、OPENAI_API_KEY=sk-***
       chmod 600 /opt/a2ui/server/a2ui-playground-server/.env

然后执行部署：
  sudo bash /opt/a2ui/deploy/deploy.sh

TIP
