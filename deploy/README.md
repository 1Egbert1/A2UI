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
Internet :80 / :443
   │
   ▼
┌──────── a2ui-gateway（caddy:2-alpine，唯一占 80/443 的进程）────────┐
│  :80  → 308 跳 https                                                │
│  :443 → TLS 终止（复用宿主 /etc/letsencrypt 里的证书）              │
│         reverse_proxy web:80  (flush_interval -1，SSE 不缓冲)        │
│  以后加服务：再来一段 reverse_proxy host.docker.internal:8081         │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  a2ui 网络（bridge）
                           ▼
┌──────── a2ui-web（nginx:alpine，纯 HTTP，只绑 127.0.0.1:8080）──────┐
│  /      → /usr/share/nginx/html（playground 的 vite 产物）           │
│  /api/  → http://server:3000                                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
              a2ui-server（node:22-alpine，:3000，不发布宿主端口）
                    └── 模型 Key 由 compose 的 environment 注入
```

三个容器、两个镜像（`a2ui-web` 约 76 MB、`a2ui-server` 约 490 MB）。

关键是**端口所有权**：80/443 只归 gateway 一个进程，a2ui 自己退到宿主回环
`127.0.0.1:8080`。这样再加多少服务都不会撞端口，也不用每加一个就开一条防火墙规则 ——
外部流量一律从网关进来。Node 更是完全不发布宿主端口，只剩内网可达。

### 一键启动

```bash
cd /opt/a2ui/deploy/docker
sudo cp .env.example .env
sudo vim .env          # 必改：A2UI_CERT_NAME（/etc/letsencrypt/live 下的目录名）、OPENAI_API_KEY
sudo bash up.sh        # build → up → 等 server healthy → 自检
```

`.env` 里跟端口/证书有关的几行：

```ini
A2UI_HTTP_PORT=80              # 网关占的宿主 http
A2UI_HTTPS_PORT=443            # 网关占的宿主 https
A2UI_WEB_BIND=127.0.0.1:8080   # a2ui web 只绑回环
A2UI_CERT_NAME=yakult.work      # /etc/letsencrypt/live 下的目录名（网关用它终止 TLS）
```

端口怎么分配见下一节。当前线上是 **80/443（网关）+ 127.0.0.1:8080（a2ui）+ 域名证书**
（`yakult.work` / `www`，访问入口 <https://yakult.work/>）。

> 曾经因为域名被备案网关拦截，线上临时改用 **IP 证书**（`A2UI_CERT_NAME=82.156.76.114`）访问。
> 那条路现在不建议走：IP 证书是 Let's Encrypt 的 7 天短效证书，续期依赖 `certbot.timer`，
> 一旦没续上就是全站证书过期（当前就是过期状态）。**只要域名可用，就配域名证书。**

### 端口所有权：80/443 只给网关

```yaml
# gateway —— 唯一占默认端口的东西
ports: ["${A2UI_HTTP_PORT:-80}:80", "${A2UI_HTTPS_PORT:-443}:443"]

# web —— 只绑宿主回环，外界碰不到
ports: ["${A2UI_WEB_BIND:-127.0.0.1:8080}:80"]
```

`127.0.0.1:` 这个前缀别省。少了它就等于绑 `0.0.0.0`，又回到「一个端口只能一个进程」的老问题。

### 加一个新服务

不用动 a2ui 的任何配置，两步：

```bash
# 1) 新服务只绑回环（示例：宿主 8081）
ports: ["127.0.0.1:8081:80"]
```

```
# 2) 在 deploy/docker/caddy/Caddyfile 里加一段（按路径或按域名）
handle_path /other/* {
	reverse_proxy host.docker.internal:8081
}
# 或者
other.example.com {
	reverse_proxy host.docker.internal:8081
}
```

改完 `docker compose exec gateway caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`
（无中断），不用开新的防火墙端口。`host.docker.internal` 已通过 `extra_hosts: host-gateway`
指向宿主（实测解析到 `172.17.0.1`）。

> **真实事故（2026-10-19）**：在还没有网关的时候，容器直接绑 8080/8443，
> 而防火墙只开了 80/443；`retire-legacy.sh` 又只验了 `127.0.0.1:8443`（容器活着 → 通过），
> 旧 nginx 一停，站点就从公网消失了。现在脚本加了一段**公网自检**：
> 用 hairpin 回环打 `https://<公网IP>:<端口>/`，不通就拒绝执行。
> 教训：**云防火墙在实例外面，只有打到公网地址才验得到。**

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

网关里其实有**两个站点块**：

- `:443`（兜底）→ 用 IP 证书，管 `https://<IP>/` 这类直连
- `https://yakult.work, https://www.yakult.work` → 用域名证书，**已经配好了**，
  但域名未备案，公网进不来（本机 `curl --resolve yakult.work:443:127.0.0.1` 是 200，
  证明服务端没问题，卡在网络层）。备案通过后把该块的 `tls` 行删掉，Caddy 就自动申证书+续期。

现在**证书给网关用**（Caddyfile 里 `tls /etc/letsencrypt/live/{$A2UI_CERT_NAME}/...`），
a2ui 的 web 容器故意不挂证书、只跑纯 HTTP —— 它要是也启 TLS 就会去抢 443，和网关打架。

web 容器启动时 `entrypoint.d/10-a2ui-conf.sh` 仍会按证书有无选模板，所以**没有证书也能 `up`**
（走 HTTP-only）；拿到证书后重启容器即自动切换。

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

续完会自动调 `deploy/docker/reload-edge.sh`：优先 `caddy reload`（无中断），
没有网关时退回 `nginx -s reload`。证书是挂载进去的，但进程只在启动时读一次，不 reload 不生效。

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

# B. 只有公网 IP（无域名 / 域名走不通）—— 7 天短效证书，续期断了就全站过期，仅作临时兜底
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
| 换了证书/域名，容器里还是旧的 | 边缘进程只在启动/ reload 时读证书：`docker compose restart gateway`（续期脚本会自动 `caddy reload`） |
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
