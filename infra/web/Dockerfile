# The YINGLONG web app (Next.js). Built with the public agent API baked in; served by `next start` on
# 127.0.0.1:3000 behind Caddy (app.yinglong-agent.tech). No third-party origin is contacted at runtime.
FROM node:24-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN npm i -g pnpm@12.11.2
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter web...
ARG NEXT_PUBLIC_AGENT_API=https://api.yinglong-agent.tech
ENV NEXT_PUBLIC_AGENT_API=$NEXT_PUBLIC_AGENT_API NODE_ENV=production
RUN pnpm --dir apps/web build && chown -R node:node /app/apps/web/.next
USER node
WORKDIR /app/apps/web
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "127.0.0.1"]
