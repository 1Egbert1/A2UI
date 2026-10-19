# 部署说明（腾讯云 Lighthouse / 任意 Linux 单机）

两种方式，**默认走 docker compose**：

| 方式 | 适用 | 端口 | 章节 |
| --- | --- | --- | --- |
| **A. docker compose** | 线上在用；要跟其它服务共存 | 宿主 8080 / 8443（可改） | [下面](#方式-adocker-compose推荐) |
| B. 裸机 nginx + pm2 | 不能跑 Docker 的机器；或作为回退 | 宿主 80 / 443 | [见后文](#方式-b裸机-nginx--pm2如需回退或没有-docker) |

---

## 方式 A：docker compose（推荐）

### 拓扑

```
Internet :8080 / :8443          ← 刻意不占 80/443，留给后续服务或统一网关
   │
   ▼
┌──────────────── a2ui-web（nginx:alpine 容器）────────────────┐
│  8080 → 301 到 https（带 :8443）                              │
│  8443 → TLS 终止 + 静态 /usr/share/nginx/html                 │
│         /api/ → http://server:3000（compose 内网，按服务名）  │
└──────────────────────────┬───────────────────────────────────┘
                           │  a2ui 网络（bridge，server 不发布宿主端口）
                           ▼
              a2ui-server（node:22-alpine 容器，:3000）
                    └── 模型 Key 由 compose 的 environment 注入
```

两个镜像：`a2ui-web`（约 76 MB）和 `a2ui-server`（约 490 MB）。
把 Node 单独放一个容器、且**不发布宿主端口**，好处是 Node 进程彻底不出网，
nginx reload 也不会打断正在跑的 SSE 流。

### 一键启动

```bash
cd /opt/a2ui/deploy/docker
sudo cp .env.example .env
sudo vim .env          # 必改三项：A2UI_SERVER_NAME / A2UI_CERT_NAME / OPENAI_API_KEY
sudo bash up.sh        # build → up → 等 server healthy → 自检
```

`.env` 里跟端口有关的三行：

```ini
A2UI_HTTP_PORT=80          # 宿主 http（容器内固定 80）
A2UI_HTTPS_PORT=443        # 宿主 https（容器内固定 443）
A2UI_SERVER_NAME="_"       # 用域名就填 "example.com www.example.com _"
A2UI_CERT_NAME=82.156.76.114   # /etc/letsencrypt/live 下的目录名
```

端口选法见下一节（选 8080/8443 就一定要先放通防火墙）。当前线上用的是 **80/443 + IP 证书**：
域名未备案、被网关拦，只能靠 IP 访问。

### 端口怎么选（这一步最容易把站点搞挂）

```yaml
ports:
  - "${A2UI_HTTP_PORT:-8080}:80"
  - "${A2UI_HTTPS_PORT:-8443}:443"
```

左边是宿主、右边是容器，改端口只动 `.env`，不用碰 compose 文件也不用重建镜像。

| 选法 | 好处 | 代价 |
| --- | --- | --- |
| `8080 / 8443`（不占默认端口） | 80/443 留给后续服务或统一网关 | **必须先去 Lighthouse 控制台放通 8080、8443** |
| `80 / 443` | 云主机默认就开着，迁移零等待 | 占了默认端口 |

> **真实事故（2026-10-19）**：容器绑的是 8080/8443，防火墙只开了 80/443，
> 而 `retire-legacy.sh` 当时只验了 `127.0.0.1:8443`（容器活着 → 通过），
> 旧 nginx 一停，站点就从公网消失了。现在脚本加了一段**公网自检**：
> 用 hairpin 回环打 `https://<公网IP>:<端口>/`，不通就拒绝执行并给出两条出路。
> 教训是：**云防火墙在实例外面，只有打到公网地址才验得到。**

### 证书续期用的 webroot

容器占着 80 时 `--standalone` 抢不到端口，所以 `renew-cert.sh` 会退回 webroot 方式，
写文件到宿主 `/var/www/a2ui-acme`（`A2UI_ACME_DIR`），容器把它只读挂在 `/var/www/acme`，
由 nginx 的 `/.well-known/acme-challenge/` 吐出去。**改过 ACME 目录就要同步改
`/etc/letsencrypt/renewal/<证书名>.conf` 里的 `webroot_path`**，否则续期会 404。

### 证书：整棵 `/etc/letsencrypt` 挂进去

```yaml
volumes:
  - "${A2UI_CERT_ROOT:-/etc/letsencrypt}:/etc/letsencrypt:ro"
```

**别只挂 `live/<域名>`**：那个目录里全是软链（`fullchain.pem -> ../../archive/.../fullchain1.pem`），
单独挂进去就是一堆断链，表现为「明明有证书，容器却降级成了 HTTP-only」。这个坑踩过。

容器启动时 `entrypoint.d/10-a2ui-conf.sh` 会做一次判断：

- `live/<A2UI_CERT_NAME>/fullchain.pem` 在 → 用 TLS 模板（80 跳转 + 443 站点）
- 不在 → 用 HTTP-only 模板，站点照样能跑

所以**没证书也能 `up`**，拿到证书后重启 web 容器即自动切换。

### 更新

```bash
# 代码同步到 /opt/a2ui 之后
cd /opt/a2ui/deploy/docker && sudo bash up.sh
```

`up.sh` 是幂等的（`build` + `up -d`），改了源码就重建镜像；只改 `.env` 不必重建，
`docker compose up -d` 会带着新环境变量重建容器。

### 证书续期（容器化后要换姿势）

以前宿主 nginx 占着 80，certbot 走 `--webroot` 把校验文件写到 `/var/www/a2ui` 就行。
现在站点在容器里、宿主 80 空着，所以改用 `--standalone`：

```bash
sudo bash /opt/a2ui/deploy/docker/renew-cert.sh --dry-run   # 演练
sudo bash /opt/a2ui/deploy/docker/renew-cert.sh             # 真续
```

续完会自动 `docker compose exec -T web nginx -s reload`（证书是挂载进去的，
但 nginx 只在启动时读一次，不 reload 不生效）。

`certbot.timer` 每天跑两次，它的 `certbot.service` 已被覆盖成调用上面这个脚本，
见 `/etc/systemd/system/certbot.service.d/use-venv.conf`。

> 将来如果有网关占了 80，`--standalone` 会起不来 —— 那时让网关把
> `/.well-known/acme-challenge/` 代理到本栈的 8080，或者改用 DNS-01。

### 从裸机方式迁过来 / 回退

容器跑通之后再下线旧的一套（脚本会自动做两段自检：本机 127.0.0.1，以及**公网 IP + 端口**；
公网那段不通会直接拒绝执行，避免重演“旧的停了、新的外面进不来”）：

```bash
sudo bash /opt/a2ui/deploy/docker/retire-legacy.sh
```

它只 `disable` 不删东西：nginx 的包和站点配置都留着，pm2 的进程定义也留着。
回退命令脚本末尾会打印（本质是 `systemctl enable --now nginx` + `pm2 start deploy/ecosystem.config.cjs`）。

---

## 方式 B：裸机 nginx + pm2（如需回退，或没有 Docker）

### 拓扑

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
| Docker | 24+ / compose v2 | 方式 A 需要：`apt install docker.io docker-compose-v2` |
| Node | **>= 22**（`engines` 要求） | 方式 B 需要；方式 A 在镜像里装 |
| pnpm | 9+ | 同上 |
| nginx / pm2 | 任意 | 仅方式 B |
| 端口 | A：**8080/8443**；B：**80/443** | Lighthouse 控制台 → 防火墙需放通 |
| 磁盘 | ≥ 2 GB | 镜像另需约 600 MB |

> 国内机器拉镜像会超时（`dial tcp ...:443: i/o timeout`）。先配镜像加速：
> ```bash
> sudo tee /etc/docker/daemon.json <<'EOF'
> { "registry-mirrors": ["https://mirror.ccs.tencentyun.com"] }
> EOF
> sudo systemctl restart docker
> ```
> 构建时再从 `.env` 里把 `NPM_REGISTRY` 指到国内源（`deploy/docker/.env.example` 里有）。

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
# A. 有域名（推荐）——主域 + www 放一张证书里
sudo bash /opt/a2ui/deploy/setup-tls.sh --domain yakult.work,www.yakult.work --email me@example.com

# B. 只有公网 IP（无域名 / 域名没备案）
sudo bash /opt/a2ui/deploy/setup-tls.sh --ip 82.156.76.114

# 防火墙还没放通 443 时先只签证书，站点继续走 80
sudo bash /opt/a2ui/deploy/setup-tls.sh --domain yakult.work --soft
```

脚本做四件事：`certbot` 签证书（webroot，不停服务）→ 渲染 `nginx.tls.conf`（80 只留 ACME 校验
+ 跳转、站点搬进 443）→ 自检 → 配好自动续期。**不会覆盖 `deploy/nginx.conf`**，
`bootstrap.sh` 重跑也只会写回 HTTP 版，TLS 版由这个脚本独占。

域名模式下 80 的 301 用的是**固定主域**（`__CANONICAL__`），所以 `http://<IP>/` 也会被并到
`https://<主域>/`，不会出现「拿域名证书访问 IP 地址」的证书告警。

### 境内服务器 + 没备案域名的坑（务必先看）

境内实例对**未备案域名**的请求会在网关层被拦掉：任何 HTTP 请求只要 `Host` 是没备案的域名，
都会被 `302` 到 `https://dnspod.qcloud.com/static/webblock.html?d=<域名>`。

```
$ curl -sv -H "Host: 82-156-76-114.sslip.io" http://82.156.76.114/
< HTTP/1.1 302 OK
< Location: https://dnspod.qcloud.com/static/webblock.html?d=82-156-76-114.sslip.io
```

对比同一台机器上的实测（`yakult.work` 正常返回站点，临时域名被拦）：

| Host | 结果 |
| --- | --- |
| `yakult.work` | `200`，直接是本机 nginx |
| `82-156-76-114.sslip.io` | `302` → dnspod webblock 页 |
| `82.156.76.114`（裸 IP） | `200`，不受影响 |

后果是：**Let's Encrypt 的 HTTP-01 校验请求也会被拦到那个页面上**，所以临时域名方案
（`sslip.io` / `nip.io` 之类）在境内机器上签不出证书，必然报
`Invalid response from https://dnspod.qcloud.com/static/webblock.html?...`。
判断办法很简单：`curl -sI -H "Host: <域名>" http://<IP>/`，看是不是 302 到 webblock。

裸 IP 访问不受这条限制，而 Let's Encrypt 已经能签 **IP 证书**，所以既没域名也没备案时，
`--ip` 模式就是对 IP 签一张——这是唯一能拿到「浏览器不报警」的证书的路子。

IP 证书有两个约束：

- **IP 证书是 shortlived profile，只有 7 天有效期**。续期靠 `certbot.timer`，
  并且必须用 certbot >= 5（`--ip-address` + `--required-profile` 才支持 IP）。
  apt 源里的 2.9 不支持，所以脚本会在 `/opt/certbot-venv` 装一份独立的新版，
  同时把 `certbot.service` 的 `ExecStart` 覆盖成 venv 里的二进制，并删掉 apt 的
  `/etc/cron.d/certbot`（否则它每天用旧版跑一次、报错刷日志）。
- **IP 证书绑死 IP**：换个 IP 就作废。所以一旦有了域名，就改用 `--domain` 重签
  （域名证书 90 天，续期负担小得多）。

### 443 必须放通

`setup-tls.sh` 的自检是在**实例内部**打的 `127.0.0.1:443`，通了不代表公网通——
Lighthouse 的防火墙在实例外面。上线后立刻从外部验一次：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://yakult.work/
```

判断端口到底是「被防火墙丢了」还是「没程序监听」，用 TCP 探一下就有结论：

| 现象 | 含义 |
| --- | --- |
| 连接超时 （丢包） | 防火墙没放通 |
| 立即 `Connection refused`（RST） | 防火墙已放通，只是 nginx 没监听 443 |

超时就到 **Lighthouse 控制台 → 防火墙 → 放通 TCP:443**（80 要留着，ACME 续期走 80）。
从放通到生效前，站点会因为 80 已跳转而打不开，先回滚：

```bash
sudo cp /etc/nginx/sites-available/a2ui.http.bak /etc/nginx/sites-available/a2ui
sudo nginx -t && sudo systemctl reload nginx
```

### 续期检查

```bash
/opt/certbot-venv/bin/certbot renew --dry-run   # 域名/IP 两种证书都归它管
systemctl list-timers certbot.timer
```

`certbot.service` 带了 `--deploy-hook "systemctl reload nginx"`，续期成功会自动 reload，
不需要手动重启。

## 排障

| 现象 | 排查 |
|---|---|
| **`docker compose build` 卡在 `failed to resolve source metadata` / i/o timeout** | 拉不到 Docker Hub。配镜像加速（见上文 daemon.json），`systemctl restart docker` 后重试 |
| **日志说「未找到证书 → HTTP-only 模式」，但宿主上证书明明在** | 只挂了 `live/<域名>` 目录。那里全是软链，必须整棵挂 `/etc/letsencrypt`（见上文） |
| 换了证书/域名，容器里还是旧的 | nginx 只在启动时读证书与配置：`docker compose restart web`（续期脚本已自动 reload） |
| 宿主 curl 通、公网打不开 8080/8443 | Lighthouse 控制台 → 防火墙放通对应 TCP 端口；用 TCP 探针区分「被丢包（超时）」与「没监听（RST）」 |
| **域名 http 能开、https 打不开** | 按顺序查三件：① `sudo ss -lntp \| grep :443` 有没有监听；② TCP 探 443 是超时还是 RST（见上表）；③ `openssl x509 -in /etc/letsencrypt/live/<域名>/fullchain.pem -noout -enddate` 证书在不在。三样都对还打不开，才看浏览器报的错 |
| 打开是 502 | `pm2 logs a2ui-server` / `docker compose logs server`；确认 `dist/index.js` 存在、模型 Key 已注入 |
| **`/api` 返回 404 且响应头是 `Server: Caddy`** | **80 被镜像预装的 Caddy 占了**，nginx 根本没起来（`systemctl status nginx` 会显示 `bind() 98: Address already in use`）。`sudo systemctl disable --now caddy && sudo systemctl start nginx`。恢复 Caddy：`sudo systemctl enable --now caddy` |
| 页面能开但生成无反应 | 浏览器 Network 看 `/api/a2ui/run`：应为 **SSE**（`text/event-stream`）。若一直 pending 后断开，检查 nginx 是否漏了 `proxy_buffering off` |
| 场景列表 500 | 说明 core 的构建产物没生成：`ls packages/a2ui-core/dist/mock`，缺了就重跑 `pnpm --filter a2ui-core build` |
| `pnpm install` 极慢 / 超时 | 国内机器默认打 `registry.npmjs.org` 会非常慢。腾讯云机器通常已配内网镜像（`mirrors.tencentyun.com`），也可手动：`pnpm config set registry https://registry.npmmirror.com`（**不要加 sudo**，pnpm 会拒绝写 root 全局配置） |
| 生成很慢/首字 3 秒 | 正常：`deepseek-flash` 默认开思考模式 |
| 端口占用 | `pm2 delete a2ui-server` 后重跑 deploy；或改 `deploy/ecosystem.config.cjs` 的 PORT |

## 为什么不把 `.env` 放进部署产物

仓库是公开的。Key 只存在服务器的 `server/a2ui-playground-server/.env`（已 gitignore、权限 600），
部署脚本不会读写它的内容，只判断是否存在。
