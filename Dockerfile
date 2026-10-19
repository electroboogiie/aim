# syntax=docker/dockerfile:1
# KP configurator: Node server + web app + Python KP generator (python-pptx, LibreOffice for PDF).
# Usage: docker compose up -d --build (docs/DEPLOY.md). Paths and env: docs/CONTRACTS.md §7, §9.

FROM node:22-bookworm-slim AS base
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
# The template is set in Arial: Liberation Sans is metric-compatible (and kpgen draws raster labels with
# LiberationSans-Bold.ttf), Carlito replaces Calibri, DejaVu covers any remaining glyphs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tzdata fontconfig \
      python3 python3-pip \
      libreoffice-impress \
      poppler-utils \
      fonts-liberation fonts-liberation2 fonts-crosextra-carlito fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f
RUN pip3 install --break-system-packages python-pptx pillow numpy

FROM base AS build
WORKDIR /src
COPY . .
RUN if [ -f package-lock.json ]; then npm ci --include=dev --no-audit --no-fund; \
    else npm install --include=dev --no-audit --no-fund; fi \
 && npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && python3 -m compileall -q generator/kpgen

FROM base
WORKDIR /app
# Application files stay root-owned (read-only for the service); only /data is writable.
COPY --from=build /src /app
ENV NODE_ENV=production \
    TZ=Europe/Kyiv \
    PORT=8080 \
    KP_DATA_DIR=/data \
    KP_CATALOG=/app/catalog/catalog.json \
    KP_GENERATOR_DIR=/app/generator \
    KP_PYTHON=python3 \
    KPGEN_BUILD=/data/kpgen-build
RUN mkdir -p /data \
 && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "build/server/src/main.js"]
