# Panel image. Build context = repository root (Railway: leave "Root Directory" empty).
FROM node:24-slim
RUN npm install -g pnpm@12.14.0
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
# The browser talks to /api on the panel's own address; the panel forwards it to the API at runtime.
ENV NEXT_PUBLIC_API_URL=/api
RUN pnpm --filter web build

ENV NODE_ENV=production
WORKDIR /app/apps/web
CMD ["pnpm", "start"]
