import { createServer, type Server as HttpServer } from "http";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";
import { whatsappSessionRegistry } from "./lib/whatsapp/session-registry.js";
import { createSocketServer } from "./ws/socket.js";

let httpServer: HttpServer | null = null;
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info(`Shutting down API (${signal})`);

  await whatsappSessionRegistry.shutdownAll().catch(() => undefined);

  await new Promise<void>((resolve) => {
    if (!httpServer) {
      resolve();
      return;
    }

    httpServer.close(() => resolve());
  });

  await prisma.$disconnect().catch(() => undefined);
  redis.disconnect?.();
}

async function bootstrap() {
  await prisma.$connect();
  await redis.connect().catch(() => undefined);

  const app = createApp();
  httpServer = createServer(app);
  createSocketServer(httpServer);
  await whatsappSessionRegistry.initializeExistingSessions();

  httpServer.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      logger.error(`Port ${env.PORT} is already in use. Stop the other API process and restart.`, {
        error,
      });
      process.exit(1);
    }

    logger.error("HTTP server error", { error });
  });

  httpServer.listen(env.PORT, () => {
    logger.info(`API server listening on port ${env.PORT}`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

bootstrap().catch((error) => {
  logger.error("Failed to bootstrap API", { error });
  process.exit(1);
});
