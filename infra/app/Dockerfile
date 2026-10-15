# One image for every YINGLONG Node service (agent, signer, services, indexer, ecny-sim).
# The command is chosen per service in compose.yaml. TypeScript runs through tsx (no build step).
FROM node:24-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN npm i -g pnpm@12.11.2 && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/agent ./apps/agent
COPY apps/signer ./apps/signer
COPY contracts/deployments ./contracts/deployments
RUN pnpm install --frozen-lockfile --prod=false --filter @yinglong/agent... --filter @yinglong/signer...
ENV YINGLONG_ROOT=/app YINGLONG_SECRETS=/run/secrets/testnet-keys.json
USER node
