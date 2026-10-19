# A2UI 的镜像构建。三个 stage，两个产物：
#
#   builder  pnpm 装依赖 + 全量构建（core / vue / web / server 都要，web 的产物依赖 core 源码）
#   web      nginx + 前端静态产物 + 反代配置（对外只暴露这一个）
#   server   Node + 编译产物 + 生产依赖（只在 compose 内网里被 web 访问）
#
# 之所以 web / server 分成两个镜像而不是塞一个容器：
#   - 各司其职，nginx reload 不影响 Node，Node 重启不影响静态服务；
#   - 端口语义清晰：宿主只发布 web 的端口，Node 不出网。
#
# 用法（一般在 deploy/docker/docker-compose.yml 里被调用，不手动 build）：
#   docker build -f deploy/docker/Dockerfile --target web    -t a2ui-web    .
#   docker build -f deploy/docker/Dockerfile --target server -t a2ui-server .

# syntax=docker/dockerfile:1

# ---------------- builder ----------------
FROM node:22-alpine AS builder
WORKDIR /app

# 国内机器直连 registry.npmjs.org 会非常慢，构建时用 build-arg 换镜像源：
#   --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG PNPM_VERSION=12.10.1

RUN npm i -g "pnpm@${PNPM_VERSION}" --registry="${NPM_REGISTRY}" \
 && pnpm config set registry "${NPM_REGISTRY}"

# 先只拷 lockfile 和各个 package.json：源码变了不会让依赖层失效，能复用缓存
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/a2ui-core/package.json              packages/a2ui-core/
COPY packages/a2ui-vue/package.json               packages/a2ui-vue/
COPY web/a2ui-playground/package.json             web/a2ui-playground/
COPY server/a2ui-playground-server/package.json   server/a2ui-playground-server/
RUN pnpm install --frozen-lockfile

COPY . .

# 前端要和后端同域：把后端地址置空 → 请求走 /api/... 相对路径，由 nginx 反代。
# 必须用空串（源码里是 ?? 而不是 ||），否则会被顶回 localhost:3000。
ENV VITE_A2UI_SERVER=''
# 2C2G 的机器上并行构建容易 OOM，收一收堆上限
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN pnpm -r build

# ---------------- web ----------------
FROM nginx:1.27-alpine AS web

# 前端产物（index.html + assets）
COPY --from=builder /app/web/a2ui-playground/dist /usr/share/nginx/html

# 配置模板与启动钩子；真正的 server 段由 docker-entrypoint.d 里的脚本按「有没有证书」生成
COPY deploy/docker/nginx/ /opt/a2ui/nginx/
COPY deploy/docker/entrypoint.d/10-a2ui-conf.sh /docker-entrypoint.d/10-a2ui-conf.sh
RUN chmod +x /docker-entrypoint.d/10-a2ui-conf.sh

# 容器内固定 80/443，宿主端口由 compose 决定（默认 8080/8443）
EXPOSE 80 443

# ---------------- server ----------------
FROM node:22-alpine AS server
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# nodeLinker=hoisted，依赖是平的，整份 node_modules 拷过来即可（含 devDeps，省得再算一遍生产子集）
COPY --from=builder /app/node_modules ./node_modules

# 服务端会以 `../../../packages/a2ui-core/dist/mock` 的相对路径读场景数据（见 src/scenarios.ts），
# 所以目录层级必须和仓库里一致，不能把 dist 平铺。
COPY --from=builder /app/packages/a2ui-core/dist ./packages/a2ui-core/dist
COPY --from=builder /app/server/a2ui-playground-server/dist ./server/a2ui-playground-server/dist
COPY --from=builder /app/server/a2ui-playground-server/package.json ./server/a2ui-playground-server/package.json

# 配置（模型 Key 等）通过环境变量注入，见 deploy/docker/docker-compose.yml
WORKDIR /app/server/a2ui-playground-server
EXPOSE 3000
CMD ["node", "dist/index.js"]
