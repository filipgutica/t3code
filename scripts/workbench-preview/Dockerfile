FROM node:24.13.1-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.10.0 opencode-ai@1.18.32
WORKDIR /app
COPY . .
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN pnpm --filter @t3tools/monorepo --filter t3... --filter @t3tools/scripts... install --frozen-lockfile
ENV T3_WORKBENCH_JIRA_BROKER_URL=https://workbench-auth.fgutica.workers.dev
RUN pnpm exec vp run --filter t3 build

FROM node:24.13.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/lib/node_modules/opencode-ai /usr/local/lib/node_modules/opencode-ai
RUN ln -s /usr/local/lib/node_modules/opencode-ai/bin/opencode.exe /usr/local/bin/opencode
WORKDIR /app
# The fixture builder imports workspace source; keep its installed dependency graph.
COPY --from=build /app /app
RUN install -d -o node -g node -m 700 /var/lib/workbench-preview && printf 'workbench-preview-v1\n' > /var/lib/workbench-preview/.workbench-preview-owned && chown node:node /var/lib/workbench-preview/.workbench-preview-owned
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "scripts/workbench-preview/start.mts"]
