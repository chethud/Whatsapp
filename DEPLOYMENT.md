# Deployment Guide

Host the **API on Render** and the **frontend on Vercel**.

## Architecture

| Service | Platform | URL example |
|---------|----------|-------------|
| Frontend | Vercel | `https://your-app.vercel.app` |
| API | Render (Docker) | `https://whatsapp-api.onrender.com` |
| Database | Render PostgreSQL | internal connection string |

---

## 1. Backend on Render

### Option A: Blueprint (recommended)

1. Push this repo to GitHub.
2. Open [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**.
3. Connect `chethud/Whatsapp` and apply `render.yaml`.
4. Set these env vars manually after deploy:
   - `APP_ORIGIN` = your Vercel URL (e.g. `https://your-app.vercel.app`)
   - `ALLOWED_ORIGINS` = same Vercel URL (comma-separated if you have preview URLs too)
   - `OPENAI_API_KEY` / `GEMINI_API_KEY` (optional, for AI features)

### Option B: Manual web service

1. **New** → **Web Service** → connect GitHub repo.
2. Settings:
   - **Runtime:** Docker
   - **Dockerfile path:** `apps/api/Dockerfile`
   - **Docker context:** `.` (repo root)
   - **Health check path:** `/health`
3. Create a **PostgreSQL** database and attach `DATABASE_URL`.
4. Environment variables:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DATABASE_URL` | from Render Postgres |
| `APP_ORIGIN` | `https://your-app.vercel.app` |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` |
| `JWT_ACCESS_SECRET` | long random string (32+ chars) |
| `JWT_REFRESH_SECRET` | long random string (32+ chars) |
| `CSRF_SECRET` | long random string |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` |
| `REDIS_URL` | leave empty (optional) |

5. Deploy. Migrations run automatically on startup.

### After API deploy

- Health: `https://your-api.onrender.com/health`
- Swagger: `https://your-api.onrender.com/docs`
- Seed admin (one-time, from Render shell or locally with production `DATABASE_URL`):
  ```bash
  npm run prisma:seed --workspace @whatsapp/api
  ```

---

## 2. Frontend on Vercel

1. Open [Vercel Dashboard](https://vercel.com) → **Add New Project** → import `chethud/Whatsapp`.
2. Configure:
   - **Root Directory:** `apps/web`
   - **Framework:** Next.js (auto-detected)
   - `vercel.json` in `apps/web` handles monorepo install/build
3. Environment variables:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_BASE_URL` | `https://your-api.onrender.com` |

4. Deploy.

### Vercel preview URLs

If you use preview deployments, add each preview origin to Render:

```
ALLOWED_ORIGINS=https://your-app.vercel.app,https://your-app-git-main.vercel.app
```

---

## 3. Wire them together

1. Deploy **Render API** first → copy the URL.
2. Set Vercel `NEXT_PUBLIC_API_BASE_URL` to that URL.
3. Set Render `APP_ORIGIN` and `ALLOWED_ORIGINS` to your Vercel URL.
4. Redeploy both if needed.

---

## Important notes

### WhatsApp sessions on Render

- The API uses **Docker + Chromium** for QR pairing (`whatsapp-web.js`).
- Render **free** tier spins down after inactivity; WhatsApp sessions may disconnect.
- Use a **paid** Render instance for more reliable always-on WhatsApp connections.
- Session auth data is stored on ephemeral disk; redeploys may require re-scanning QR.

### Redis

Redis is optional. The API runs without it (cache warnings only).

### CORS & auth

Production is configured for **cross-origin** hosting:
- CORS allows your Vercel origin
- Cookies use `SameSite=None; Secure` for CSRF across domains
- Auth tokens are stored in `localStorage` on the frontend

### Default login (after seed)

- Email: `admin@example.com`
- Password: `ChangeMe123!`

Change this password immediately in production.
