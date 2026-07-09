# WhatsApp Core Platform

Production-focused monorepo for multi-session WhatsApp Web automation, inbox operations, AI-assisted replies, contacts, RBAC, REST APIs, WebSockets, and a Next.js SaaS dashboard.

## Stack

- `apps/api`: Express, TypeScript, Prisma, PostgreSQL, Redis, Socket.IO, Winston, Zod, JWT, `whatsapp-web.js`
- `apps/web`: Next.js App Router, TypeScript, Tailwind CSS, React Query, Zustand, dark-mode dashboard UI
- `packages/shared`: shared schemas, DTOs, roles, navigation, and API contracts
- `packages/ui`: shared UI utilities

## Quick start

1. Copy `.env.example` to `.env` and fill in secrets.
2. Start infrastructure:

```bash
docker compose up -d postgres redis
```

3. Install dependencies:

```bash
npm install
```

4. Generate Prisma client and run migrations:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

5. Start the platform:

```bash
npm run dev
```

Frontend runs on [http://localhost:3000](http://localhost:3000) and the API runs on [http://localhost:4000](http://localhost:4000).

## Seeded credentials

- Email: `admin@example.com`
- Password: `ChangeMe123!`

Change the seeded password immediately in a real deployment.

## Core modules in this delivery

- Authentication with JWT access tokens and refresh token rotation
- Role-aware user management
- Multi-session WhatsApp QR pairing and lifecycle management
- Chat and message persistence
- Contact management with tags, labels, notes, and lead scoring
- AI prompt templates, knowledge base documents, and reply generation
- Dashboard metrics, logs, settings, and notifications
- Swagger UI at `/docs`

## Notes

- `whatsapp-web.js` capabilities vary by WhatsApp Web support. Unsupported actions should be guarded at the route or service layer before exposing them in UI workflows.
- One-time scheduled messages are persisted and marked as scheduled, then dispatched by the running API process when their in-memory timers elapse.
- The AI provider abstraction supports OpenAI-compatible chat completion APIs today and is structured to add Gemini-compatible adapters next.
