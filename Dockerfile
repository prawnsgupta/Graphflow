# GraphFlow image — one image, two processes:
#   web:     node server.js                (Next.js standalone server)
#   worker:  npx tsx src/workers/index.ts  (BullMQ worker + maintenance)
#   migrate: npx prisma migrate deploy
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS builder
COPY . .
# Build-time placeholders only; real values are injected at runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    MIGRATION_DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    SESSION_SECRET="build-time-placeholder-secret-not-used-at-runtime"
RUN npx prisma generate && npm run build

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 graphflow && useradd --system --uid 1001 --gid graphflow graphflow
# Full dependencies (worker runs TypeScript via tsx; migrations need the Prisma CLI)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/tsconfig.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
# Next.js standalone server + static assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER graphflow
EXPOSE 3000 9100
CMD ["node", "server.js"]
