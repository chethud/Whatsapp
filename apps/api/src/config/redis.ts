import RedisPkg from "ioredis";

import { env } from "./env.js";
import { logger } from "./logger.js";

declare global {
  // eslint-disable-next-line no-var
  var __redis__: ReturnType<typeof createRedis> | undefined;
}

function createNoopRedis() {
  return {
    async connect() {
      return undefined;
    },
    on() {
      return undefined;
    },
    disconnect() {
      return undefined;
    },
  };
}

function createRedis() {
  if (!env.REDIS_URL) {
    return createNoopRedis();
  }

  const Redis = RedisPkg as unknown as new (
    url: string,
    options: {
      maxRetriesPerRequest: null;
      lazyConnect: boolean;
    },
  ) => {
    connect(): Promise<void>;
    on(event: "error", listener: (error: unknown) => void): void;
    disconnect(): void;
  };

  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
}

export const redis =
  globalThis.__redis__ ??
  createRedis();

redis.on?.("error", (error: unknown) => {
  logger.warn("Redis unavailable; continuing without cache", { error });
});

if (process.env.NODE_ENV !== "production") {
  globalThis.__redis__ = redis;
}
