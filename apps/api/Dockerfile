# API image. Build context = repository root (Railway: leave "Root Directory" empty).
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.14.0
WORKDIR /app

# Install dependencies first so Docker can cache this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY prisma prisma
COPY prisma.config.ts ./
COPY apps/api apps/api
RUN pnpm prisma generate

ENV NODE_ENV=production
WORKDIR /app/apps/api
# On every start: apply pending migrations, load the demo data only if the database is empty, then run the API.
CMD ["sh", "-c", "cd /app && pnpm prisma migrate deploy && SEED_ONLY_IF_EMPTY=true pnpm prisma db seed && cd apps/api && node -r @swc-node/register src/main.ts"]
