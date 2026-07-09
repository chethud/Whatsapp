FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY package-lock.json package-lock.json
RUN npm ci

COPY . .
RUN npm run build --workspace @whatsapp/shared
RUN npm run build --workspace @whatsapp/ui
RUN npm run build --workspace @whatsapp/web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web ./apps/web
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/ui ./packages/ui

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npm", "run", "start"]
