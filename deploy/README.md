# 部署说明（腾讯云 Lighthouse / 任意 Linux 单机）

## 拓扑

```
Internet :80 / :443
   │
   ▼
 nginx（静态 + 反代；上了 TLS 后 80 只留 ACME 校验并 301 到 443）
   ├─ /                → /var/www/a2ui           （playground 的 vite 产物）
   └─ /api/            → 127.0.0.1:3000          （Node，pm2 守护）
                            └─ 读同目录 .env（模型 Key 只存在服务器上）
```

**为什么前后端同域**：前端 `SERVER_BASE` 置空 → 请求走 `/api/...` 相对路径，天然没有跨域、
不需要 HTTPS 混用处理，也不用给前端单独配一份后端地址。nginx 一处反代搞定。

## 前置：服务器上需要什么

| 项 | 要求 | 说明 |
|---|---|---|
| 系统 | Ubuntu 20.04+ / Debian 11+ / CentOS 8+ | `bootstrap.sh` 两种包管理器都认 |
| Node | **>= 22**（`engines` 要求） | bootstrap 会装 22 LTS |
| pnpm | 9+ | 通过 corepack 启用（与 lockfile 版本对齐） |
| nginx | 任意 | 反代 + 静态 |
| pm2 | 任意 | 进程守护 |
| 端口 | **80（+443）** | Lighthouse 控制台 → 防火墙需放通；默认已开 80/443 |
| 磁盘 | ≥ 2 GB | `node_modules` 较大（element-plus + MCP SDK） |

## 一次性初始化

```bash
# 1) 把代码放到 /opt/a2ui（任选一种）
#    a. 服务器直连 GitHub（国内可能慢）
git clone https://github.com/1Egbert1/A2UI.git /opt/a2ui
#    b. 或本地推到服务器（推荐，避免服务器拉 GitHub）
#       rsync -av --exclude node_modules --exclude dist --exclude .git ./ user@IP:/opt/a2ui/

# 2) 初始化环境（装 Node / pnpm / nginx / pm2，建目录）
sudo bash /opt/a2ui/deploy/bootstrap.sh

# 3) 填模型 Key（不进仓库，权限 600）
sudo cp /opt/a2ui/server/a2ui-playground-server/.env.example \
        /opt/a2ui/server/a2ui-playground-server/.env
sudo vim /opt/a2ui/server/a2ui-playground-server/.env
#   AGENT_PROVIDER=openai
#   OPENAI_API_KEY=sk-***
sudo chmod 600 /opt/a2ui/server/a2ui-playground-server/.env

# 4) 部署（安装依赖 → 全量构建 → 发布静态 → 重启进程）
sudo bash /opt/a2ui/deploy/deploy.sh
```

完成后访问 `http://<公网IP>/`。

## 日常更新

```bash
sudo bash /opt/a2ui/deploy/deploy.sh
```

脚本会：`git pull`（若是 git 仓库）→ `pnpm install --frozen-lockfile` → `pnpm -r build`
→ 覆盖静态目录 → `pm2 startOrReload` → 自检 `/health`。

## 可选：上 HTTPS

一条命令，两种模式，按手里有什么选（脚本见 `deploy/setup-tls.sh`，模板见 `deploy/nginx.tls.conf`）：

```bash
# A. 有已备案域名（推荐）
sudo bash /opt/a2ui/deploy/setup-tls.sh --domain a2ui.example.com --email me@example.com

# B. 只有公网 IP（无域名 / 域名没备案）
sudo bash /opt/a2ui/deploy/setup-tls.sh --ip 82.156.76.114

# 防火墙还没放通 443 时先只签证书，站点继续走 80
sudo bash /opt/a2ui/deploy/setup-tls.sh --ip 82.156.76.114 --soft
```

脚本做四件事：`certbot` 签证书（webroot，不停服务）→ 渲染 `nginx.tls.conf`（80 只留 ACME 校验
+ 跳转、站点搬进 443）→ 自检 → 配好自动续期。**不会覆盖 `deploy/nginx.conf`**，
`bootstrap.sh` 重跑也只会写回 HTTP 版，TLS 版由这个脚本独占。

### 境内服务器 + 没备案域名的坑（务必先看）

境内实例对**未备案域名**的请求会在网关层被拦掉：任何 HTTP 请求只要 `Host` 是没备案的域名，
都会被 `302` 到 `https://dnspod.qcloud.com/static/webblock.html?d=<域名>`。

```
$ curl -sv -H "Host: 82-156-76-114.sslip.io" http://82.156.76.114/
< HTTP/1.1 302 OK
< Location: https://dnspod.qcloud.com/static/webblock.html?d=82-156-76-114.sslip.io
```

后果是：**Let's Encrypt 的 HTTP-01 校验请求也会被拦到那个页面上**，所以临时域名方案
（`sslip.io` / `nip.io` 之类）在境内机器上签不出证书，必然报
`Invalid response from https://dnspod.qcloud.com/static/webblock.html?...`。

裸 IP 访问不受这条限制，而 Let's Encrypt 已经能签 **IP 证书**，所以没有备案域名时，
`--ip` 模式就是对 IP 签一张——这也是唯一能拿到「浏览器不报警」的证书的路子。

两个约束要注意：

- **IP 证书是 shortlived profile，只有 7 天有效期**。续期靠 `certbot.timer`，
  并且必须用 certbot >= 5（`--ip-address` + `--required-profile` 才支持 IP）。
  apt 源里的 2.9 不支持，所以脚本会在 `/opt/certbot-venv` 装一份独立的新版，
  同时把 `certbot.service` 的 `ExecStart` 覆盖成 venv 里的二进制，并删掉 apt 的
  `/etc/cron.d/certbot`（否则它每天用旧版跑一次、报错刷日志）。
- **IP 证书换不了证书链信任度**：`https://82.156.76.114` 在浏览器里是合法的绿锁，
  但换个 IP 就作废；要长期用还是得备好域名。

### 443 必须放通

`setup-tls.sh` 的自检是在**实例内部**打的 `127.0.0.1:443`，通了不代表公网通——
Lighthouse 的防火墙在实例外面。上线后立刻从外部验一次：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://82.156.76.114/
```

超时就到 **Lighthouse 控制台 → 防火墙 → 放通 TCP:443**（80 要留着，ACME 续期走 80）。
从放通到生效前，站点会因为 80 已跳转而打不开，先回滚：

```bash
sudo cp /etc/nginx/sites-available/a2ui.http.bak /etc/nginx/sites-available/a2ui
sudo nginx -t && sudo systemctl reload nginx
```

### 续期检查

```bash
/opt/certbot-venv/bin/certbot renew --dry-run   # IP 模式
systemctl list-timers certbot.timer
```

`certbot.service` 带了 `--deploy-hook "systemctl reload nginx"`，续期成功会自动 reload，
不需要手动重启。

## 排障

| 现象 | 排查 |
|---|---|
| 打开是 502 | `pm2 logs a2ui-server`；确认 `dist/index.js` 存在、`.env` 可读 |
| **`/api` 返回 404 且响应头是 `Server: Caddy`** | **80 被镜像预装的 Caddy 占了**，nginx 根本没起来（`systemctl status nginx` 会显示 `bind() 98: Address already in use`）。`sudo systemctl disable --now caddy && sudo systemctl start nginx`。恢复 Caddy：`sudo systemctl enable --now caddy` |
| 页面能开但生成无反应 | 浏览器 Network 看 `/api/a2ui/run`：应为 **SSE**（`text/event-stream`）。若一直 pending 后断开，检查 nginx 是否漏了 `proxy_buffering off` |
| 场景列表 500 | 说明 core 的构建产物没生成：`ls packages/a2ui-core/dist/mock`，缺了就重跑 `pnpm --filter a2ui-core build` |
| `pnpm install` 极慢 / 超时 | 国内机器默认打 `registry.npmjs.org` 会非常慢。腾讯云机器通常已配内网镜像（`mirrors.tencentyun.com`），也可手动：`pnpm config set registry https://registry.npmmirror.com`（**不要加 sudo**，pnpm 会拒绝写 root 全局配置） |
| 生成很慢/首字 3 秒 | 正常：`deepseek-flash` 默认开思考模式 |
| 端口占用 | `pm2 delete a2ui-server` 后重跑 deploy；或改 `deploy/ecosystem.config.cjs` 的 PORT |

## 为什么不把 `.env` 放进部署产物

仓库是公开的。Key 只存在服务器的 `server/a2ui-playground-server/.env`（已 gitignore、权限 600），
部署脚本不会读写它的内容，只判断是否存在。
