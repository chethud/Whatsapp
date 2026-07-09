FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY package-lock.json package-lock.json
RUN npm ci

COPY . .
RUN npm run prisma:generate --workspace @whatsapp/api
RUN npm run build --workspace @whatsapp/shared
RUN npm run build --workspace @whatsapp/api

FROM node:22-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN npm ci --omit=dev

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

RUN npm run prisma:generate --workspace @whatsapp/api \
  && node -e "const fs=require('fs');const path='packages/shared/package.json';const pkg=JSON.parse(fs.readFileSync(path));pkg.main='dist/index.js';pkg.types='dist/index.d.ts';fs.writeFileSync(path,JSON.stringify(pkg,null,2));"

EXPOSE 10000

CMD ["sh", "-c", "npm run prisma:migrate:deploy --workspace @whatsapp/api && node apps/api/dist/server.js"]
