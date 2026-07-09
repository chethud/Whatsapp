import cookieParser from "cookie-parser";
import cors from "cors";
import csurf from "csurf";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";

import { env } from "./config/env.js";
import { getAllowedOrigins, getCookieSameSite } from "./config/cors.js";
import { swaggerDocument } from "./config/swagger.js";
import { errorHandler, notFound } from "./middleware/error-handler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { sessionsRouter } from "./modules/whatsapp-sessions/sessions.routes.js";
import { chatsRouter } from "./modules/chats/chats.routes.js";
import { messagesRouter } from "./modules/messages/messages.routes.js";
import { contactsRouter } from "./modules/contacts/contacts.routes.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { settingsRouter } from "./modules/settings/settings.routes.js";
import { logsRouter } from "./modules/logs/logs.routes.js";
import { notificationsRouter } from "./modules/notifications/notifications.routes.js";

export function createApp() {
  const app = express();

  if (env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  const allowedOrigins = getAllowedOrigins();

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  );
  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: "10mb" }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    csurf({
      cookie: {
        httpOnly: true,
        sameSite: getCookieSameSite(),
        secure: env.NODE_ENV === "production",
      },
      ignoreMethods: ["GET", "HEAD", "OPTIONS"],
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ success: true, data: { status: "ok" } });
  });

  app.get("/csrf-token", (req, res) => {
    res.json({ success: true, data: { csrfToken: req.csrfToken() } });
  });

  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/sessions", sessionsRouter);
  app.use("/api/v1/chats", chatsRouter);
  app.use("/api/v1/messages", messagesRouter);
  app.use("/api/v1/contacts", contactsRouter);
  app.use("/api/v1/ai", aiRouter);
  app.use("/api/v1/dashboard", dashboardRouter);
  app.use("/api/v1/settings", settingsRouter);
  app.use("/api/v1/logs", logsRouter);
  app.use("/api/v1/notifications", notificationsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
