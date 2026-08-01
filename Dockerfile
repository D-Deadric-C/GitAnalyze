# Next.js app for Cloud Run.
#
# Build:  docker build -t gitpulse-web .
# Run:    docker run -p 8080:8080 --env-file .env gitpulse-web
#
# The build runs without a reachable database: `prisma generate` needs no
# connection, and the blog routes degrade to empty when Postgres is absent
# (see getPublishedPostsSafe), then refresh via ISR once the app is running.

# ---- deps -------------------------------------------------------------------
FROM node:24-slim AS deps
WORKDIR /app

# Prisma's engine downloader and npm over HTTPS both need CA certificates.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Install scripts are required here so Prisma engines and sharp's binaries land.
RUN npm ci

# ---- builder ----------------------------------------------------------------
FROM node:24-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Prisma refuses to construct a client without a syntactically valid datasource
# URL, and prerendering imports it. This placeholder is never connected to and is
# never carried into the runner stage; the real URL is injected at runtime.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    DIRECT_URL="postgresql://build:build@127.0.0.1:5432/build"

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so they
# must be passed as build args rather than runtime env vars.
ARG NEXT_PUBLIC_APP_URL=""
ARG NEXT_PUBLIC_ADSENSE_CLIENT_ID=""
ARG NEXT_PUBLIC_ADSENSE_SLOT_HOMEPAGE=""
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_ADSENSE_CLIENT_ID=$NEXT_PUBLIC_ADSENSE_CLIENT_ID \
    NEXT_PUBLIC_ADSENSE_SLOT_HOMEPAGE=$NEXT_PUBLIC_ADSENSE_SLOT_HOMEPAGE

RUN npx prisma generate && npx next build

# ---- runner -----------------------------------------------------------------
FROM node:24-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# public/ holds the PWA service worker emitted during the build, so copy it from
# the builder rather than the source tree.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrations are applied by a separate Cloud Run job, not on container start,
# so concurrent instances cannot race each other.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs

# Cloud Run injects PORT and routes to it; 8080 is its default.
ENV PORT=8080 HOSTNAME=0.0.0.0
EXPOSE 8080

CMD ["node", "server.js"]
