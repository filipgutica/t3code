FROM node:24.13.1-bookworm-slim AS github-cli
ARG TARGETARCH
# Digests verified against cli/cli v2.101.0 release metadata and its checksums asset.
RUN case "$TARGETARCH" in \
      amd64) GH_SHA256=9bca2d1c16825f109907a23307628a2f0698fbf99662b73a5cf0b020293072b8 ;; \
      arm64) GH_SHA256=b57e8063f18862647c9d22727c32e9da1b963f8bf9db648fe123a6975695640f ;; \
      *) exit 1 ;; \
    esac && \
    node -e 'const fs=require("node:fs");const crypto=require("node:crypto");(async()=>{const [arch,checksum]=process.argv.slice(1);const response=await fetch(`https://github.com/cli/cli/releases/download/v2.101.0/gh_2.101.0_linux_${arch}.tar.gz`,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error("GitHub CLI download failed");const archive=Buffer.from(await response.arrayBuffer());if(crypto.createHash("sha256").update(archive).digest("hex")!==checksum)throw Error("GitHub CLI checksum mismatch");fs.writeFileSync("/tmp/gh.tar.gz",archive);})().catch(()=>process.exit(1));' "$TARGETARCH" "$GH_SHA256" && \
    tar -xzf /tmp/gh.tar.gz -C /usr/local/bin --strip-components=2 "gh_2.101.0_linux_${TARGETARCH}/bin/gh" && \
    gh --version

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
COPY --from=github-cli /usr/local/bin/gh /usr/local/bin/gh
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
