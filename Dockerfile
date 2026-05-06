# syntax=docker/dockerfile:1.7

# ---- builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/evausesgit/notion-orchestrator"
LABEL org.opencontainers.image.description="Notion-driven task orchestrator"
LABEL org.opencontainers.image.licenses="Apache-2.0"

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        openssh-client \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -r runner \
 && useradd -r -g runner -m -d /home/runner runner \
 && mkdir -p /workspace \
 && chown runner:runner /workspace

WORKDIR /home/runner/app

COPY --from=builder --chown=runner:runner /app/node_modules ./node_modules
COPY --from=builder --chown=runner:runner /app/dist ./dist
COPY --from=builder --chown=runner:runner /app/package.json ./package.json

ENV NODE_ENV=production \
    LOG_FORMAT=json \
    PORT=3000 \
    WORKSPACE_DIR=/workspace

EXPOSE 3000
VOLUME ["/workspace"]
USER runner

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node /home/runner/app/dist/cli.js version >/dev/null || exit 1

ENTRYPOINT ["node", "/home/runner/app/dist/cli.js"]
CMD ["serve"]
